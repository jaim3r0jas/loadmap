import { describe, expect, it } from 'vitest'
import { cache, configured, defineModel, measured, p, pass, sink } from '../src'

// 40 orders a second through the API (5 ms) to payments (100 ms when idle, 100 a second), 10 ms apart; each holds one
// of 20 connections from the API until payments has answered, and 5 ms more
const shop = (o: { timeout?: number; held?: number | null; own?: true; hit?: number } = {}) =>
  defineModel({
    load: p.load({ max: 10 }),
    flows: {
      orders: { rate: ({ load }) => 40 * load, ...(o.timeout ? { timeout: o.timeout } : {}) },
      pings: { rate: 1 },
    },
    components: {
      api: { name: 'API', capacity: measured(2_000, 'req/s'), service: 0.005, over: 'x' },
      payments: { name: 'Payments', capacity: measured(100, 'req/s'), service: 0.1, over: 'x' },
      lookups: { name: 'Lookups', capacity: measured(1e6, 'req/s'), over: 'x' },
      conns: {
        name: 'Connections',
        ...(o.held === null ? {} : { held: o.held ?? 0.005 }),
        on: ['api'],
        through: o.own ? ['held', 'payments'] : ['api', 'payments'],
        capacity: configured(20, 'connections', 'the pool'),
        ...(o.own ? { service: 0.001 } : {}),
        over: 'requests wait',
      },
    },
    stages: {
      api: pass('api'),
      seen: cache({ hit: o.hit ?? 0, component: 'lookups' }),
      held: pass('conns'),
      payments: pass('payments'),
      out: sink(),
    },
    routes: {
      orders: o.own ? ['api', 'held', 'payments', 'out'] : ['api', 'seen', 'payments', 'out'],
      pings: ['api', 'out'],
    },
    delays: [{ from: 'seen', to: 'payments', delay: 0.01 }],
  })
// the API at 40 × load + 1 of 2,000, payments at 40 × load of 100
const time = (load: number) => 0.005 / (1 - (40 * load + 1) / 2000) + 0.01 + 0.1 / (1 - (40 * load) / 100)

describe('a slot held through a stretch of the way', () => {
  it('is held for the time the stretch takes, on top of held: the pool follows the dependency', () => {
    const m = shop()
    for (const load of [0.5, 1, 2]) {
      const c = m.evaluate({ load }).components.conns
      expect(c.held!.orders).toBeCloseTo(0.005 + time(load), 12)
      // Little's law, the one ping a second with it
      expect(c.demand).toBeCloseTo(40 * load * c.held!.orders! + c.held!.pings!, 9)
    }
    // the pings hold a slot at the API too, for the API's time: they go no further
    expect(m.evaluate({ load: 1 }).components.conns.held!.pings).toBeCloseTo(0.005 + 0.005 / (1 - 41 / 2000), 12)
    // the pool is gone at 1.6×, where payments is at 65 %: payments itself lasts to 2.5×
    const ev = m.evaluate()
    expect(ev.components.conns.full).toBeCloseTo(1.6282, 3)
    expect(ev.components.payments.full).toBeCloseTo(2.5, 6)
    // without a held of its own it is the stretch alone
    expect(shop({ held: null }).evaluate({ load: 1 }).components.conns.held!.orders).toBeCloseTo(time(1), 12)
  })

  it('is bounded by the flow’s timeout, and stays a number past where a stage is full', () => {
    const m = shop({ timeout: 0.3 })
    expect(m.evaluate({ load: 1 }).components.conns.held!.orders).toBeCloseTo(0.005 + time(1), 12)
    expect(m.evaluate({ load: 2.4 }).components.conns.held!.orders).toBeCloseTo(0.305, 12)
    expect(m.evaluate({ load: 5 }).components.conns.held!.orders).toBeCloseTo(0.305, 12)
    // no timeout: payments past full counts a million service times, so the pool is gone and the demand is a number
    const c = shop().evaluate({ load: 5 }).components.conns
    expect(c.held!.orders).toBeGreaterThan(1e5)
    expect(Number.isFinite(c.demand)).toBe(true)
    expect(c.state).toBe('over')
  })

  it('ends at a cache for what the cache answers', () => {
    // a quarter answered at the cache go no further: they hold for the API's time alone
    const all = shop().evaluate({ load: 1 }).components.conns.held!.orders!
    const some = shop({ hit: 0.25 }).evaluate({ load: 1 }).components.conns.held!.orders!
    const api = 0.005 / (1 - 41 / 2000)
    expect(some - 0.005 - api).toBeCloseTo(0.75 * (0.01 + 0.1 / (1 - 30 / 100)), 12)
    expect(some).toBeLessThan(all)
  })

  it('names two stages there are, and no timed stage it runs itself', () => {
    const bad = (through: readonly [string, string]) => () =>
      defineModel({
        ...shop().def,
        components: { ...shop().def.components, conns: { ...shop().def.components.conns, through } },
      } as never)
    expect(bad(['api', 'nope'])).toThrow('component "conns" is held through unknown stage "nope"')
    expect(() => shop({ own: true }).evaluate()).toThrow(
      'component "conns" is held through "held", which it runs itself: its time there would depend on its own slots',
    )
  })
})
