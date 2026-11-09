import { describe, expect, it } from 'vitest'
import { defineModel, estimated, fanout, measured, p, pass, queue, sink, split, store } from '../src'

// 100 req/s at 1×: the router sends a fifth to the primary (a store: that way ends there) and the rest through a
// replica, which rejoins the route to the response; `ping` is not named by the split and goes straight on
const shop = (o: { primary?: number; replica?: number; retry?: number; shares?: [number, number] } = {}) =>
  defineModel({
    load: p.load({ max: 10 }),
    flows: {
      req: { rate: ({ load }) => 100 * load, ...(o.retry && { retry: { times: o.retry } }) },
      ping: { rate: 10 },
    },
    components: {
      gw: { name: 'Gateway', capacity: measured(1000, 'req/s'), over: 'x' },
      db: { name: 'Primary', capacity: measured(o.primary ?? 50, 'req/s'), over: 'y' },
      rep: { name: 'Replica', capacity: estimated(o.replica ?? 100, 'req/s'), over: 'z' },
    },
    stages: {
      gw: pass('gw'),
      router: split({
        to: {
          req: [
            { stages: ['primary'], share: o.shares?.[0] ?? 0.2 },
            { stages: ['replica'], share: o.shares?.[1] ?? 0.8 },
          ],
        },
      }),
      primary: store('db'),
      replica: pass('rep'),
      out: sink(),
    },
    routes: { req: ['gw', 'router', 'out'], ping: ['gw', 'router', 'out'] },
  })

describe('a split', () => {
  it('sends each unit one way by share, ends a way at a store, and rejoins the rest', () => {
    const ev = shop().evaluate({ load: 1 })
    expect(ev.paths.req).toEqual([
      { stages: ['gw', 'router', 'primary'], share: 0.2 },
      { stages: ['gw', 'router', 'replica', 'out'], share: 0.8 },
    ])
    expect(ev.paths.ping).toEqual([{ stages: ['gw', 'router', 'out'], share: 1 }])
    const at = (s: string, f: 'req' | 'ping' = 'req') => (ev.at as Record<string, Record<string, number>>)[s]![f]!
    expect([at('gw'), at('router'), at('primary'), at('replica'), at('out')]).toEqual([100, 100, 20, 80, 80])
    expect([at('replica', 'ping'), at('out', 'ping')]).toEqual([0, 10])
    // the demand a component sees is what its ways bring: 20 on the primary, 80 on the replica
    expect([ev.components.db.demand, ev.components.rep.demand, ev.components.gw.demand]).toEqual([20, 80, 110])
    // the replica reaches its 50 % at 50 req/s of the 80 at 1×
    expect(ev.firstLimit?.id).toBe('rep')
    expect(ev.components.rep.target).toBeCloseTo(0.625, 6)
    expect(ev.components.db.target).toBeCloseTo(1.25, 6)
  })

  it('turns work away on a way for the share of units that go it, and settles its retries', () => {
    // at 2×, the replica gets 160 of its 100: 37.5 % turned away, on 80 % of the units
    const ev = shop().evaluate({ load: 2 })
    expect((ev.stages.replica as { rejects: number }).rejects).toBeCloseTo(0.375, 9)
    // one retry: a = 200 (1 + 0.8 (1 − 125 / a)), the least root at or above 200: a² − 360 a + 20 000 = 0
    const r = shop({ retry: 1 }).evaluate({ load: 2 }).retry.req!
    expect(r.attempts).toBeCloseTo((360 + Math.sqrt(360 ** 2 - 80_000)) / 2, 4)
    expect(r.rejected).toBeCloseTo(0.8 * (1 - 125 / r.attempts), 6)
  })

  it('refuses shares that do not add up to 1, or one outside 0 to 1', () => {
    expect(() => shop({ shares: [0.2, 0.7] }).evaluate()).toThrow(
      'loadmap: split "router" sends 90 % of "req" on: its shares add up to 1',
    )
    expect(() => shop({ shares: [1.2, -0.2] }).evaluate()).toThrow(/a share from 0 to 1 of "req" each way, not 1\.2/)
  })

  it('reads its shares from the parameters', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      params: { reads: p.select({ label: 'Reads', options: [0.5, 0.9], default: 0.9 }) },
      flows: { req: { rate: 100 } },
      components: {
        db: { name: 'Primary', capacity: measured(100, 'req/s'), over: 'y' },
        rep: { name: 'Replica', capacity: measured(100, 'req/s'), over: 'z' },
      },
      stages: {
        router: split({
          to: ({ reads }) => [
            { stages: ['primary'], share: 1 - reads },
            { stages: ['replica'], share: reads },
          ],
        }),
        primary: store('db'),
        replica: store('rep'),
      },
      routes: { req: ['router'] },
    })
    expect(m.evaluate().components.rep.demand).toBe(90)
    expect(m.evaluate({ reads: 0.5 }).components.rep.demand).toBe(50)
  })

  it('turns work away at its own component, as a pass does', () => {
    // a coordinator of 150 req/s in front of both ways: at 2× it gets 200, a quarter turned away
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { req: { rate: ({ load }) => 100 * load } },
      components: {
        co: { name: 'Coordinator', capacity: measured(150, 'req/s'), over: 'x' },
        db: { name: 'Shard', capacity: measured(1000, 'req/s'), over: 'y' },
      },
      stages: {
        router: split({
          component: 'co',
          to: [
            { stages: ['a'], share: 0.5 },
            { stages: ['b'], share: 0.5 },
          ],
        }),
        a: store('db'),
        b: store('db'),
      },
      routes: { req: ['router'] },
    })
    const st = m.evaluate({ load: 2 }).stages.router as { rejects: number; shed: number }
    expect(st.rejects).toBeCloseTo(0.25, 9)
    expect(st.shed).toBeCloseTo(0.25, 9)
  })

  it('refuses a way that names the stages after it, a fan-out onto it, and a queue it cannot drain', () => {
    const model = (o: { way?: 'api'; fan?: boolean; queued?: boolean }) =>
      defineModel({
        load: p.load({ max: 10 }),
        flows: { req: { rate: 100 } },
        components: { api: { name: 'API', capacity: measured(1000, 'req/s'), over: 'x' } },
        stages: {
          fan: fanout({ to: [{ stage: o.fan ? 'router' : 'db', share: 1 }] }),
          topic: queue({ partitions: { req: 1 } }),
          router: split({
            to: [
              { stages: [o.way ?? 'db'], share: 0.5 },
              { stages: ['db'], share: 0.5 },
            ],
          }),
          api: pass('api'),
          db: store('api'),
          out: sink(),
        },
        routes: { req: o.fan ? ['fan'] : o.queued ? ['topic', 'router', 'api', 'out'] : ['router', 'api', 'out'] },
      })
    expect(() => model({ way: 'api' }).evaluate()).toThrow(
      'loadmap: split "router" sends "req" through "api", which the route takes after it',
    )
    expect(() => model({ fan: true }).evaluate()).toThrow('fan-out "fan" branches to "router"')
    expect(() => model({ queued: true }).evaluate()).toThrow(
      'loadmap: queue "topic" is drained by split "router", which has no component',
    )
  })
})
