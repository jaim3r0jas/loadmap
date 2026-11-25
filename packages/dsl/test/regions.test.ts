import { outages } from '@loadmap/core/outages'
import { describe, expect, it } from 'vitest'
import { compile, format } from '../src'

const SRC = `loadmap 1.8
load { max: 10 }

domain region "Region" { parts: [eu, us] }

scenario euOut "EU out" { down: eu }

expect "Any region out keeps 1×" { down: region; underTarget: 1 }
expect "With the US out nothing is lost" { down: us; lost: 0% }

flow euOrders "EU orders" { rate: 300 * load; from: users; route: router -> db }
flow usOrders "US orders" { rate: 200 * load; from: users; route: router -> db }

node users "Users"
node router "Traffic router" {
  split {
    euOrders -> eu.api: 100%
    euOrders -> us.api: 0%
    usOrders -> us.api: 100%
    usOrders -> eu.api: 0%
  }
  capacity: estimated(50_000, "req/s", "vendor sizing guide")
  over: "users get timeouts"
}
subsystem eu "EU" {
  in: eu
  pool api "API" {
    pods: 10
    perPod: 16
    demand: (flows.euOrders + flows.usOrders) * 4ms
    capacity: measured(10, "cores", "pod CPU limit")
    over: "requests queue"
  }
  route: api
}
subsystem us "US" {
  in: us
  pool api "API" {
    pods: 8
    perPod: 16
    demand: (flows.euOrders + flows.usOrders) * 4ms
    capacity: measured(8, "cores", "pod CPU limit")
    over: "requests queue"
  }
  route: api
}
node db "Global ledger" {
  pass
  # slower while a region is out: its replica is being promoted
  service: down.region ? 8ms : 2ms
  capacity: measured(5_000, "req/s")
  over: "writes wait"
}

users -> router
router -> eu
router -> us
eu -> db
us -> db
`
const errors = (src: string) =>
  compile(src).diagnostics.map((d) => `${d.severity}: ${d.code}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)

describe('a domain with its parts by name', () => {
  it('takes a region out: its boxes are off and the split deals again', () => {
    expect(format(SRC).text).toBe(SRC)
    const r = compile(SRC)
    expect(r.diagnostics).toEqual([])
    const m = r.definition!.model
    expect(m.def.domains).toEqual({
      region: { name: 'Region', parts: { eu: { name: 'the EU' }, us: { name: 'the US' } } },
    })
    // in on the subsystem is in on every box of it
    expect((m.def.components as Record<string, { in?: object }>)['eu.api']!.in).toEqual({
      domain: 'region',
      part: 'eu',
    })
    const out = m.evaluate({ load: 1, down: 'eu' } as never)
    expect(out.at['us.api' as never]).toEqual({ euOrders: 300, usOrders: 200 })
    expect(out.at['eu.api' as never]).toEqual({ euOrders: 0, usOrders: 0 })
    expect(out.components['eu.api' as never]).toMatchObject({ util: null })
    expect(m.scenarios.map((s) => [s.label, (s.values as { down?: string }).down])).toEqual([['EU out', 'eu']])
  })

  it('reads a part as the label of the subsystem of its id', () => {
    expect(outages(compile(SRC).definition!.model).map((o) => o.text)).toEqual([
      'With the EU out, the 50 % target holds up to 2×, limited by API in US.',
      'With the US out, the 50 % target holds up to 2.5×, limited by API in EU.',
    ])
  })

  it('holds the worst of the parts where an expect names the domain', () => {
    expect(compile(SRC).expectations.map((e) => `${e.result.outcome}: ${e.result.message}`)).toEqual([
      'pass: the 50 % target holds up to 2× with the EU out, limited by API in US',
      'pass: nothing is lost at 1× with the US out',
    ])
  })

  it('reads down.<part> and down.<domain> in a formula', () => {
    expect(errors(SRC.replace('down.region ? 8ms', 'down.eu ? 8ms'))).toEqual([])
    expect(errors(SRC.replace('down.region ? 8ms', 'down.asia ? 8ms'))).toEqual([
      'error: unknown-name: unknown domain "asia"',
    ])
    const m = compile(SRC).definition!.model
    const service = (down: string) => m.evaluate({ load: 1, down } as never).latency.euOrders!.mean
    expect(service('us')).toBeGreaterThan(service('none'))
  })

  it('is from loadmap 1.8', () => {
    expect(errors(SRC.replace('loadmap 1.8', 'loadmap 1.7'))).toEqual(
      expect.arrayContaining([
        'error: language-version: "parts:" is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
        'error: language-version: "in:" is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
      ]),
    )
  })

  it('wants the part named where one is taken out, and a part that exists', () => {
    expect(errors(SRC.replace('down: eu }', 'down: region }'))).toEqual([
      'error: bad-value: "region" has its parts by name: say which one is out | down: eu',
    ])
    expect(errors(SRC.replace('  in: us\n', '  in: asia\n'))).toEqual([
      'error: unknown-name: unknown part of a domain "asia"',
    ])
  })

  it('has a count or its parts, two or more, and no box across named parts', () => {
    expect(errors(SRC.replace('parts: [eu, us]', 'parts: [eu, us]; count: 2'))).toEqual([
      'error: bad-value: a domain has a count of parts or its parts by name, not both',
    ])
    expect(errors(SRC.replace('parts: [eu, us]', 'parts: [eu]'))[0]).toBe(
      'error: bad-value: parts are two or more names | parts: [eu, us]',
    )
    expect(errors(SRC.replace('    pods: 10\n', '    pods: 10\n    across: region\n'))).toEqual([
      'error: bad-box: "region" has its parts by name: a box is in one of them | in: eu',
    ])
  })
})
