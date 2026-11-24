import { describe, expect, it } from 'vitest'
import { check, defineModel, type Expectation, estimated, lost, measured, p, pass, sink } from '../src'

// 200 quotes a second at 1× through the API to pricing, which takes 100; 10 pings a second to the API alone
const shop = (o: { retry?: number; fallback?: true; stale?: number; breaker?: number; within?: number } = {}) =>
  defineModel({
    load: p.load({ max: 10 }),
    flows: {
      quotes: {
        label: 'Quotes',
        rate: ({ load }) => 200 * load,
        ...(o.retry ? { retry: { times: o.retry } } : {}),
        ...(o.breaker ? { breaker: { opens: o.breaker } } : {}),
        ...(o.fallback ? { fallback: { after: 'api', route: ['stale'] } } : {}),
      },
      pings: { rate: 10 },
    },
    components: {
      api: { name: 'API', capacity: measured(10_000, 'req/s'), over: 'x' },
      pricing: { name: 'Pricing', capacity: estimated(100, 'req/s', { within: o.within ?? 0 }), over: 'quotes fail' },
      stale: { name: 'Stale quotes', capacity: measured(o.stale ?? 5_000, 'req/s'), over: 'quotes fail' },
    },
    stages: {
      api: pass('api'),
      pricing: pass('pricing'),
      stale: pass('stale'),
      failed: lost({ from: ['pricing'] }),
      out: sink(),
    },
    routes: { quotes: ['api', 'pricing', 'out'], pings: ['api', 'out'] },
  })

const said = (m: ReturnType<typeof shop>, e: Expectation) => {
  const [r] = check(m, [e as never])
  return `${r!.outcome}: ${r!.message}`
}

describe('what a flow loses for good', () => {
  it('is what its lost boxes would take together, as a rate and a share of what it sends', () => {
    const ev = shop().evaluate({ load: 1 })
    expect(ev.lost.quotes).toEqual({
      rate: expect.closeTo(100, 9),
      share: expect.closeTo(0.5, 9),
      causes: [{ stage: 'pricing', loss: 'rejected', rate: expect.closeTo(100, 9) }],
    })
    expect(ev.lost.quotes.rate).toBeCloseTo(ev.at.failed.quotes, 9)
    expect(ev.lost.pings).toEqual({ rate: 0, share: 0, causes: [] })
    // under pricing's 100 a second nothing is lost
    expect(shop().evaluate({ load: 0.4 }).lost.quotes).toEqual({ rate: 0, share: 0, causes: [] })
    // retries send the failures again, and as many still fail for good: pricing takes 100 whatever comes
    expect(shop({ retry: 2 }).evaluate({ load: 1 }).lost.quotes.share).toBeCloseTo(0.5, 9)
  })

  it('leaves out what a fallback serves, and counts what the fallback turns away', () => {
    expect(shop({ fallback: true }).evaluate({ load: 1 }).lost.quotes).toEqual({ rate: 0, share: 0, causes: [] })
    // stale quotes take 60 of the 100 that fail
    const full = shop({ fallback: true, stale: 60 }).evaluate({ load: 1 }).lost.quotes
    expect(full.share).toBeCloseTo(0.2, 9)
    expect(full.causes).toEqual([{ stage: 'stale', loss: 'rejected', rate: expect.closeTo(40, 6) }])
  })

  it('counts what a breaker fails fast, at no stage', () => {
    // it admits 125 of 200, of which pricing turns 25 away: 100 are lost either way
    const l = shop({ breaker: 0.2 }).evaluate({ load: 1 }).lost.quotes
    expect(l.share).toBeCloseTo(0.5, 9)
    expect(l.causes).toEqual([
      { stage: 'pricing', loss: 'rejected', rate: expect.closeTo(25, 6) },
      { loss: 'rejected', rate: expect.closeTo(75, 6) },
    ])
    // with a fallback, what fails fast is served too
    expect(shop({ breaker: 0.2, fallback: true, stale: 60 }).evaluate({ load: 1 }).lost.quotes.share).toBeCloseTo(
      0.2,
      6,
    )
  })

  it('is given for a bound and for some flows, as the latency is', () => {
    const m = shop({ within: 0.5 })
    expect(Object.keys(m.lost({ load: 1 }, 'low', ['quotes']))).toEqual(['quotes'])
    // pricing takes 50 at its low bound and 150 at its high one
    expect(m.lost({ load: 1 }, 'low').quotes!.share).toBeCloseTo(0.75, 9)
    expect(m.lost({ load: 1 }, 'high').quotes!.share).toBeCloseTo(0.25, 9)
  })
})

describe('an expectation on what is lost', () => {
  it('holds at the values, for one flow or for each', () => {
    expect(said(shop(), { lost: 0 })).toBe(
      'fail: expected nothing lost, but 50 % of Quotes is lost at 1×, most of it turned away at Pricing',
    )
    expect(said(shop(), { lost: 0.6 })).toBe('pass: 50 % of Quotes is lost at 1×, within 60 %')
    expect(said(shop(), { flow: 'quotes', lost: 0.5 })).toBe('pass: 50 % of Quotes is lost at 1×, within 50 %')
    expect(said(shop(), { flow: 'quotes', lost: 0.1 })).toBe(
      'fail: expected at most 10 % of Quotes lost, but 50 % is lost at 1×, most of it turned away at Pricing',
    )
    expect(said(shop(), { flow: 'pings', lost: 0 })).toBe('pass: nothing of pings is lost at 1×')
    expect(said(shop({ fallback: true }), { lost: 0 })).toBe('pass: nothing is lost at 1×')
    expect(said(shop({ fallback: true, stale: 60 }), { lost: 0 })).toBe(
      'fail: expected nothing lost, but 20 % of Quotes is lost at 1×, most of it turned away at Stale quotes',
    )
    expect(said(shop({ breaker: 0.2 }), { lost: 0 })).toBe(
      'fail: expected nothing lost, but 50 % of Quotes is lost at 1×, most of it failed fast by its breaker',
    )
  })

  it('holds up to a load multiple: where the share is first passed', () => {
    // 1 − 100 / (200 × load) passes 0.1 % at 0.5005× and 10 % at 0.5556×
    const [r] = check(shop(), [{ flow: 'quotes', lost: 0.001, underTarget: 0.4 }])
    expect(r).toMatchObject({ outcome: 'pass', message: 'at most 0.1 % of Quotes is lost up to 0.5×', full: null })
    expect(r!.target!.low).toBeCloseTo(0.5005, 4)
    const [late] = check(shop(), [{ lost: 0.1, underTarget: 1 }])
    expect(late).toMatchObject({
      outcome: 'fail',
      message: 'expected at least 1×, but more than 10 % of Quotes is lost from 0.5×',
    })
    expect(late!.target!.low).toBeCloseTo(0.5556, 4)
    // the pings are lost only once the API is full, at 49.95×
    expect(said(shop(), { flow: 'pings', lost: 0, underTarget: 5 })).toBe('pass: nothing of pings is lost up to 49×')
    expect(said(shop({ fallback: true }), { lost: 0.1, underTarget: 1 })).toBe(
      'pass: at most 10 % of every flow is lost up to 28×',
    )
  })

  it('is inconclusive where it holds only at the high edge of a ±', () => {
    const m = shop({ within: 0.5 })
    const [now] = check(m, [{ lost: 0.4 }])
    expect(now).toMatchObject({
      outcome: 'inconclusive',
      reasons: ['holds only at the high edge of a ±'],
      message:
        'expected at most 40 % of every flow lost, but 75 % of Quotes is lost at 1×, most of it turned away at Pricing',
    })
    const [up] = check(m, [{ lost: 0.1, underTarget: 0.5 }])
    expect(up).toMatchObject({ outcome: 'inconclusive', reasons: ['holds at 0.5× only at the high edge of a ±'] })
    expect(up!.target!.low).toBeCloseTo(0.2778, 4)
    expect(up!.target!.high).toBeCloseTo(0.8333, 4)
  })

  it('takes a share below 1, and no component, notFull or latency', () => {
    const bad = (e: Expectation) => () => defineModel({ ...shop().def, expect: [e] } as never)
    expect(bad({ lost: 1 })).toThrow('a lost of 1: a share from 0, below 1')
    expect(bad({ lost: 0.1, component: 'api' })).toThrow('no component, no notFull and no latency')
    expect(bad({ lost: 0.1, flow: 'quotes', p99: 1 })).toThrow('no component, no notFull and no latency')
    expect(bad({ lost: 0.1, flow: 'nope' })).toThrow('unknown flow "nope"')
    expect(bad({ lost: 0 })).not.toThrow()
  })
})
