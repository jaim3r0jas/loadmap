import { describe, expect, it } from 'vitest'
import { configured, defineModel, estimated, limit, lost, measured, p, pass, sink } from '../src'

// 400 tenants of 100 req/s each; 100 requests a second at 1×
const keyed = (o: { skew?: number; within?: number } = {}) =>
  defineModel({
    load: p.load({ max: 50 }),
    flows: { req: { label: 'requests', rate: ({ load }) => 100 * load } },
    components: {
      perTenant: { name: 'Tenant limit', capacity: configured(100, 'req/s', "a tenant's plan"), over: 'x' },
    },
    stages: {
      perTenant: limit('perTenant', {
        keys: 400,
        ...(o.skew != null
          ? { skew: estimated(o.skew, 'share', { source: 'the noisiest tenant', within: o.within }) }
          : {}),
      }),
      out: sink(),
      gone: lost({ from: ['perTenant'] }),
    },
    routes: { req: ['perTenant', 'out'] },
  })

describe('a limit for each key', () => {
  it('runs out when the hottest key does', () => {
    // the noisiest carries 20 %: 20 a second at 1×, its own 100 at 5×
    const m = keyed({ skew: 0.2 })
    expect(m.evaluate({ load: 1 }).components.perTenant).toMatchObject({
      util: 0.2,
      demand: 20,
      keys: { count: 400, hottest: 0.2 },
    })
    expect(m.evaluate({ load: 1 }).target).toEqual({ low: 2.5, high: 2.5 })
  })

  it("turns away only what is above each key's own limit", () => {
    // at 10× the noisiest sends 200 against its 100: half of its 20 %, nothing of the rest
    expect(keyed({ skew: 0.2 }).evaluate({ load: 10 }).lost.req!.share).toBeCloseTo(0.1, 9)
  })

  it('takes an even share without a skew', () => {
    const ev = keyed().evaluate({ load: 10 })
    expect(ev.components.perTenant.keys).toEqual({ count: 400, hottest: 1 / 400 })
    expect(ev.components.perTenant.util).toBeCloseTo(0.025, 9)
  })

  it('moves its crossings with a ± on the share: the larger share is the pessimistic edge', () => {
    expect(keyed({ skew: 0.2, within: 0.25 }).evaluate({ load: 1 }).target).toEqual({
      low: expect.closeTo(2, 9),
      high: expect.closeTo(10 / 3, 9),
    })
  })

  it('takes no per or burst, and a skew only with keys', () => {
    expect(() => limit('x', { keys: 4, per: 'day' })).toThrow('for each key takes no per or burst')
    expect(() => limit('x', { skew: estimated(0.2, 'share') })).toThrow(
      "has a skew, the hottest key's share: give it keys",
    )
  })
})

describe("a connection's busiest member", () => {
  // a ring of 4 cache members, 1,000 reads a second at 1×
  const ring = (busiest?: number) =>
    defineModel({
      load: p.load({ max: 50 }),
      flows: { reads: { label: 'reads', rate: ({ load }) => 1000 * load } },
      components: {
        api: { name: 'API', capacity: measured(100_000, 'req/s'), over: 'x' },
        cache: {
          name: 'Cache',
          short: 'the cache',
          capacity: measured(10_000, 'req/s', 'load test, 4 members'),
          over: 'x',
        },
      },
      stages: { api: pass('api'), cache: pass('cache') },
      routes: { reads: ['api', 'cache'] },
      connections: {
        ring: {
          from: 'api',
          to: 'cache',
          members: 4,
          ...(busiest != null ? { busiest: estimated(busiest, 'share', 'ring stats') } : {}),
        },
      },
    })

  it('runs the stage out when that member does: the share × the members', () => {
    const ev = ring(0.32).evaluate({ load: 1 })
    expect(ev.components.cache.util).toBeCloseTo(0.128, 9)
    expect(ev.components.cache.spread).toEqual({
      factor: expect.closeTo(1.28, 9),
      text: 'The busiest member takes 32 % of the work (ring stats): the cache runs out at 78 % of its capacity.',
    })
  })

  it('is no spread at an even share or below, and none without it', () => {
    expect(ring(0.1).evaluate({ load: 1 }).components.cache.spread).toBeUndefined()
    expect(ring().evaluate({ load: 1 }).components.cache.util).toBeCloseTo(0.1, 9)
  })
})
