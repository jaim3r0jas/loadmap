import { describe, expect, it } from 'vitest'
import { check, defineModel, fanout, lost, measured, p, pass, sink, split } from '../src'
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
    expect(m.outageValues({}).map((o) => [o.domain, o.part, o.with, o.values.down])).toEqual([
      ['region', 'eu', 'with the EU out', 'eu'],
      ['region', 'us', 'with the US out', 'us'],
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

  it('takes a stage with no component as in the part too, and deals around a split that has no way left', () => {
    // each region has a door that only routes; the EU door's one way is the EU API
    const m = defineModel({
      load: p.load({ max: 10 }),
      domains: { region: { name: 'Region', parts: { eu: { name: 'the EU' }, us: { name: 'the US' } } } },
      flows: { orders: { rate: ({ load }) => 500 * load } },
      components: {
        euApi: { name: 'EU API', capacity: measured(1_000, 'req/s'), in: { domain: 'region', part: 'eu' }, over: 'x' },
        usApi: { name: 'US API', capacity: measured(800, 'req/s'), in: { domain: 'region', part: 'us' }, over: 'x' },
      },
      stages: {
        router: split({
          to: [
            { stages: ['euDoor'], share: 0.6 },
            { stages: ['usApi'], share: 0.4 },
          ],
        }),
        euDoor: split({ to: [{ stages: ['euApi'], share: 1 }] }),
        euApi: pass('euApi'),
        usApi: pass('usApi'),
        out: sink(),
      },
      routes: { orders: ['router', 'out'] },
    })
    const out = m.evaluate({ load: 1, down: 'eu' } as never)
    expect(out.at.usApi!.orders).toBe(500)
    expect(out.lost.orders!.rate).toBe(0)
    // the door itself, when it says where it is
    const placed = defineModel({
      ...m.def,
      stages: { ...m.def.stages, euDoor: { ...m.def.stages.euDoor, in: { domain: 'region', part: 'eu' } } },
    } as never)
    expect(placed.evaluate({ load: 1, down: 'eu' } as never).stages.euDoor).toMatchObject({ gone: true })
  })

  it('makes no copies at a fan-out whose part is down', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      domains: { region: { name: 'Region', parts: { eu: { name: 'the EU' }, us: { name: 'the US' } } } },
      flows: { orders: { rate: ({ load }) => 500 * load } },
      components: {
        bus: { name: 'EU bus', capacity: measured(5_000, 'req/s'), in: { domain: 'region', part: 'eu' }, over: 'x' },
        push: { name: 'Push', demand: ({ at }) => at.push.orders, capacity: measured(5_000, 'req/s'), over: 'x' },
      },
      stages: {
        bus: fanout({ component: 'bus', to: { orders: [{ stage: 'push', share: 2 }] } }),
        push: pass('push'),
      },
      routes: { orders: ['bus'] },
    })
    expect(m.evaluate({ load: 1 }).at.push!.orders).toBe(1000)
    const out = m.evaluate({ load: 1, down: 'eu' } as never)
    expect(out.at.push!.orders).toBe(0)
    expect(out.components.push.util).toBe(0)
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

  it('refuses a component across a domain with its parts by name: it is in one of them', () => {
    expect(() =>
      defineModel({
        load: p.load({ max: 10 }),
        domains: { region: { name: 'Region', parts: { eu: { name: 'the EU' }, us: { name: 'the US' } } } },
        flows: { orders: { rate: ({ load }) => 500 * load } },
        components: {
          api: { name: 'API', capacity: measured(1_000, 'req/s'), across: { domain: 'region', members: 6 }, over: 'x' },
        },
        stages: { api: pass('api') },
        routes: { orders: ['api'] },
      }),
    ).toThrow('component "api" stands across "region", which has its parts by name: it is in one of them')
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
