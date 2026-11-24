import { describe, expect, it } from 'vitest'
import { compile, format } from '../src'

const SRC = `loadmap 1.8
load { max: 10 }

expect "The pool lasts to 1.5×" { component: conns; notFull: 1.5× }

flow orders "orders" { rate: 40 * load; from: users; route: api -> payments }

component conns "DB connections" {
  held: 5ms
  on: api
  through: api -> payments
  capacity: configured(20, "connections", "the pool's size")
  over: "requests wait for a connection"
}

node users "Users"
node api "API" {
  pass
  capacity: measured(2_000, "req/s")
  service: 5ms
  over: "clients wait"
}
node payments "Payments" {
  pass
  capacity: measured(100, "req/s")
  service: 100ms
  over: "payments queue"
}

users -> api
api -> payments { delay: 10ms }
`

const errors = (src: string) =>
  compile(src).diagnostics.map((d) => `${d.severity}: ${d.code}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)

describe('a slot held through a stretch, in the language', () => {
  it('is the component’s through, and its slots follow the stretch', () => {
    expect(format(SRC).text).toBe(SRC)
    const r = compile(SRC)
    expect(r.diagnostics).toEqual([])
    const m = r.definition!.model
    expect(m.def.components.conns).toMatchObject({ held: 0.005, on: ['api'], through: ['api', 'payments'] })
    // the API at 40 of 2,000, 10 ms on the edge, payments at 40 of 100
    const held = 0.005 + 0.005 / (1 - 40 / 2000) + 0.01 + 0.1 / (1 - 0.4)
    const c = m.evaluate({ load: 1 }).components.conns!
    expect(c.held!.orders).toBeCloseTo(held, 12)
    expect(c.demand).toBeCloseTo(40 * held, 9)
    expect(r.expectations.map((e) => `${e.result.outcome}: ${e.result.message}`)).toEqual([
      'pass: DB connections runs out at 1.6×',
    ])
    // held is optional beside it
    expect(errors(SRC.replace('  held: 5ms\n', ''))).toEqual([])
  })

  it('says what is wrong with it', () => {
    expect(errors(SRC.replace('loadmap 1.8', 'loadmap 1.7'))).toContain(
      'error: language-version: "through:" is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
    )
    expect(errors(SRC.replace('through: api -> payments', 'through: api'))).toEqual([
      'error: bad-box: through is a stretch of the way: from -> to | through: api -> db',
    ])
    expect(errors(SRC.replace('through: api -> payments', 'through: api -> nope'))).toEqual([
      'error: unknown-name: unknown stage "nope"',
    ])
    expect(errors(SRC.replace('  on: api\n', ''))).toEqual([
      'error: unused-component: the component "conns" is held on no stage | on: stage',
    ])
  })
})
