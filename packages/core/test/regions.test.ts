import { describe, expect, it } from 'vitest'
import { check, defineModel, lost, measured, p, pass, sink, split } from '../src'
import { outages } from '../src/outages'

// 500 orders a second at 1×, dealt to two regions, then one ledger for both
const shop = (o: { shares?: [number, number]; noSplit?: boolean; expect?: object[] } = {}) =>
  defineModel({
    load: p.load({ max: 10 }),
    domains: { region: { name: 'Region', parts: { eu: { name: 'the EU' }, us: { name: 'the US' } } } },
    flows: { orders: { label: 'orders', rate: ({ load }) => 500 * load } },
    components: {
      router: { name: 'Router', capacity: measured(50_000, 'req/s'), over: 'x' },
      euApi: {
        name: 'EU API',
        short: 'the EU API',
        capacity: measured(1_000, 'req/s'),
        in: { domain: 'region', part: 'eu' },
        over: 'x',
      },
      usApi: {
        name: 'US API',
        short: 'the US API',
        capacity: measured(800, 'req/s'),
        in: { domain: 'region', part: 'us' },
        over: 'x',
      },
      db: { name: 'Ledger', capacity: measured(5_000, 'req/s'), over: 'x' },
    },
    stages: {
      router: o.noSplit
        ? pass('router')
        : split({
            component: 'router',
            to: [
              { stages: ['euApi'], share: (o.shares ?? [0.6, 0.4])[0] },
              { stages: ['usApi'], share: (o.shares ?? [0.6, 0.4])[1] },
            ],
          }),
      euApi: pass('euApi'),
      usApi: pass('usApi'),
      db: pass('db'),
      refused: lost({ from: o.noSplit ? ['router', 'euApi'] : ['router', 'euApi', 'usApi'] }),
      out: sink(),
    },
    routes: { orders: o.noSplit ? ['router', 'euApi', 'db', 'out'] : ['router', 'db', 'out'] },
    expect: (o.expect ?? []) as never,
  })

describe('a domain with its parts by name', () => {
  it('gives the Outage control each part', () => {
    const m = shop()
    expect(m.params.find((x) => x.id === 'down')?.def).toMatchObject({ options: ['none', 'eu', 'us'] })
    expect(m.outageValues({}).map((o) => [o.domain, o.with, o.values.down])).toEqual([
      ['region', 'with the EU out', 'eu'],
      ['region', 'with the US out', 'us'],
    ])
  })

  it('deals a split again when a part is down: the ways left take its share', () => {
    const m = shop()
    const up = m.evaluate({ load: 1 })
    expect(up.at).toMatchObject({ euApi: { orders: 300 }, usApi: { orders: 200 }, db: { orders: 500 } })
    const out = m.evaluate({ load: 1, down: 'eu' } as never)
    expect(out.at).toMatchObject({ euApi: { orders: 0 }, usApi: { orders: 500 }, db: { orders: 500 } })
    expect(out.stages.router).toMatchObject({ to: { orders: [{ stages: ['usApi'], share: 1 }] } })
    expect(out.paths.orders).toEqual([{ stages: ['router', 'usApi', 'db', 'out'], share: 1 }])
    // the EU API is switched off, the US one carries all 500 of its 800
    expect(out.components.euApi.util).toBeNull()
    expect(out.components.usApi.util).toBeCloseTo(0.625, 9)
    expect(out.stages.euApi).toMatchObject({ gone: true })
    expect(out.lost.orders!.rate).toBe(0)
  })

  it('deals evenly to ways whose shares are all 0', () => {
    const out = shop({ shares: [1, 0] }).evaluate({ load: 1, down: 'eu' } as never)
    expect(out.at.usApi!.orders).toBe(500)
    expect(out.lost.orders!.rate).toBe(0)
  })

  it('turns away at a box of the part what reaches it with no split in front', () => {
    const m = shop({ noSplit: true })
    const out = m.evaluate({ load: 1, down: 'eu' } as never)
    expect(out.lost.orders).toMatchObject({ share: 1, causes: [{ stage: 'euApi', loss: 'rejected', rate: 500 }] })
    // nothing goes on past it
    expect(out.at).toMatchObject({ db: { orders: 0 }, refused: { orders: 500 } })
    // the other part's outage does not touch it
    expect(m.evaluate({ load: 1, down: 'us' } as never).lost.orders!.rate).toBe(0)
  })

  it('answers N−1 for each part', () => {
    expect(outages(shop()).map((o) => o.text)).toEqual([
      'With the EU out, the 50 % target holds up to 0.8×, limited by the US API.',
      'With the US out, the 50 % target holds up to 1×, limited by the EU API.',
    ])
  })

  it('holds the worst of the parts for an expectation that names the domain', () => {
    const m = shop({
      expect: [
        { down: 'region', underTarget: 0.9 },
        { down: 'us', underTarget: 0.9 },
        { down: 'us', lost: 0 },
      ],
    })
    expect(check(m).map((r) => `${r.outcome}: ${r.message}`)).toEqual([
      'fail: expected at least 0.9×, but the 50 % target holds up to 0.8× with the EU out, limited by the US API',
      'pass: the 50 % target holds up to 1× with the US out, limited by the EU API',
      'pass: nothing is lost at 1× with the US out',
    ])
  })

  it('refuses a part no domain has, a single part and a name taken twice', () => {
    const base = {
      load: p.load({ max: 10 }),
      flows: { orders: { rate: ({ load }: { load: number }) => 500 * load } },
      stages: { api: pass('api') },
      routes: { orders: ['api'] },
    } as const
    const api = { name: 'API', capacity: measured(1_000, 'req/s'), over: 'x' }
    expect(() =>
      defineModel({
        ...base,
        domains: { region: { name: 'Region', parts: { eu: { name: 'the EU' }, us: { name: 'the US' } } } },
        components: { api: { ...api, in: { domain: 'region', part: 'asia' } } },
      }),
    ).toThrow('component "api" is in "asia", no named part of a domain "region"')
    expect(() =>
      defineModel({
        ...base,
        domains: { region: { name: 'Region', parts: { eu: { name: 'the EU' } } } },
        components: { api },
      }),
    ).toThrow('domain "region" has a count of parts or its parts by name, two or more')
    expect(() =>
      defineModel({
        ...base,
        domains: {
          region: { name: 'Region', parts: { eu: { name: 'the EU' }, us: { name: 'the US' } } },
          site: { name: 'Site', parts: { eu: { name: 'the EU site' }, east: { name: 'the east site' } } },
        },
        components: { api },
      }),
    ).toThrow('part "eu" of domain "site" needs a name no domain and no other part has')
  })
})
