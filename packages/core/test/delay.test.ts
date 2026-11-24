import { describe, expect, it } from 'vitest'
import { check, type DelayDef, defineModel, measured, p, pass, sink } from '../src'
import { beyond, quantile } from '../src/latency'

// 100 req/s (and 1 other) through A at about half of 200: 10 ms when idle, 20.2 ms there
const shop = (delays: readonly DelayDef[], timeout?: number) =>
  defineModel({
    load: p.load({ max: 10 }),
    params: { far: p.switch({ label: 'Far', default: false }) },
    flows: { req: { rate: ({ load }) => 100 * load, ...(timeout ? { timeout } : {}) }, other: { rate: 1 } },
    components: { a: { name: 'A', capacity: measured(200, 'req/s'), service: 0.01, over: 'x' } },
    stages: { a: pass('a'), out: sink() },
    routes: { req: ['a', 'out'], other: ['a', 'out'] },
    delays: delays as never,
  })
const W = 0.01 / (1 - 101 / 200)

describe('a delay on a hop', () => {
  it('shifts a way: no unit is done before it, and the queues are fitted past it', () => {
    // one queue behind 80 ms is a shifted exponential, exactly
    const way = { share: 1, mean: 0.1, variance: 0.02 ** 2, fixed: 0.08 }
    expect(quantile([way], 0.5)).toBeCloseTo(0.08 + 0.02 * Math.log(2), 10)
    expect(quantile([way], 0.99)).toBeCloseTo(0.08 + 0.02 * Math.log(100), 10)
    expect(beyond([way], 0.07)).toBe(1)
    expect(beyond([way], 0.2)).toBeCloseTo(Math.exp(-0.12 / 0.02), 10)
    // a way that is all delay is done at its mean
    expect(quantile([{ share: 1, mean: 0.08, variance: 0, fixed: 0.08 }], 0.99)).toBeCloseTo(0.08, 9)
  })

  it('adds to the latency of the flows that go the hop, into a first stage or between two', () => {
    const m = shop([
      { to: 'a', delay: 0.05, flows: ['req'] },
      { from: 'a', to: 'out', delay: 0.03 },
    ])
    const l = m.evaluate({ load: 1 }).latency
    expect(l.req!.mean).toBeCloseTo(0.08 + W, 12)
    expect(l.req!.p50).toBeCloseTo(0.08 + W * Math.log(2), 9)
    expect(l.req!.p99).toBeCloseTo(0.08 + W * Math.log(100), 9)
    // the other flow takes the hop out, not the one in
    expect(l.other!.mean).toBeCloseTo(0.03 + W, 12)
    expect(l.other!.p99).toBeCloseTo(0.03 + W * Math.log(100), 9)
    // two delays on one hop add up
    const twice = shop([
      { to: 'a', delay: 0.05 },
      { to: 'a', delay: 0.01 },
    ])
    expect(twice.evaluate({ load: 1 }).latency.req!.mean).toBeCloseTo(0.06 + W, 12)
  })

  it('counts toward the timeout, and reads the parameters', () => {
    const m = shop(
      [
        { to: 'a', delay: ({ far }: { far: boolean }) => (far ? 0.15 : 0.05) } as never,
        { from: 'a', to: 'out', delay: 0.03 },
      ],
      0.2,
    )
    expect(m.evaluate({ load: 1 }).latency.req!.timedOut).toBeCloseTo(Math.exp(-(0.2 - 0.08) / W), 9)
    expect(m.evaluate({ load: 1, far: true }).latency.req!.timedOut).toBeCloseTo(Math.exp(-(0.2 - 0.18) / W), 9)
    expect(check(m, [{ flow: 'req', p99: 0.2, underTarget: 1.2 }])[0]!.message).toBe(
      'the p99 of req stays under 200 ms up to 1.2×',
    )
    // a timeout needs a time: a delay on the flow's way is one
    const bare = (delays: readonly DelayDef[]) => () =>
      defineModel({
        load: p.load({ max: 10 }),
        flows: { req: { rate: 1, timeout: 1 } },
        components: { a: { name: 'A', capacity: measured(200, 'req/s'), over: 'x' } },
        stages: { a: pass('a'), out: sink() },
        routes: { req: ['a', 'out'] },
        delays: delays as never,
      })
    expect(bare([])).toThrow('has a timeout but no latency')
    // one on a hop the flow does not go is none; one of 0 s at these values still is
    expect(bare([{ from: 'out', to: 'a', delay: 0.3 }])).toThrow('has a timeout but no latency')
    expect(bare([{ to: 'a', delay: 0 }])().evaluate().latency.req).toMatchObject({ mean: 0, timedOut: 0 })
    expect(bare([{ to: 'a', delay: 0.3 }])().evaluate().latency.req).toMatchObject({
      mean: 0.3,
      p99: expect.closeTo(0.3, 9),
    })
  })

  it('names stages and flows that are there, and is a time from 0 up', () => {
    expect(() => shop([{ to: 'nope', delay: 1 }])).toThrow('the delay into nope names unknown stage "nope"')
    expect(() => shop([{ from: 'x', to: 'a', delay: 1 }])).toThrow('the delay x -> a names unknown stage "x"')
    expect(() => shop([{ to: 'a', delay: 1, flows: ['zz'] }])).toThrow('the delay into a names unknown flow "zz"')
    expect(() => shop([{ to: 'a', delay: -1 }]).evaluate().latency.req).toThrow('is -1 s: a time from 0 up')
  })
})
