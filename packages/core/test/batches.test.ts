import { describe, expect, it } from 'vitest'
import { defineModel, measured, p, pass, store } from '../src'

// 40 orders a second at the peak of 1×, a day averaging half of it; a rollup that handles 250 a second
const shop = (batch: { every: number; within: number }, demand?: true) =>
  defineModel({
    load: p.load({ max: 20 }),
    flows: { orders: { rate: ({ load }) => 40 * load, average: 0.5 } },
    components: {
      api: { name: 'API', capacity: measured(10_000, 'req/s'), over: 'x' },
      rollup: {
        name: 'Nightly rollup',
        demand: demand ? ({ flows }) => flows.orders * 2 : undefined,
        runs: batch,
        capacity: measured(250, 'orders/s', 'last runs'),
        over: 'the rollup misses its window',
      },
    },
    stages: { api: pass('api'), rollup: store('rollup') },
    routes: { orders: ['api', 'rollup'] },
  })

describe('a batch', () => {
  it('works off a day of arrivals, at each flow’s average, within its run', () => {
    const ev = shop({ every: 86_400, within: 14_400 }).evaluate({ load: 1 })
    // 20 a second over a day, in 4 hours: 120 a second of 250
    expect(ev.components.rollup.demand).toBeCloseTo(120, 9)
    expect(ev.components.rollup.full).toBeCloseTo(250 / 120, 6)
    expect(ev.components.rollup.runs).toEqual({ every: 86_400, within: 14_400, takes: 14_400 * (120 / 250) })
    // its stage still sees the peak: the bars of the other components do not move
    expect(ev.at.rollup.orders).toBeCloseTo(40, 9)
  })

  it('every hour reads the peak, and scales a demand line too', () => {
    expect(shop({ every: 3_600, within: 600 }).evaluate({ load: 1 }).components.rollup.demand).toBeCloseTo(240, 9)
    // a demand of 2 a unit, a day's worth at the average in 4 h
    expect(shop({ every: 86_400, within: 14_400 }, true).evaluate({ load: 1 }).components.rollup.demand).toBeCloseTo(
      240,
      9,
    )
  })

  it('runs only on a rate: no stock, held or quota', () => {
    expect(() =>
      defineModel({
        load: p.load({ max: 4 }),
        flows: { orders: { rate: 1 } },
        components: {
          db: { name: 'DB', capacity: measured(10, 'w/s'), over: 'x' },
          disk: {
            name: 'Disk',
            fills: () => 1,
            keeps: 60,
            runs: { every: 86_400, within: 3_600 },
            capacity: measured(10, 'GB'),
            over: 'x',
          },
        },
        stages: { db: store('db') },
        routes: { orders: ['db'] },
      }),
    ).toThrow('so it is no stock, held or quota')
  })

  it('refuses a run longer than its period', () => {
    expect(() => shop({ every: 3_600, within: 7_200 }).evaluate({ load: 1 })).toThrow('within at most every')
  })
})
