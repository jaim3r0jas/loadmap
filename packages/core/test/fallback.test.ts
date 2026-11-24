import { describe, expect, it } from 'vitest'
import { defineModel, lost, measured, p, pass, sink } from '../src'

// 200 quotes a second through the API to pricing, which takes 100: half fail, and stale quotes serve them
const shop = (o: { retry?: number; stale?: number } = {}) =>
  defineModel({
    load: p.load({ max: 10 }),
    flows: {
      quotes: {
        rate: ({ load }) => 200 * load,
        ...(o.retry ? { retry: { times: o.retry } } : {}),
        fallback: { after: 'api', route: ['stale'] },
      },
    },
    components: {
      api: { name: 'API', capacity: measured(10_000, 'req/s'), over: 'x' },
      pricing: { name: 'Pricing', capacity: measured(100, 'req/s'), over: 'quotes fail' },
      stale: { name: 'Stale quotes', capacity: measured(o.stale ?? 5_000, 'req/s'), over: 'quotes fail' },
    },
    stages: {
      api: pass('api'),
      pricing: pass('pricing'),
      stale: pass('stale'),
      failed: lost({ from: ['pricing'] }),
      refused: lost({ from: ['stale'] }),
      out: sink(),
    },
    routes: { quotes: ['api', 'pricing', 'out'] },
  })

describe('a fallback', () => {
  it('serves what its flow fails for good, and no lost box on the route counts it', () => {
    const ev = shop().evaluate({ load: 1 })
    expect(ev.at.stale.quotes).toBeCloseTo(100, 9)
    expect(ev.fallbacks.quotes).toEqual({ after: 'api', route: ['stale'], rate: expect.closeTo(100, 9) })
    expect(ev.at.failed.quotes).toBeCloseTo(0, 9)
    expect(ev.components.stale.demand).toBeCloseTo(100, 9)
  })

  it('takes what fails every retry, and its own refusals are lost', () => {
    const ev = shop({ retry: 2 }).evaluate({ load: 1 })
    const r = ev.retry.quotes!
    expect(ev.at.stale.quotes).toBeCloseTo(r.rate * r.failed, 9)
    // a fallback that is full itself turns away what is over it, into its lost box
    const full = shop({ stale: 60 }).evaluate({ load: 1 })
    expect(full.at.refused.quotes).toBeCloseTo(100 - 60, 6)
  })

  it('leaves the route at a stage on it, for stages the route does not take', () => {
    const bad = (fallback: { after: string; route: string[] }) => () =>
      defineModel({
        load: p.load({ max: 4 }),
        flows: { f: { rate: 1, fallback } },
        components: { a: { name: 'A', capacity: measured(1, 'r/s'), over: 'x' } },
        stages: { a: pass('a'), b: sink(), c: sink() },
        routes: { f: ['a', 'b'] },
      })
    expect(bad({ after: 'c', route: ['c'] })).toThrow('which is not on its route')
    expect(bad({ after: 'a', route: ['b'] })).toThrow('which its own way already takes')
    expect(bad({ after: 'a', route: [] })).toThrow('falls back to no stage')
  })
})
