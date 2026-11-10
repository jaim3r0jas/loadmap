import { describe, expect, it } from 'vitest'
import { cache, check, defineModel, estimated, measured, p, pass, sink } from '../src'
import { gammaP, latencyOf, quantile } from '../src/latency'

describe('the gamma distribution', () => {
  it('agrees with scipy', () => {
    // scipy.special.gammainc
    expect(gammaP(2.5, 3)).toBeCloseTo(0.6937810815867212, 12)
    expect(gammaP(0.5, 0.1)).toBeCloseTo(0.34527915398142317, 12)
    expect(gammaP(10, 15)).toBeCloseTo(0.9301463393005901, 12)
    expect(gammaP(1, 2)).toBeCloseTo(0.8646647167633873, 12)
    expect([gammaP(3, 0), gammaP(3, Number.POSITIVE_INFINITY)]).toEqual([0, 1])
  })

  it('gives the percentiles of a way, and of ways mixed by share, as scipy does', () => {
    // one queue: exponential, p99 = mean × ln 100
    expect(quantile([{ share: 1, mean: 0.01, variance: 1e-4 }], 0.99)).toBeCloseTo(0.01 * Math.log(100), 12)
    // two queues of 10 and 30 ms: mean 40 ms, variance 0.001, a gamma of shape 1.6 (scipy.stats.gamma.ppf)
    const two = { share: 1, mean: 0.04, variance: 0.001 }
    expect(quantile([two], 0.5)).toBeCloseTo(0.03204490343477031, 10)
    expect(quantile([two], 0.95)).toBeCloseTo(0.1019834906702118, 10)
    expect(quantile([two], 0.99)).toBeCloseTo(0.14679841222476767, 10)
    // a fifth answered after the first queue: brentq on the mixed distribution
    expect(
      quantile(
        [
          { share: 0.2, mean: 0.01, variance: 1e-4 },
          { ...two, share: 0.8 },
        ],
        0.99,
      ),
    ).toBeCloseTo(0.14067133052529465, 10)
    // a way past full holds the percentiles it reaches: a share of 0.5 that never ends has no p99, and a p50 at once
    const stuck = [
      { share: 0.5, mean: Number.POSITIVE_INFINITY, variance: Number.POSITIVE_INFINITY },
      { share: 0.5, mean: 0, variance: 0 },
    ]
    expect(quantile(stuck, 0.99)).toBe(Number.POSITIVE_INFINITY)
    expect(quantile(stuck, 0.4)).toBeLessThan(1e-9)
  })
})

describe('a flow’s latency', () => {
  // 100 req/s: a at half of 200 (5 ms when idle: 10 ms), a cache answering a fifth, b at half of 160 (15 ms: 30 ms)
  const shop = (o: { serviceB?: number; within?: number } = {}) =>
    defineModel({
      load: p.load({ max: 10 }),
      flows: { req: { rate: ({ load }) => 100 * load }, ping: { rate: 1 } },
      components: {
        a: { name: 'A', capacity: measured(200, 'req/s'), service: 0.005, over: 'x' },
        c: { name: 'Cache', capacity: measured(1e6, 'req/s'), over: 'x' },
        b: {
          name: 'B',
          capacity: estimated(160, 'req/s', { within: o.within ?? 0 }),
          service: o.serviceB ?? 0.015,
          over: 'x',
        },
      },
      stages: { a: pass('a'), c: cache({ hit: 0.2, component: 'c' }), b: pass('b'), out: sink() },
      routes: { req: ['a', 'c', 'b', 'out'], ping: ['out'] },
    })

  it('adds up its queues, leaves the cache hits after the cache, and grows with the load', () => {
    const at1 = shop().evaluate({ load: 1 }).latency
    // the pings go straight out: a at 100 of 200, b at 80 of 160, both at half
    expect(at1.req!.mean).toBeCloseTo(0.2 * 0.01 + 0.8 * 0.04, 12)
    expect(at1.req!.p99).toBeCloseTo(0.14067133052529465, 9)
    // a flow on no stage with a service has no latency
    expect(at1.ping).toBeNull()
    // at 1.6×: a at 0.8 (25 ms), b at 0.8 (75 ms)
    const busy = shop().evaluate({ load: 1.6 }).latency.req!
    expect(busy.mean).toBeCloseTo(0.2 * 0.025 + 0.8 * 0.1, 12)
    // past full, the units that reach b never get through
    expect(shop().evaluate({ load: 2.5 }).latency.req!.p99).toBe(Number.POSITIVE_INFINITY)
  })

  it('is null without a service anywhere, reads a bound, and refuses a time below 0', () => {
    const plain = defineModel({
      load: p.load({ max: 10 }),
      flows: { req: { rate: 100 } },
      components: { a: { name: 'A', capacity: measured(200, 'req/s'), over: 'x' } },
      stages: { a: pass('a') },
      routes: { req: ['a'] },
    })
    expect(plain.evaluate().latency).toEqual({ req: null })
    expect(shop().latency({ load: 1 }).req!.mean).toBeCloseTo(0.034, 12)
    expect(() => shop({ serviceB: -1 }).evaluate().latency).toThrow(
      'loadmap: component "b" takes -1 s a unit: a service time from 0 up',
    )
  })

  it('is held under a time by an expectation, on the pessimistic edge', () => {
    // both queues at L / 2: the p99 is 0.14067 × 0.5 / (1 − L / 2), 500 ms at L = 2 (1 − 0.14067) = 1.7187
    const [ok, short, now] = check(shop(), [
      { flow: 'req', p99: 0.5, target: 1.5 },
      { flow: 'req', p99: 0.5, target: 2 },
      { flow: 'req', p99: 0.5 },
    ])
    expect(ok!.outcome).toBe('pass')
    expect(ok!.target!.low).toBeCloseTo(2 * (1 - 0.14067133052529465), 4)
    expect(ok!.message).toBe('the p99 of req stays under 500 ms up to 1.7×')
    expect(short!.outcome).toBe('fail')
    expect(short!.message).toBe('expected at least 2×, but the p99 of req passes 500 ms at 1.7×')
    // at the values (1×)
    expect(now!.outcome).toBe('pass')
    expect(now!.message).toBe('the p99 of req is 140.7 ms at 1×, under 500 ms')
    // B ± 30 %: at 1.5× its low bound of 112 req/s is past full, its high bound is not
    const [edge] = check(shop({ within: 0.3 }), [{ flow: 'req', p99: 0.5, target: 1.5 }])
    expect(edge!.outcome).toBe('inconclusive')
    expect(edge!.reasons).toEqual(['holds at 1.5× only at the high edge of a ±'])
  })

  it('refuses an expectation it cannot read', () => {
    expect(() => check(shop(), [{ flow: 'req', p50: 0.1, p99: 0.5 }])).toThrow(
      'loadmap: a latency expectation names a flow and one of p50, p95 or p99',
    )
    expect(() => check(shop(), [{ flow: 'req', p99: 0.5, component: 'a' }])).toThrow('takes no component and no full')
    expect(() => check(shop(), [{ flow: 'reqs', p99: 0.5 }])).toThrow('loadmap: no flow "reqs"')
    // a flow without one fails on its own line, and the other expectations keep their results
    const [none, fine] = check(shop(), [
      { flow: 'ping', p99: 0.5 },
      { flow: 'req', p99: 0.5 },
    ])
    expect([none!.outcome, none!.message]).toEqual([
      'fail',
      '"ping" has no latency: no stage on its way has a service time',
    ])
    expect(fine!.outcome).toBe('pass')
    // a model's own expectations are refused when it is defined
    const model = (e: object) => () =>
      defineModel({
        load: p.load({ max: 10 }),
        flows: { req: { rate: 1 } },
        components: { a: { name: 'A', capacity: measured(10, 'req/s'), over: 'x' } },
        stages: { a: pass('a') },
        routes: { req: ['a'] },
        expect: [e],
      })
    expect(model({ flow: 'req', target: 2 })).toThrow('holds a latency: a flow and one of p50, p95 or p99')
    expect(model({ p99: 0.5, target: 2 })).toThrow('holds a latency: a flow and one of p50, p95 or p99')
    expect(model({ flow: 'req', p99: 0.5, full: 2 })).toThrow('holds the latency of "req": no component and no full')
    expect(model({ flow: 'reqs', p99: 0.5 })).toThrow('names unknown flow "reqs"')
  })

  it('cannot know the time of a component without a figure, and says so', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { req: { rate: 10 } },
      components: {
        a: { name: 'A', capacity: measured(100, 'req/s'), service: 0.01, over: 'x' },
        b: {
          name: 'Brokers',
          capacity: { value: Number.NaN, unit: 'req/s', provenance: 'published', missing: 'for 6 brokers' },
          service: 0.01,
          over: 'x',
        },
      },
      stages: { a: pass('a'), b: pass('b') },
      routes: { req: ['a', 'b'] },
    })
    const l = m.evaluate().latency.req!
    // A alone: 10 ms at a tenth, 11.1 ms
    expect(l.mean).toBeCloseTo(0.01 / 0.9, 12)
    expect(l.unknown).toEqual(['Brokers'])
    const [r] = check(m, [{ flow: 'req', p99: 1 }])
    expect(r!.outcome).toBe('inconclusive')
    expect(r!.reasons).toEqual(['Brokers: its time is not known, so it counts as none'])
  })
})

describe('the edges of the percentiles', () => {
  it('has a mean when a way no unit takes has no end, and no p99 when what never ends is a hundredth', () => {
    const ways = [
      { share: 0, mean: Number.POSITIVE_INFINITY, variance: Number.POSITIVE_INFINITY },
      { share: 1, mean: 0.01, variance: 1e-4 },
    ]
    expect(latencyOf(ways).mean).toBe(0.01)
    // 0.99 answered before, the rest past full: 1 − 0.99 is 0.010000000000000009, still no p99
    const stuck = [
      { share: 0.99, mean: 0.01, variance: 1e-4 },
      { share: 1 - 0.99, mean: Number.POSITIVE_INFINITY, variance: Number.POSITIVE_INFINITY },
    ]
    expect(quantile(stuck, 0.99)).toBe(Number.POSITIVE_INFINITY)
  })
})
