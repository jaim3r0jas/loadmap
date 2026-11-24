import { describe, expect, it } from 'vitest'
import { defineModel, lost, measured, p, pass, type RetryRule, sink } from '../src'

// 100 orders a second at 1× through the API to payments and on to the bank
const shop = (
  retry: RetryRule | readonly RetryRule[] | undefined,
  o: { pay?: number; bank?: number; fails?: number; bankFails?: number; breaker?: number } = {},
) =>
  defineModel({
    load: p.load({ max: 10 }),
    flows: {
      orders: {
        rate: ({ load }) => 100 * load,
        ...(retry ? { retry } : {}),
        ...(o.breaker ? { breaker: { opens: o.breaker } } : {}),
      },
    },
    components: {
      api: { name: 'API', capacity: measured(1e6, 'req/s'), over: 'x' },
      pay: {
        name: 'Payments',
        capacity: measured(o.pay ?? 1e6, 'req/s'),
        ...(o.fails ? { fails: o.fails } : {}),
        over: 'x',
      },
      bank: {
        name: 'Bank',
        capacity: measured(o.bank ?? 1e6, 'req/s'),
        ...(o.bankFails ? { fails: o.bankFails } : {}),
        over: 'x',
      },
    },
    stages: {
      api: pass('api'),
      pay: pass('pay'),
      bank: pass('bank'),
      gone: lost({ from: ['api', 'pay', 'bank'] }),
      out: sink(),
    },
    routes: { orders: ['api', 'pay', 'bank', 'out'] },
  })

/** By hand: the attempts at a stage of capacity `cap` that is sent `base` a second and `n` retries of what it turns away. */
const attempts = (base: number, cap: number, n: number) => {
  let x = base
  for (let i = 0; i < 100_000; i++) {
    const share = Math.max(0, 1 - cap / x)
    let sum = 0
    for (let k = 0; k <= n; k++) sum += share ** k
    if (Math.abs(base * sum - x) < 1e-13) break
    x = base * sum
  }
  return x
}

describe('a retry at a hop', () => {
  it('sends what fails there again from there: only the stages from it on see the attempts', () => {
    // payments takes 50 of the 100: with two retries each attempt fails 79 %, and half still fail them all
    const x = attempts(100, 50, 2)
    const ev = shop({ at: 'pay', times: 2 }, { pay: 50 }).evaluate({ load: 1 })
    expect(ev.at.api.orders).toBeCloseTo(100, 9)
    expect(ev.at.pay.orders).toBeCloseTo(x, 6)
    expect(ev.flows.orders).toBeCloseTo(100, 9)
    const r = ev.retry.orders!
    expect(r).toMatchObject({ times: 0, rate: 100, attempts: 100 })
    expect(r.failed).toBeCloseTo(0.5, 9)
    expect(r.hops!.pay).toEqual({
      times: 2,
      attempts: expect.closeTo(x / 100, 8),
      rejected: expect.closeTo(1 - 50 / x, 9),
      retried: 1,
      failed: expect.closeTo(0.5, 9),
    })
    // the same storm the client's own retries make, but the API in front sees none of it
    const top = shop({ times: 2 }, { pay: 50 }).evaluate({ load: 1 })
    expect(top.at.api.orders).toBeCloseTo(x, 6)
    expect(top.at.pay.orders).toBeCloseTo(x, 6)
    // what is lost for good is the same 50: the lost box and ev.lost agree
    expect(ev.lost.orders.share).toBeCloseTo(0.5, 9)
    expect(ev.at.gone.orders).toBeCloseTo(50, 6)
  })

  it('answers a failure that is not about capacity, and lets the rest go on', () => {
    // payments fails a fifth: 1 + 0.2 + 0.04 attempts, and 0.8 % fail all three
    const ev = shop({ at: 'pay', times: 2 }, { fails: 0.2 }).evaluate({ load: 1 })
    expect(ev.retry.orders!.hops!.pay!.attempts).toBeCloseTo(1.24, 12)
    expect(ev.at.pay.orders).toBeCloseTo(124, 9)
    expect(ev.at.bank.orders).toBeCloseTo(99.2, 9)
    expect(ev.lost.orders.share).toBeCloseTo(0.008, 12)
  })

  it('multiplies with the retries around it', () => {
    // the bank fails half its calls. Called twice it fails a quarter; payments, sent three times, fails 1.5625 %;
    // the client, sending twice, 0.0244 %
    const ev = shop([{ times: 1 }, { at: 'pay', times: 2 }, { at: 'bank', times: 1 }], { bankFails: 0.5 }).evaluate({
      load: 1,
    })
    const r = ev.retry.orders!
    expect(r.hops!.bank).toMatchObject({ attempts: expect.closeTo(1.5, 12), failed: expect.closeTo(0.25, 12) })
    expect(r.hops!.pay).toMatchObject({ attempts: expect.closeTo(1.3125, 12), failed: expect.closeTo(0.015625, 12) })
    expect(r.attempts).toBeCloseTo(101.5625, 9)
    expect(r.failed).toBeCloseTo(0.015625 ** 2, 12)
    expect(ev.at.api.orders).toBeCloseTo(101.5625, 9)
    expect(ev.at.pay.orders).toBeCloseTo(101.5625 * 1.3125, 9)
    expect(ev.at.bank.orders).toBeCloseTo(101.5625 * 1.3125 * 1.5, 9)
    expect(ev.lost.orders.share).toBeCloseTo(0.015625 ** 2, 12)
  })

  it('settles with the client’s retries past capacity: still the 50 that fit, after many more attempts', () => {
    const ev = shop([{ times: 2 }, { at: 'pay', times: 2 }], { pay: 50 }).evaluate({ load: 1 })
    expect(ev.lost.orders.share).toBeCloseTo(0.5, 9)
    // the client's attempts are those of two retries against what payments fails for good, each time
    expect(ev.at.api.orders).toBeCloseTo(attempts(100, 50, 2), 6)
    expect(ev.at.pay.orders).toBeGreaterThan(600)
    // and settles over the load range: nothing lost below capacity, nothing but the 50 above
    const m = shop([{ times: 1 }, { at: 'pay', times: 2 }], { pay: 50, fails: 0.1 })
    for (const load of [0.2, 0.45, 0.5, 0.55, 1, 3, 10]) {
      const l = m.evaluate({ load }).lost.orders
      expect(Number.isFinite(l.share) && l.share >= 0 && l.share <= 1, `at ${load}×`).toBe(true)
    }
  })

  it('shares what fails for good out by the rules around each stage', () => {
    // the API in front turns 10 away, which no rule sends again; the bank fails half, and payments calls four times
    const base = shop({ at: 'pay', times: 3 }, { bankFails: 0.5 })
    const m = defineModel({
      ...base.def,
      components: { ...base.def.components, api: { name: 'API', capacity: measured(90, 'req/s'), over: 'x' } },
    } as never)
    const ev = m.evaluate({ load: 1 })
    expect(ev.lost.orders!.causes).toEqual([
      { stage: 'api', loss: 'rejected', rate: expect.closeTo(10, 9) },
      { stage: 'bank', loss: 'failed', rate: expect.closeTo(90 * 0.5 ** 4, 9) },
    ])
    expect(ev.lost.orders!.share).toBeCloseTo(0.1 + 0.9 * 0.5 ** 4, 12)
    expect(ev.retry.orders!.failed).toBeCloseTo(0.1 + 0.9 * 0.5 ** 4, 12)
  })

  it('counts a hop’s failures of what actually reaches it: behind a full stage it retries nothing it need not', () => {
    // the API lets 50 of 100 through, and payments takes 60: nothing fails at payments, with or without its retries
    const base = shop({ at: 'pay', times: 2 }, { pay: 60 })
    const m = defineModel({
      ...base.def,
      components: { ...base.def.components, api: { name: 'API', capacity: measured(50, 'req/s'), over: 'x' } },
    } as never)
    const ev = m.evaluate({ load: 1 })
    expect(ev.retry.orders!.hops!.pay).toMatchObject({ attempts: 1, rejected: 0, failed: 0 })
    expect(ev.lost.orders!.share).toBeCloseTo(0.5, 12)
  })

  it('takes a budget of the units that reach its stage', () => {
    const ev = shop({ at: 'pay', times: 3, budget: 0.1 }, { pay: 50 }).evaluate({ load: 1 })
    expect(ev.at.pay.orders).toBeCloseTo(110, 9)
    expect(ev.retry.orders!.hops!.pay!.retried).toBeLessThan(1)
  })

  it('is one rule a stage, at a stage on the way, and not with a breaker', () => {
    expect(() => shop([{ times: 1 }, { times: 2 }]).evaluate()).toThrow('has two retry rules with no stage')
    expect(() =>
      shop([
        { at: 'pay', times: 1 },
        { at: 'pay', times: 2 },
      ]).evaluate(),
    ).toThrow('has two retry rules at "pay"')
    expect(() => shop({ at: 'nope', times: 1 }).evaluate()).toThrow('retries at unknown stage "nope"')
    expect(() => shop({ at: 'gone', times: 1 }).evaluate()).toThrow('retries at "gone", which is not on its way')
    expect(() => shop({ at: 'pay', times: 1 }, { breaker: 0.5 }).evaluate()).toThrow('a breaker and a retry at a hop')
    // a rule of no retries is none
    expect(shop({ at: 'pay', times: 0 }, { pay: 50 }).evaluate().retry.orders).toBeUndefined()
  })
})
