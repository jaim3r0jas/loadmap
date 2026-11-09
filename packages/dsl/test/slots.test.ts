import { describe, expect, it } from 'vitest'
import { compile, format } from '../src'

const SRC = `loadmap 1
load { max: 10 }
param ms "Query time" { options: [20, 50]; default: 20 }

flow req "requests" { rate: 100 * load; from: users; route: api -> db }
flow ws "sockets" { rate: 0.1; from: users; route: api }

node users "Users"
node api "API" {
  pass
  capacity: measured(10_000, "req/s")
  over: "clients wait"
}
node db "Postgres" {
  store
  capacity: estimated(4_000, "commits/s")
  over: "commits queue"
}

component sockets "Socket slots" {
  on: api
  held { req: 0.2; ws: 60 }
  capacity: configured(50, "sessions", "per instance")
  over: "new sockets are refused"
}
component conns "Postgres connections" {
  on: db
  held: ms / 1_000
  capacity: configured(100, "connections", "pool size")
  over: "orders wait for a connection"
}

users -> api
api -> db
`

const errors = (src: string) =>
  compile(src).diagnostics.map((d) => `${d.severity}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)

describe('held in the language', () => {
  it('counts slots as the TypeScript held does', () => {
    expect(format(SRC).text).toBe(SRC)
    const r = compile(SRC)
    expect(r.diagnostics).toEqual([])
    const ev = r.definition!.model.evaluate({ load: 1 })
    // 100 × 0.2 + 0.1 × 60 = 26 sockets; 100 × 20 ms = 2 connections, 5 at 50 ms
    expect(ev.components.sockets!.demand).toBeCloseTo(26, 9)
    expect(ev.components.sockets!.held).toEqual({ req: 0.2, ws: 60 })
    expect(ev.components.conns!.demand).toBeCloseTo(2, 9)
    expect(r.definition!.model.evaluate({ load: 1, ms: 50 }).components.conns!.demand).toBeCloseTo(5, 9)
    expect(ev.components.db!.demand).toBe(100)
  })

  it('says what is wrong with it', () => {
    expect(errors(SRC.replace('held { req: 0.2; ws: 60 }', 'held { req: 0.2; wss: 60 }'))[0]).toMatch(
      /^error: unknown flow "wss"/,
    )
    expect(errors(SRC.replace('  held: ms / 1_000\n', '  held: ms / 1_000\n  demand: 3\n'))).toContain(
      'error: a component that is held works out its demand: drop one of them',
    )
    expect(errors(SRC.replace('  held: ms / 1_000\n', '  held: ms / 1_000\n  held { req: 1 }\n'))[0]).toMatch(
      /^error: held is set twice/,
    )
    expect(errors(SRC.replace('  held: ms / 1_000\n', ''))).toContain(
      'error: on names the stages that hold its slots: give it held too | held: 0.02',
    )
    expect(errors(SRC.replace('  on: db\n', '  on: dbs\n'))).toEqual([
      expect.stringMatching(/^error: unknown stage "dbs"/),
    ])
    expect(errors(SRC.replace('held { req: 0.2; ws: 60 }', 'held { req: -1 }'))[0]).toMatch(
      /^error: a time held is seconds from 0 up, not -1/,
    )
    expect(errors(SRC.replace('  on: db\n', ''))).toContain(
      'error: the component "conns" is held on no stage | on: stage',
    )
    expect(errors(SRC.replace('node users "Users"', 'node users "Users" { held { req: 1 } }'))).toContain(
      'error: held belongs to a component | give the box capacity and over lines',
    )
    // a capacity per second is a rate, not slots: the model says so when it runs
    expect(
      compile(SRC.replace('configured(100, "connections", "pool size")', 'measured(100, "req/s")')).diagnostics.map(
        (d) => d.message,
      ),
    ).toContain('component "conns" is held, so its capacity counts slots ("connections", "sessions"), not "req/s"')
  })
})
