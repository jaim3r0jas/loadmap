import { describe, expect, it } from 'vitest'
import { compile, format } from '../src'

const SRC = `loadmap 1.8
load { max: 10 }

param bad "Bad deploy" { default: false }

expect "Orders lose under 3 %" { flow: orders; lost: 3% }

flow orders "orders" { rate: 100 * load; from: users; route: api -> db }

node users "Users"
node api "API" {
  pass
  fails: bad ? 20% : 2%
  capacity: measured(1_000, "req/s")
  over: "clients wait"
}
node db "Database" {
  pass
  capacity: measured(500, "req/s")
  over: "queries queue"
}
node errors "Errors" { lost { takes: [failed] } }

users -> api
api -> db
api -> errors
`

const errors = (src: string) =>
  compile(src).diagnostics.map((d) => `${d.severity}: ${d.code}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)

describe('a component that fails, in the language', () => {
  it('fails a share of what its stage works on, into the lost box that takes failed', () => {
    expect(format(SRC).text).toBe(SRC)
    const r = compile(SRC)
    expect(r.diagnostics).toEqual([])
    const m = r.definition!.model
    expect(m.def.stages.errors).toMatchObject({ kind: 'lost', from: ['api'], takes: ['failed'] })
    const ev = m.evaluate({ load: 1 })
    expect(ev.at.errors!.orders).toBeCloseTo(2, 9)
    expect(ev.at.db!.orders).toBeCloseTo(98, 9)
    expect(m.evaluate({ load: 1, bad: true }).lost.orders!.share).toBeCloseTo(0.2, 9)
    expect(r.expectations.map((e) => `${e.result.outcome}: ${e.result.message}`)).toEqual([
      'pass: 2 % of orders is lost at 1×, within 3 %',
    ])
  })

  it('warns when no lost box counts what it fails, with the fix that adds one', () => {
    const bare = SRC.replace('node errors "Errors" { lost { takes: [failed] } }\n', '').replace('api -> errors\n', '')
    const d = compile(bare).diagnostics
    expect(d.map((x) => `${x.severity}: ${x.code}: ${x.message}`)).toEqual([
      'warning: unseen-loss: what "api" fails vanishes: give it a lost box that counts it',
    ])
    expect(d[0]!.data).toEqual({ stage: 'api', reason: 'failed' })
    // a component that never fails loses nothing, and a fallback serves what fails past where it falls back after
    expect(errors(bare.replace('fails: bad ? 20% : 2%', 'fails: 0%'))).toEqual([])
    const served = bare
      .replace('route: api -> db }', 'route: gate -> api -> db; fallback { after: gate; route: stale } }')
      .replace(
        'node users "Users"\n',
        'node users "Users"\nnode gate "Gate" { pass; capacity: measured(10_000, "req/s"); over: "x" }\nnode stale "Stale" { pass; capacity: measured(10_000, "req/s"); over: "x" }\n',
      )
      .replace('users -> api\n', 'users -> gate\ngate -> api\ngate -> stale\n')
    expect(errors(served)).toEqual([])
  })

  it('says what is wrong with it', () => {
    expect(errors(SRC.replace('loadmap 1.8', 'loadmap 1.7'))).toContain(
      'error: language-version: "fails:" is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
    )
    expect(errors(SRC.replace('fails: bad ? 20% : 2%', 'fails: 100%'))).toEqual([
      'error: bad-value: fails is a share from 0, below 100%, not 1',
    ])
    // of the units a stage works on: a component no stage runs has none
    expect(
      errors(
        `${SRC}component spare "Spare" {\n  demand: flows.orders\n  fails: 1%\n  capacity: measured(1_000, "req/s")\n  over: "x"\n}\n`,
      ),
    ).toContain('error: unused-component: "spare" fails a share of the units a stage works on, and no stage runs it')
    expect(errors(SRC.replace('fails: bad ? 20% : 2%', 'fails: flows.orders'))).toContain(
      'error: wrong-scope: this formula reads only parameters; it cannot read flows.orders',
    )
  })
})
