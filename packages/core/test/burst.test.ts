import { describe, expect, it } from 'vitest'
import { configured, defineModel, limit, measured, p, pass, sink } from '../src'

// 50 searches a second at 1×, through a limiter of 100 a second, then the API
const shop = (o: { burst?: number; per?: 'minute'; cap?: number } = {}) =>
  defineModel({
    load: p.load({ max: 10 }),
    flows: { searches: { label: 'searches', rate: ({ load }) => 50 * load } },
    components: {
      limiter: {
        name: 'Rate limiter',
        capacity: configured(o.cap ?? 100, o.per ? 'requests/minute' : 'req/s', 'gateway config'),
        over: 'x',
      },
      api: { name: 'API', capacity: measured(1_000, 'req/s'), over: 'x' },
    },
    stages: {
      limiter: limit('limiter', {
        ...(o.burst != null ? { burst: o.burst } : {}),
        ...(o.per ? { per: o.per } : {}),
      }),
      api: pass('api'),
      out: sink(),
    },
    routes: { searches: ['limiter', 'api', 'out'] },
  })

describe('a rate limit with a bucket', () => {
  it('changes no steady figure', () => {
    for (const load of [1, 6]) {
      const a = shop({ burst: 500 }).evaluate({ load })
      const b = shop().evaluate({ load })
      expect(a.components.limiter.util).toBe(b.components.limiter.util)
      expect(a.lost).toEqual(b.lost)
      expect(a.at).toEqual(b.at)
    }
  })

  it('says its size below the limit, and how long it lasts past it', () => {
    expect(shop({ burst: 500 }).evaluate({ load: 1 }).components.limiter.burst).toEqual({ size: 500 })
    // 300 arrive, 100 pass: the 200 above the limit spend the 500 in 2.5 s
    expect(shop({ burst: 500 }).evaluate({ load: 6 }).components.limiter.burst).toEqual({
      size: 500,
      lasts: expect.closeTo(2.5, 9),
    })
    expect(shop().evaluate({ load: 6 }).components.limiter.burst).toBeUndefined()
  })

  it('refuses a bucket on a quota, and a size below 0', () => {
    expect(() => limit('limiter', { per: 'day', burst: 5 })).toThrow('is a quota per day or takes a burst')
    expect(() => shop({ burst: -1 }).evaluate({ load: 1 })).toThrow('the burst of "limiter" is -1 units')
  })
})

describe('a quota per minute', () => {
  it('counts a minute at the peak', () => {
    // 6,000 a minute allowed; at 3× 150 a second arrive, 9,000 a minute: gone after 40 s
    const ev = shop({ per: 'minute', cap: 6_000 }).evaluate({ load: 3 })
    expect(ev.components.limiter.demand).toBeCloseTo(9_000, 9)
    expect(ev.components.limiter.util).toBeCloseTo(1.5, 9)
    expect(ev.components.limiter.quota).toEqual({ per: 'minute', goneAfter: expect.closeTo(40, 9) })
  })
})
