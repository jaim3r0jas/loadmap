import { describe, expect, it } from 'vitest'
import { compareDefinitions, defineModel, measured, p, pass } from '../src'

// 100 req/s at 1× through an API and a database: the target is where the first reaches 50 %
const shop = (api: number, db: number, rate = 100) =>
  defineModel({
    load: p.load({ max: 100 }),
    growth: { rate: 0.1, per: 'month', asOf: '2026-11-01' },
    flows: { req: { rate: ({ load }) => rate * load } },
    components: {
      api: { name: 'API', capacity: measured(api, 'req/s'), over: 'x' },
      db: { name: 'DB', capacity: measured(db, 'req/s'), over: 'y' },
    },
    stages: { api: pass('api'), db: pass('db') },
    routes: { req: ['api', 'db'] },
  })

describe('compareDefinitions', () => {
  it('passes a change that keeps its headroom, and says nothing moved', () => {
    const d = compareDefinitions(shop(1000, 2000), shop(1000, 3000))
    expect(d.triggers).toEqual([])
    expect(d.text).toBe('API stays the first limit, at 5×.')
    expect(d.components.map((c) => [c.id, c.change])).toEqual([
      ['api', 1],
      ['db', 1.5],
    ])
  })

  it('fails on headroom lost beyond the tolerance, and dates the change', () => {
    // 5× → 4×: a fifth lost
    const d = compareDefinitions(shop(1000, 2000), shop(800, 2000))
    expect(d.triggers).toEqual([
      {
        kind: 'headroom',
        component: 'api',
        text: 'the 50 % target holds up to 4× instead of 5×: 20 % less (1× fewer), more than the 10 % allowed',
      },
    ])
    expect(d.text).toBe(
      'API stays the first limit, now at 4× instead of 5×, and runs out in August 2028 instead of November 2028.',
    )
    // a looser tolerance, in % or in ×, lets it through
    expect(compareDefinitions(shop(1000, 2000), shop(800, 2000), { tolerance: { share: 0.25 } }).triggers).toEqual([])
    expect(compareDefinitions(shop(1000, 2000), shop(800, 2000), { tolerance: { times: 1 } }).triggers).toEqual([])
    expect(compareDefinitions(shop(1000, 2000), shop(950, 2000)).triggers).toEqual([])
  })

  it('fails when the first limit moves to another component without more headroom', () => {
    const d = compareDefinitions(shop(1000, 2000), shop(1000, 900))
    expect(d.triggers.map((t) => t.kind)).toEqual(['first-limit'])
    expect(d.triggers[0]).toMatchObject({ component: 'db', text: 'the first limit moves from API to DB' })
    expect(d.text).toBe(
      'The first limit moves from API at 5× to DB at 4.5×, and runs out in October 2028 instead of November 2028.',
    )
    // moving on because the old limit was lifted is no loss
    expect(compareDefinitions(shop(1000, 2000), shop(5000, 2000)).triggers).toEqual([])
  })

  it('fails when a component crosses the target or 100 % from below at today’s load, not when it was already over', () => {
    // 100 req/s against 300 → 150: 33 % → 67 %
    const crossed = compareDefinitions(shop(300, 5000), shop(150, 5000))
    expect(crossed.triggers.filter((t) => t.kind === 'crosses')).toEqual([
      { kind: 'crosses', component: 'api', text: 'API crosses the 50 % target at today’s load: 33 % → 67 %' },
    ])
    // over the target already: only going over 100 % counts
    const over = compareDefinitions(shop(150, 5000), shop(90, 5000))
    expect(over.triggers.filter((t) => t.kind === 'crosses').map((t) => t.text)).toEqual([
      'API crosses 100 % at today’s load: 67 % → 111 %',
    ])
  })

  it('finds nothing to fail when nothing reaches the target on either side, whatever the order', () => {
    // 100 req/s against a million: never, at the load the search goes to
    const roomy = (first: 'api' | 'db') =>
      defineModel({
        load: p.load({ max: 100 }),
        searchMax: 100,
        flows: { req: { rate: ({ load }) => 100 * load } },
        components:
          first === 'api'
            ? {
                api: { name: 'API', capacity: measured(1e9, 'req/s'), over: 'x' },
                db: { name: 'DB', capacity: measured(1e9, 'req/s'), over: 'y' },
              }
            : {
                db: { name: 'DB', capacity: measured(1e9, 'req/s'), over: 'y' },
                api: { name: 'API', capacity: measured(1e9, 'req/s'), over: 'x' },
              },
        stages: { api: pass('api'), db: pass('db') },
        routes: { req: ['api', 'db'] },
      })
    const d = compareDefinitions(roomy('api'), roomy('db'))
    expect(d.triggers).toEqual([])
    expect(d.text).toBe('Nothing reaches the target at either side.')
  })

  it('names the model’s own threshold of running out', () => {
    const at = (api: number) =>
      defineModel({
        load: p.load({ max: 100 }),
        thresholds: { full: 0.9 },
        flows: { req: { rate: ({ load }) => 100 * load } },
        components: { api: { name: 'API', capacity: measured(api, 'req/s'), over: 'x' } },
        stages: { api: pass('api') },
        routes: { req: ['api'] },
      })
    expect(compareDefinitions(at(118), at(108)).triggers.map((t) => t.text)).toContain(
      'API crosses 90 % at today’s load: 85 % → 93 %',
    )
  })

  it('lists a component only one side has, with no change', () => {
    const one = defineModel({
      load: p.load({ max: 100 }),
      flows: { req: { rate: ({ load }) => 100 * load } },
      components: { api: { name: 'API', capacity: measured(1000, 'req/s'), over: 'x' } },
      stages: { api: pass('api') },
      routes: { req: ['api'] },
    })
    const d = compareDefinitions(one, shop(1000, 2000))
    expect(d.components.find((c) => c.id === 'db')).toMatchObject({ base: null, change: null })
    expect(d.triggers).toEqual([])
  })
})
