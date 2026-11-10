import { describe, expect, it } from 'vitest'
import { defineModel, measured, p, pass } from '../src'

// 100 req/s into a queue of 200 with 10 ms of service: at half, 20 ms on average, exponential
const api = (o: { timeout?: number; retry?: number; service?: number } = {}) =>
  defineModel({
    load: p.load({ max: 10 }),
    flows: {
      req: {
        rate: ({ load }) => 100 * load,
        timeout: o.timeout,
        ...(o.retry && { retry: { times: o.retry } }),
      },
    },
    components: {
      api: { name: 'API', capacity: measured(200, 'req/s'), service: o.service ?? 0.01, over: 'x' },
    },
    stages: { api: pass('api') },
    routes: { req: ['api'] },
  })

describe('a timeout', () => {
  it('fails the share of units slower than it', () => {
    // P(T > 50 ms) for a mean of 20 ms: e^(−2.5)
    const l = api({ timeout: 0.05 }).evaluate({ load: 1 }).latency.req!
    expect(l.timedOut).toBeCloseTo(Math.exp(-2.5), 12)
    // without one, nothing times out
    expect(api().evaluate({ load: 1 }).latency.req!.timedOut).toBeUndefined()
  })

  it('sends the slow ones again, and the retries slow everything down: the least fixed point', () => {
    // a = 100 (1 + p), p = e^(−5 (1 − a / 200)): a = 110.7355 (scipy brentq), the least root below the one at 200
    const r = api({ timeout: 0.05, retry: 1 }).evaluate({ load: 1 }).retry.req!
    expect(r.attempts).toBeCloseTo(110.73552463907909, 6)
    expect(r.rejected).toBeCloseTo(0.10735524639079089, 6)
    // one retry: a unit fails when both its tries are too slow
    expect(r.failed).toBeCloseTo(0.10735524639079089 ** 2, 6)
  })

  it('refuses a time that cannot be, and a timeout with no latency to time on its way', () => {
    expect(() => api({ timeout: -1 })).toThrow('loadmap: flow "req" times out after -1 s: a time above 0')
    // another flow's way has a service; this one's has none
    const twoWays = () =>
      defineModel({
        load: p.load({ max: 10 }),
        flows: { req: { rate: 1 }, ping: { rate: 1, timeout: 1 } },
        components: {
          api: { name: 'API', capacity: measured(200, 'req/s'), service: 0.01, over: 'x' },
          edge: { name: 'Edge', capacity: measured(200, 'req/s'), over: 'x' },
        },
        stages: { api: pass('api'), edge: pass('edge') },
        routes: { req: ['api'], ping: ['edge'] },
      })
    expect(twoWays).toThrow('loadmap: flow "ping" has a timeout but no latency: no stage on its way has a service')
  })

  it('settles on the least fixed point even where the share is shaped to meet the attempts more than once', () => {
    // with three retries the share rises steeply past the knee: the plain rounds' answer, step by step, against the
    // rounds with their secant steps. A doubling step would jump past the least fixed point to the collapse
    for (const load of [1.05, 1.1, 1.15, 1.2, 1.3]) {
      const r = api({ timeout: 0.05, retry: 3 }).evaluate({ load }).retry.req!
      // the answer holds itself: the share timed out at these attempts gives back the same attempts
      const rho = r.attempts / 200
      const late = rho >= 1 ? 1 : Math.exp(-0.05 / (0.01 / (1 - rho)))
      const excess = late >= 1 ? 3 : (late * (1 - late ** 3)) / (1 - late)
      expect(r.attempts / (100 * load), String(load)).toBeCloseTo(1 + Math.min(excess, 3), 5)
    }
  })
})
