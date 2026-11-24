import { describe, expect, it } from 'vitest'
import { check, defineModel, fanout, lost, measured, p, pass, sink } from '../src'

// 100 orders a second at 1× through the API, which fails a share of them whatever the load, to a database of 500
const shop = (o: { retry?: number; breaker?: number; fallback?: true; fails?: number } = {}) =>
  defineModel({
    load: p.load({ max: 10 }),
    params: { bad: p.switch({ label: 'Bad deploy', default: false }) },
    flows: {
      orders: {
        label: 'orders',
        rate: ({ load }) => 100 * load,
        ...(o.retry ? { retry: { times: o.retry } } : {}),
        ...(o.breaker ? { breaker: { opens: o.breaker } } : {}),
        ...(o.fallback ? { fallback: { after: 'gate', route: ['stale'] } } : {}),
      },
    },
    components: {
      gate: { name: 'Gate', capacity: measured(10_000, 'req/s'), over: 'x' },
      api: {
        name: 'API',
        capacity: measured(1_000, 'req/s'),
        fails: o.fails ?? (({ bad }: { bad: boolean }) => (bad ? 0.2 : 0.02)),
        over: 'x',
      },
      db: { name: 'Database', capacity: measured(500, 'req/s'), over: 'x' },
      stale: { name: 'Stale', capacity: measured(10_000, 'req/s'), over: 'x' },
    },
    stages: {
      gate: pass('gate'),
      api: pass('api'),
      db: pass('db'),
      stale: pass('stale'),
      errors: lost({ from: ['api'], takes: ['failed'] }),
      out: sink(),
    },
    routes: { orders: ['gate', 'api', 'db', 'out'] },
  })

describe('a component that fails a share of its units', () => {
  it('loses them as failed, and the stages after it are reached by the rest', () => {
    const ev = shop().evaluate({ load: 1 })
    expect(ev.lost.orders).toEqual({
      rate: expect.closeTo(2, 9),
      share: expect.closeTo(0.02, 9),
      causes: [{ stage: 'api', loss: 'failed', rate: expect.closeTo(2, 9) }],
    })
    expect(ev.at.errors.orders).toBeCloseTo(2, 9)
    expect(ev.at.api.orders).toBeCloseTo(100, 9)
    expect(ev.at.db.orders).toBeCloseTo(98, 9)
    expect(ev.components.db.util).toBeCloseTo(98 / 500, 9)
    expect(ev.stages.api.fails).toBeCloseTo(0.02, 12)
    expect(ev.stages.db.fails).toBeUndefined()
    // it reads the parameters: a scenario can be the bad deploy
    expect(shop().evaluate({ load: 1, bad: true }).lost.orders.share).toBeCloseTo(0.2, 9)
    // past the database's capacity both count: 16 of 800 fail, and the database turns away 284 of the 784 left
    const over = shop().evaluate({ load: 8 }).lost.orders
    expect(over.causes).toEqual([
      { stage: 'api', loss: 'failed', rate: expect.closeTo(16, 6) },
      { stage: 'db', loss: 'rejected', rate: expect.closeTo(284, 6) },
    ])
  })

  it('is sent again by the retries, opens a breaker, and goes to a fallback', () => {
    // two retries: a unit fails for good only when all three attempts fail
    const r = shop({ retry: 2 }).evaluate({ load: 1 })
    expect(r.retry.orders!.rejected).toBeCloseTo(0.02, 9)
    expect(r.retry.orders!.attempts).toBeCloseTo(100 * (1 + 0.02 + 0.02 ** 2), 6)
    expect(r.lost.orders.share).toBeCloseTo(0.02 ** 3, 9)
    // a breaker that opens past 50 % failing stays closed at 2 %
    expect(shop({ breaker: 0.5 }).evaluate({ load: 1 }).breakers.orders!.admitted).toBe(1)
    // one that opens past 1 % is open whatever it admits: the share failing does not fall with the load
    const open = shop({ breaker: 0.01 }).evaluate({ load: 1 })
    expect(open.breakers.orders!.admitted).toBeCloseTo(0, 6)
    expect(open.lost.orders.share).toBeCloseTo(1, 6)
    // a fallback serves what failed past where it falls back after
    const fb = shop({ fallback: true }).evaluate({ load: 1 })
    expect(fb.at.stale.orders).toBeCloseTo(2, 9)
    expect(fb.lost.orders.share).toBeCloseTo(0, 9)
  })

  it('is held by an expectation on what is lost, which names it', () => {
    const said = check(shop(), [{ lost: 0.03 }, { lost: 0.01 }]).map((r) => `${r.outcome}: ${r.message}`)
    expect(said).toEqual([
      'pass: 2 % of orders is lost at 1×, within 3 %',
      'fail: expected at most 1 % of every flow lost, but 2 % of orders is lost at 1×, most of it failed at API',
    ])
  })

  it('is a share below 1, of a component a stage runs', () => {
    expect(() => shop({ fails: 1 })).toThrow('component "api" fails a share of 1: from 0, below 1')
    // a fan-out makes copies: it has no unit of its own to fail
    expect(() =>
      defineModel({
        ...shop().def,
        stages: { ...shop().def.stages, api: fanout({ component: 'api', to: [{ stage: 'out', share: 2 }] }) },
        routes: { orders: ['gate', 'api'] },
      } as never),
    ).toThrow('component "api" fails a share of its units, and the fan-out "api" runs it')
    expect(() =>
      defineModel({
        ...shop().def,
        components: {
          ...shop().def.components,
          spare: { name: 'Spare', demand: () => 1, capacity: measured(1, 'x'), fails: 0.1, over: 'x' },
        },
      } as never),
    ).toThrow('component "spare" fails a share of the units its stages work on, and no stage runs it')
    // a lost box may take failed only from a stage that can fail
    expect(() =>
      defineModel({
        ...shop().def,
        stages: { ...shop().def.stages, errors: lost({ from: ['db'], takes: ['failed'] }) },
      } as never),
    ).toThrow('"db" never has failed units')
  })
})
