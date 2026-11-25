import { describe, expect, it } from 'vitest'
import { compile, format } from '../src'

const SRC = `loadmap 1.8
load { max: 10 }

domain zone "Availability zone" { count: 3 }

let hitRate = down.zone ? 60% : 90%

flow reads "reads" { rate: 100 * load; from: users; route: api -> appCache -> db }

node users "Users"
pool api "API" {
  pods: 6
  perPod: 4
  across: zone
  capacity: measured(6 * 480, "req/s", "load test")
  over: "requests queue"
}
node appCache "Cache" {
  cache { hit: hitRate }
}
node db "Database" {
  pass
  across: zone
  # a replica is promoted when a zone goes: a share of the reads fails meanwhile
  fails: down.zone ? 2% : 0%
  capacity: measured(1_000, "req/s")
  over: "reads wait"
}
node dbFailed "Failed" { lost { takes: [failed] } }

users -> api
api -> appCache
appCache -> db
db -> dbFailed
`
const errors = (src: string) =>
  compile(src).diagnostics.map((d) => `${d.severity}: ${d.code}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)

describe('down.<domain> in a formula', () => {
  it('is true while a part of the domain is out', () => {
    expect(format(SRC).text).toBe(SRC)
    expect(errors(SRC)).toEqual([])
    const m = compile(SRC).definition!.model
    const up = m.evaluate({ load: 1 } as never)
    // nine reads in ten are answered by the cache, and the database fails none
    expect(up.at.db!.reads).toBeCloseTo(10, 9)
    expect(up.lost.reads!.rate).toBe(0)
    const out = m.evaluate({ load: 1, down: 'zone' } as never)
    // the cache answers six in ten, and the database fails 2 % of the 40 that reach it
    expect(out.at.db!.reads).toBeCloseTo(40, 9)
    expect(out.lost.reads!.causes).toEqual([{ stage: 'db', loss: 'failed', rate: expect.closeTo(0.8, 9) }])
  })

  it('is from loadmap 1.8', () => {
    expect(errors(SRC.replace('loadmap 1.8', 'loadmap 1.7'))).toContain(
      'error: language-version: down.<domain>, whether a part of it is out is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
    )
  })

  it('names a domain the definition declares', () => {
    expect(errors(SRC.replace('down.zone ? 60%', 'down.rack ? 60%'))).toEqual([
      'error: unknown-name: unknown domain "rack"',
    ])
    const none = SRC.replace('domain zone "Availability zone" { count: 3 }\n\n', '')
      .replaceAll('  across: zone\n', '')
      .replace('  fails: down.zone ? 2% : 0%\n', '  fails: 1%\n')
    expect(errors(none)).toEqual([
      'error: unknown-name: "down.zone" asks whether a part of the failure domain "zone" is out: declare it | domain zone "zone" { count: 3 }',
    ])
  })

  it('is true or false, not a number', () => {
    expect(errors(SRC.replace('down.zone ? 60%', 'down.zone + 1 ? 60%'))).toEqual([
      'error: wrong-type: expected a number, this is true or false',
    ])
  })

  it('reads in a capacity too', () => {
    const src = SRC.replace(
      'measured(6 * 480, "req/s", "load test")',
      'measured(down.zone ? 5 * 480 : 6 * 480, "req/s", "load test")',
    )
    expect(errors(src)).toEqual([])
  })
})

describe('a box across a domain with one member', () => {
  it('has a warning: with its part out none is left', () => {
    expect(errors(SRC.replace('pods: 6', 'pods: 1'))).toEqual([
      'warning: single-point: "api" has one member across "zone": with a part of it out none is left | give it a member in more than one part',
    ])
  })

  it('is refused nothing: the box is switched off with its part out', () => {
    const m = compile(SRC.replace('pods: 6', 'pods: 1')).definition!.model
    expect(m.evaluate({ load: 1, down: 'zone' } as never).components.api!.out).toMatchObject({ members: 1, left: 0 })
  })

  it('has none with a member in two parts', () => {
    expect(errors(SRC.replace('pods: 6', 'pods: 2'))).toEqual([])
  })
})

describe('a box every flow passes that stands across no domain', () => {
  const bare = SRC.replace('  pass\n  across: zone\n', '  pass\n')

  it('has a warning: no outage touches it', () => {
    expect(errors(bare)).toEqual([
      'warning: single-point: every flow passes "db", which stands across no failure domain: no outage touches it | say the domain its members stand across: across: zone',
    ])
  })

  it('has none in a definition with no domain, and none for a box only some flows pass', () => {
    const none = bare
      .replace('domain zone "Availability zone" { count: 3 }\n\n', '')
      .replace('  across: zone\n', '')
      .replace('down.zone ? 60% : 90%', '90%')
      .replace('down.zone ? 2% : 0%', '1%')
    expect(errors(none)).toEqual([])
    const some = bare.replace(
      'flow reads "reads" {',
      'flow pings "pings" { rate: 10 * load; from: users; route: api }\nflow reads "reads" {',
    )
    expect(errors(some)).toEqual([])
  })
})
