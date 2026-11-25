import { describe, expect, it } from 'vitest'
import { check, compare, defineModel, measured, p, pass, sink, workers } from '../src'

// 100 requests a second at 1×, an API of 100 a pod autoscaled up to maxPods at 70 %, then a database
const shop = (o: { currency?: string; expect?: object[]; db?: number } = {}) =>
  defineModel({
    load: p.load({ max: 20 }),
    params: { maxPods: p.select({ label: 'Most API pods', options: [6, 12], default: 6 }) },
    scenarios: { Today: {}, 'Bigger API': { maxPods: 12 } },
    ...(o.currency ? { currency: o.currency } : {}),
    flows: { requests: { label: 'requests', rate: ({ load }) => 100 * load } },
    components: {
      api: {
        name: 'API',
        demand: ({ flows }) => flows.requests,
        capacity: ({ maxPods }) => measured(maxPods * 100, 'req/s', '100 a pod'),
        cost: ({ running }) => running * 140,
        over: 'x',
      },
      db: { name: 'Database', capacity: measured(1_000, 'req/s'), cost: () => o.db ?? 600, over: 'x' },
    },
    stages: {
      api: workers('api', { perPod: 4, autoscale: { min: 2, max: ({ maxPods }) => maxPods, target: 0.7 } }),
      db: pass('db'),
      out: sink(),
    },
    routes: { requests: ['api', 'db', 'out'] },
    expect: (o.expect ?? []) as never,
  })

describe('what a design costs', () => {
  it('counts the pods an autoscaled pool runs at this load', () => {
    // 2 pods at 1×, 5 at 3×: 280 € and 700 €, with the database's 600
    expect(shop({ currency: '€' }).evaluate({ load: 1 }).cost).toEqual({
      total: 880,
      components: { api: 280, db: 600 },
      currency: '€',
    })
    expect(shop().evaluate({ load: 3 }).cost).toEqual({ total: 1300, components: { api: 700, db: 600 } })
  })

  it('has no cost where no component has one', () => {
    const m = shop()
    const bare = defineModel({
      ...m.def,
      components: {
        api: { ...m.def.components.api, cost: undefined },
        db: { ...m.def.components.db, cost: undefined },
      },
    } as never)
    expect(bare.evaluate({ load: 1 }).cost).toBeUndefined()
  })

  it('puts the cost in each scenario row, and what the headroom costs in the sentence', () => {
    const c = compare(shop({ currency: '€', db: 600 }), 5)
    // at 5× today's six pods all run; the bigger API runs eight
    expect(c.rows.map((r) => [r.label, r.cost])).toEqual([
      ['Today', 6 * 140 + 600],
      ['Bigger API', 8 * 140 + 600],
    ])
    expect(c.text).toMatch(/, for 280 € a month more\.$/)
  })

  it('holds a budget at the values or at underTarget', () => {
    const said = (e: object) => check(shop({ currency: '€', expect: [e] })).map((r) => `${r.outcome}: ${r.message}`)
    expect(said({ cost: 2_000, underTarget: 3 })).toEqual(['pass: it costs 1,300 € a month at 3×, within 2,000 €'])
    expect(said({ cost: 1_000, underTarget: 3 })).toEqual([
      'fail: expected at most 1,000 € a month, but it costs 1,300 € at 3×',
    ])
  })

  it('refuses a budget with nothing to cost, a cost below 0, and a budget with more', () => {
    const m = shop()
    expect(() =>
      defineModel({
        ...m.def,
        components: {
          api: { ...m.def.components.api, cost: undefined },
          db: { ...m.def.components.db, cost: undefined },
        },
        expect: [{ cost: 10 }],
      } as never),
    ).toThrow('holds a cost: give a component one')
    expect(() => shop({ db: -1 }).evaluate({ load: 1 })).toThrow('component "db" costs -1 a month')
    expect(() => shop({ expect: [{ cost: 10, flow: 'requests' }] })).toThrow('holds a cost: no flow')
  })
})
