import { describe, expect, it } from 'vitest'
import { compile, format } from '../src'

const SRC = `loadmap 1.8
load { max: 10 }

expect "Jobs lose under 1 %" { flow: jobs; lost: 1% }

flow jobs "jobs" { rate: 100 * load; from: users; route: api -> inbox -> runners -> db }

node users "Users"
node api "API" {
  pass
  capacity: measured(10_000, "req/s")
  over: "clients wait"
}
cluster buffer "Buffer" {
  members: 1
  queue inbox "inbox" {
    holds: 5_000
    partitions { jobs: 1 }
  }
}
pool runners "Runners" {
  pods: 2
  perPod: 4
  demand: flows.jobs * 10ms
  capacity: measured(2, "cores")
  over: "jobs wait in the inbox"
}
node db "DB" {
  pass
  capacity: measured(10_000, "req/s")
  over: "writes wait"
}
node refused "Refused" { lost { takes: [rejected] } }

users -> api
api -> buffer
buffer -> runners
runners -> db
buffer -> refused
`
const errors = (src: string) => compile(src).diagnostics.map((d) => `${d.severity}: ${d.code}: ${d.message}`)

describe('a queue with a size', () => {
  it('compiles, is laid out by format and turns away what its reader cannot take', () => {
    expect(format(SRC).text).toBe(SRC)
    const r = compile(SRC)
    expect(r.diagnostics).toEqual([])
    const m = r.definition!.model
    expect(m.evaluate({ load: 1 } as never).stages.inbox).toMatchObject({ holds: 5000, whenFull: 'reject' })
    const ev = m.evaluate({ load: 3 } as never)
    expect(ev.lost.jobs!.share).toBeCloseTo(1 / 3, 9)
    expect(ev.at.refused!.jobs).toBeCloseTo(100, 6)
    expect(r.expectations.map((e) => e.result.outcome)).toEqual(['pass'])
  })

  it('turns the unit away at the stage before it with full: block', () => {
    const src = SRC.replace('holds: 5_000\n', 'holds: 5_000\n    full: block\n').replace(
      'buffer -> refused',
      'api -> refused',
    )
    expect(format(src).text).toBe(src)
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    const ev = r.definition!.model.evaluate({ load: 3 } as never)
    expect(ev.lost.jobs!.causes).toEqual([{ stage: 'api', loss: 'rejected', rate: expect.closeTo(100, 6) }])
  })

  it('is from loadmap 1.8', () => {
    expect(errors(SRC.replace('loadmap 1.8', 'loadmap 1.7'))).toContain(
      'error: language-version: "holds:" is from loadmap 1.8; this definition says loadmap 1.7',
    )
  })

  it('refuses full without a size, a size that is not above 0 and a word it does not know', () => {
    expect(errors(SRC.replace('holds: 5_000\n', 'full: block\n'))[0]).toBe(
      'error: model: full says where a unit is turned away once the queue holds no more: give the queue its size',
    )
    expect(errors(SRC.replace('holds: 5_000', 'holds: 0'))).toEqual([
      'error: bad-value: a queue holds a number of units above 0, not 0',
    ])
    expect(errors(SRC.replace('holds: 5_000\n', 'holds: 5_000\n    full: maybe\n'))).toEqual([
      'error: bad-value: "maybe" is not one of reject, block',
    ])
  })

  it('warns when nothing counts what it turns away', () => {
    const src = SRC.replace('node refused "Refused" { lost { takes: [rejected] } }\n', '').replace(
      'buffer -> refused\n',
      '',
    )
    expect(errors(src)).toEqual([
      'warning: unseen-loss: what "inbox" turns away vanishes: give it a lost box that counts it',
    ])
  })

  it('warns at the stage before it when it blocks and nothing counts what is turned away there', () => {
    const src = SRC.replace('holds: 5_000\n', 'holds: 5_000\n    full: block\n')
      .replace('node refused "Refused" { lost { takes: [rejected] } }\n', '')
      .replace('buffer -> refused\n', '')
    expect(errors(src)).toEqual([
      'warning: unseen-loss: what finds "inbox" full is turned away at "api" and vanishes: give "api" a lost box that counts it',
    ])
  })

  it('has no lost box to feed without a size', () => {
    expect(errors(SRC.replace('    holds: 5_000\n', ''))[0]).toMatch(
      /^error: bad-lost: "buffer" loses nothing the lost box "refused" takes/,
    )
  })
})
