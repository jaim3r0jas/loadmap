import { describe, expect, it } from 'vitest'
import { compile, format } from '../src'

const SRC = `loadmap 1
load { max: 10 }
param reads "Reads" { options: [0.5, 0.8]; default: 0.8 }

flow req "requests" { rate: 100 * load; from: users; route: gw -> router -> out }
flow ping "pings" { rate: 10; from: users; route: gw -> router -> out }

node users "Users"
node gw "Gateway" {
  pass
  capacity: measured(1_000, "req/s")
  over: "clients wait"
}
node router "DB router" {
  split {
    req -> primary: 1 - reads
    req -> replica: reads
  }
}
node primary "Primary" {
  store
  capacity: measured(50, "req/s")
  over: "writes queue"
}
node replica "Replica" {
  pass
  capacity: estimated(100, "req/s")
  over: "reads wait"
}
node out "Response" {
  sink
}

users -> gw -> router
router -> primary
router -> replica -> out
`

const errors = (src: string) =>
  compile(src).diagnostics.map((d) => `${d.severity}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)

describe('split in the language', () => {
  it('sends each unit one way, as the TypeScript split does', () => {
    const r = compile(SRC)
    expect(r.diagnostics).toEqual([])
    const ev = r.definition!.model.evaluate({ load: 1 })
    expect(ev.paths.req).toEqual([
      { stages: ['gw', 'router', 'primary'], share: expect.closeTo(0.2, 12) },
      { stages: ['gw', 'router', 'replica', 'out'], share: 0.8 },
    ])
    expect(ev.paths.ping).toEqual([{ stages: ['gw', 'router', 'out'], share: 1 }])
    expect(ev.components.primary!.demand).toBeCloseTo(20, 9)
    expect(ev.components.replica!.demand).toBeCloseTo(80, 9)
    expect(r.definition!.model.evaluate({ reads: 0.5 }).components.replica!.demand).toBeCloseTo(50, 9)
    expect(format(SRC).text).toBe(SRC)
  })

  it('says what is wrong with a way', () => {
    const fixed = SRC.replace('req -> primary: 1 - reads', 'req -> primary: 0.1').replace(
      'req -> replica: reads',
      'req -> replica: 0.8',
    )
    expect(errors(fixed)).toContain('error: the shares of "req" add up to 0.9, not 1 | every unit goes one way')
    expect(errors(SRC.replace('req -> replica: reads', 'req -> replicas: reads'))[0]).toMatch(
      /^error: unknown stage "replicas"/,
    )
    // a way that does not compile already says so: its flow's shares are not added up as well
    const typo = errors(
      fixed.replace('req -> primary: 0.1', 'req -> primary: 0.2').replace('replica: 0.8', 'replicas: 0.8'),
    )
    expect(typo[0]).toMatch(/^error: unknown stage "replicas"/)
    expect(typo.join('\n')).not.toMatch(/add up/)
    expect(errors(SRC.replace('req -> replica: reads', 'req -> replica'))).toContain(
      'error: what share of the flow goes this way? | req -> replica: 0.5',
    )
    expect(errors(SRC.replace('req -> replica: reads', 'reqs -> replica: reads'))[0]).toMatch(
      /^error: unknown flow "reqs"/,
    )
    // formulas are checked when the model runs: a share past 1, and shares short of 1
    const past = compile(SRC.replace('req -> replica: reads', 'req -> replica: reads + 0.5'))
    expect(past.diagnostics.map((d) => d.message)).toContain(
      'split "router" sends a share from 0 to 1 of "req" each way, not 1.3',
    )
    const short = compile(SRC.replace('req -> replica: reads', 'req -> replica: reads - 0.1'))
    expect(short.diagnostics.map((d) => d.message)).toContain(
      'split "router" sends 90 % of "req" on: its shares add up to 1',
    )
  })
})
