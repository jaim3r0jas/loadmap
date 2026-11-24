import { describe, expect, it } from 'vitest'
import { defineModel, lost, measured, p, pass, sink } from '../src'

// 200 quotes a second at 1× to pricing, which takes 100; a breaker that opens past 20 % failing
const shop = (o: { fallback?: true; opens?: number; retry?: { times: number; budget?: number } } = {}) =>
  defineModel({
    load: p.load({ max: 10 }),
    flows: {
      quotes: {
        rate: ({ load }) => 200 * load,
        breaker: { opens: o.opens ?? 0.2 },
        ...(o.retry ? { retry: o.retry } : {}),
        ...(o.fallback ? { fallback: { after: 'api', route: ['stale'] } } : {}),
      },
    },
    components: {
      api: { name: 'API', capacity: measured(10_000, 'req/s'), over: 'x' },
      pricing: { name: 'Pricing', capacity: measured(100, 'req/s'), over: 'quotes fail' },
      stale: { name: 'Stale', capacity: measured(5_000, 'req/s'), over: 'x' },
    },
    stages: {
      api: pass('api'),
      pricing: pass('pricing'),
      stale: pass('stale'),
      failed: lost({ from: ['pricing'] }),
      out: sink(),
    },
    routes: { quotes: ['api', 'pricing', 'out'] },
  })

describe('a breaker', () => {
  it('admits the share at which the failures among the admitted are where it opens', () => {
    const ev = shop().evaluate({ load: 1 })
    // 1 − 100 / (200 α) = 0.2: α = 0.625, so 125 a second reach pricing and 75 fail fast
    expect(ev.breakers.quotes!.admitted).toBeCloseTo(0.625, 9)
    expect(ev.breakers.quotes!.failedFast).toBeCloseTo(75, 6)
    expect(ev.flows.quotes).toBeCloseTo(125, 6)
    expect(ev.at.failed.quotes).toBeCloseTo(25, 6)
    expect(ev.components.pricing.util).toBeCloseTo(1.25, 6)
  })

  it('stays closed while the failures are under where it opens', () => {
    const ev = shop().evaluate({ load: 0.5 })
    expect(ev.breakers.quotes!.admitted).toBe(1)
    expect(ev.flows.quotes).toBeCloseTo(100, 9)
  })

  it('sends what it fails fast to the fallback, with what fails at pricing', () => {
    const ev = shop({ fallback: true }).evaluate({ load: 1 })
    expect(ev.at.stale.quotes).toBeCloseTo(100, 6)
    expect(ev.at.failed.quotes).toBeCloseTo(0, 9)
  })

  it('takes no retries, and opens past a share between 0 and 1', () => {
    const bad = (flow: Record<string, unknown>) => () =>
      defineModel({
        load: p.load({ max: 4 }),
        flows: { f: { rate: 1, ...flow } },
        components: { a: { name: 'A', capacity: measured(1, 'r/s'), over: 'x' } },
        stages: { a: pass('a'), out: sink() },
        routes: { f: ['a', 'out'] },
      }).evaluate()
    // its client's retries go through it; a hop's would start again behind it
    expect(bad({ breaker: { opens: 0.5 }, retry: { times: 1 } })).not.toThrow()
    expect(bad({ breaker: { opens: 0.5 }, retry: { at: 'a', times: 1 } })).toThrow('a breaker and a retry at a hop')
    // a retry rule switched off at these values is none
    expect(bad({ breaker: { opens: 0.5 }, retry: () => undefined })).not.toThrow()
    expect(bad({ breaker: { opens: 1.5 } })).toThrow('above 0 and below 1')
  })

  describe('with its client retrying', () => {
    // each attempt goes through the breaker. It admits the 125 a second at which pricing fails 20 %, whatever is sent:
    // so an attempt fails 1 − 100 ÷ attempts, as it would without the breaker, and the attempts settle where they did
    const attempts = (() => {
      let x = 200
      for (let i = 0; i < 100_000; i++) {
        const q = Math.max(0, 1 - 100 / x)
        const next = 200 * (1 + q + q * q)
        if (Math.abs(next - x) < 1e-12) break
        x = next
      }
      return x
    })()

    it('admits the same rate, and keeps the storm from the stages behind it', () => {
      const ev = shop({ retry: { times: 2 } }).evaluate({ load: 1 })
      expect(ev.retry.quotes!.attempts).toBeCloseTo(attempts, 6)
      expect(ev.retry.quotes!.failed).toBeCloseTo(0.5, 9)
      // pricing sees the 125 the breaker admits, not the 485 the client sends
      expect(ev.flows.quotes).toBeCloseTo(125, 6)
      expect(ev.at.pricing.quotes).toBeCloseTo(125, 6)
      expect(ev.breakers.quotes).toEqual({
        opens: 0.2,
        rate: 200,
        admitted: expect.closeTo(125 / attempts, 9),
        failedFast: expect.closeTo(attempts - 125, 5),
      })
      // without the breaker every attempt reaches pricing
      const open = shop({ retry: { times: 2 }, opens: 0.9 }).evaluate({ load: 1 })
      expect(open.breakers.quotes!.admitted).toBe(1)
      expect(open.at.pricing.quotes).toBeCloseTo(attempts, 6)
    })

    it('loses the 100 that do not fit, most of them failed fast, and a fallback serves them', () => {
      const ev = shop({ retry: { times: 2 } }).evaluate({ load: 1 })
      expect(ev.lost.quotes.share).toBeCloseTo(0.5, 9)
      // what fails for good is shared with the attempts failed fast: 25 of the 385 failing attempts are pricing's
      const atPricing = (100 * 25) / (attempts - 100)
      expect(ev.lost.quotes.causes).toEqual([
        { stage: 'pricing', loss: 'rejected', rate: expect.closeTo(atPricing, 6) },
        { loss: 'rejected', rate: expect.closeTo(100 - atPricing, 6) },
      ])
      expect(ev.at.failed.quotes).toBeCloseTo(atPricing, 6)
      const fb = shop({ retry: { times: 2 }, fallback: true }).evaluate({ load: 1 })
      expect(fb.fallbacks.quotes!.rate).toBeCloseTo(100, 6)
      expect(fb.lost.quotes.share).toBeCloseTo(0, 9)
    })

    it('changes nothing below where anything fails, and takes a budget', () => {
      const calm = shop({ retry: { times: 2 } }).evaluate({ load: 0.4 })
      expect(calm.retry.quotes).toMatchObject({ attempts: 80, rejected: 0, failed: 0 })
      expect(calm.breakers.quotes!.admitted).toBe(1)
      const ev = shop({ retry: { times: 3, budget: 0.1 } }).evaluate({ load: 1 })
      expect(ev.retry.quotes!.attempts).toBeCloseTo(220, 9)
      expect(ev.flows.quotes).toBeCloseTo(125, 6)
      expect(ev.lost.quotes.share).toBeCloseTo(0.5, 9)
    })
  })
})
