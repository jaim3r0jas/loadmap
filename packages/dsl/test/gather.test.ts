import { describe, expect, it } from 'vitest'
import { compile, format } from '../src'

const SRC = `loadmap 1.8
load { max: 10 }

param quorum "Shards that must answer" { options: [6, 8]; default: 8 }

expect "Reads lose under 10 %" { flow: reads; lost: 10% }

flow reads "reads" { rate: 100 * load; from: users; route: api -> scatter -> render }

node users "Users"
node api "API" {
  pass
  capacity: measured(10_000, "req/s")
  service: 2ms
  over: "clients wait"
}
node scatter "Scatter" {
  gather {
    reads -> shards: 8
    needs: quorum
  }
}
node shards "Shards" {
  pass
  fails: 1%
  capacity: measured(4_000, "req/s")
  service: 10ms
  over: "reads queue"
}
node render "Render" {
  pass
  capacity: measured(10_000, "req/s")
  service: 3ms
  over: "pages queue"
}
node incomplete "Incomplete" { lost { takes: [failed] } }

users -> api
api -> scatter
scatter -> shards
scatter -> render
scatter -> incomplete
`

const errors = (src: string) =>
  compile(src).diagnostics.map((d) => `${d.severity}: ${d.code}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)

describe('a gather, in the language', () => {
  it('is a stage on the route that calls a branch several times and needs some of the answers', () => {
    expect(format(SRC).text).toBe(SRC)
    const r = compile(SRC)
    expect(r.diagnostics).toEqual([])
    const m = r.definition!.model
    expect(m.def.stages.scatter).toMatchObject({ kind: 'gather', to: { reads: [{ stage: 'shards', share: 8 }] } })
    // the shards fail 1 % of their calls: 7.7 % of the reads that need all eight, into the lost box
    const ev = m.evaluate({ load: 1 })
    expect(ev.at.shards!.reads).toBeCloseTo(800, 9)
    // the stage after it is reached by the reads that did not fail there
    expect(ev.at.render!.reads).toBeCloseTo(100 * 0.99 ** 8, 9)
    expect(ev.at.incomplete!.reads).toBeCloseTo(100 * (1 - 0.99 ** 8), 9)
    expect(r.expectations.map((e) => `${e.result.outcome}: ${e.result.message}`)).toEqual([
      'pass: 7.7 % of reads is lost at 1×, within 10 %',
    ])
    // needs is a formula of the parameters: six of eight forgive two failures, and wait for the sixth answer
    const six = m.evaluate({ load: 1, quorum: 6 })
    expect(six.stages.scatter).toMatchObject({ needs: 6 })
    expect(six.lost.reads!.share).toBeLessThan(1e-4)
    expect(six.latency.reads!.mean).toBeLessThan(ev.latency.reads!.mean)
  })

  it('hedges its calls: what it calls sees the second ones, and the wait is shorter', () => {
    const plain = compile(SRC).definition!.model.evaluate({ load: 1 })
    const src = SRC.replace('    needs: quorum\n', '    needs: quorum\n    hedge: 95%\n')
    expect(format(src).text).toBe(src)
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    const ev = r.definition!.model.evaluate({ load: 1 })
    expect(ev.stages.scatter).toMatchObject({ hedge: 0.95 })
    expect(ev.at.shards!.reads).toBeCloseTo(840, 9)
    expect(ev.latency.reads!.p99).toBeLessThan(plain.latency.reads!.p99)
    // 100 % is no hedge, so a control can switch it off; past it is no percentile
    expect(errors(src.replace('hedge: 95%', 'hedge: 100%'))).toEqual([])
    expect(errors(src.replace('hedge: 95%', 'hedge: 150%'))).toEqual([
      'error: bad-value: a hedge is a percentile above 0, up to 100%, not 1.5',
    ])
  })

  it('needs an edge to what it calls, and a lost box for what it fails', () => {
    expect(errors(SRC.replace('scatter -> shards\n', ''))).toEqual([
      'error: missing-edge: "reads" goes from "scatter" to "shards", and no edge joins them | draw scatter -> shards',
    ])
    const bare = SRC.replace('node incomplete "Incomplete" { lost { takes: [failed] } }\n', '').replace(
      'scatter -> incomplete\n',
      '',
    )
    expect(errors(bare)).toEqual([
      'warning: unseen-loss: what "scatter" fails vanishes: give it a lost box that counts it',
    ])
  })

  it('says what is wrong with it', () => {
    expect(errors(SRC.replace('loadmap 1.8', 'loadmap 1.7'))).toContain(
      'error: language-version: "gather" is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
    )
    expect(errors(SRC.replace('reads -> shards: 8', 'reads -> shards: 2.5'))).toEqual([
      'error: model: gather "scatter" makes 2.5 calls for each unit of "reads": a whole number from 1',
    ])
    expect(errors(SRC.replace('options: [6, 8]', 'options: [6, 9]').replace('default: 8', 'default: 9'))).toEqual([
      'error: model: gather "scatter" needs 9 of its 8 calls: a whole number from 1 to 8',
    ])
    expect(errors(SRC.replace('reads -> shards: 8\n', 'reads -> shards: 8\n    reads -> render: 2\n'))).toEqual([
      'error: model: gather "scatter" has 2 branches for "reads": one a flow',
    ])
  })
})
