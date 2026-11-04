import { describe, expect, it } from 'vitest'
import {
  cache,
  configured,
  defineModel,
  estimated,
  fanout,
  limit,
  measured,
  p,
  pass,
  queue,
  sink,
  store,
  workers,
} from '../src'

describe('cache', () => {
  // 1,000 lookups/s at 1×; 80 % are answered by the cache, so the database sees 200/s against 500/s
  const m = defineModel({
    load: p.load({ max: 10 }),
    params: { hit: p.select({ label: 'Hit ratio', options: [0, 0.8], default: 0.8 }) },
    flows: { lookups: { rate: ({ load }) => 1000 * load } },
    components: {
      redis: { name: 'Redis', capacity: measured(20_000, 'ops/s'), over: 'x' },
      db: { name: 'Database', capacity: measured(500, 'queries/s'), over: 'y' },
    },
    stages: { redis: cache({ hit: ({ hit }) => hit, component: 'redis' }), db: store('db') },
    routes: { lookups: ['redis', 'db'] },
  })

  it('cuts what reaches the stages after it by its hit ratio', () => {
    const ev = m.evaluate({ load: 1 })
    expect(ev.at.redis.lookups).toBe(1000)
    expect(ev.at.db.lookups).toBeCloseTo(200)
    expect(ev.components.redis.demand).toBe(1000)
    expect(ev.components.db.util).toBeCloseTo(0.4)
    expect(ev.stages.redis).toMatchObject({ kind: 'cache', hit: 0.8, rejects: 0 })
  })

  it('moves the crossings behind it: 500 ÷ 200 = 2.5×, and 0.5× without hits', () => {
    expect(m.evaluate().components.db.full).toBeCloseTo(2.5, 6)
    expect(m.evaluate({ hit: 0 }).components.db.full).toBeCloseTo(0.5, 6)
  })

  it('refuses a hit share outside 0 to 1', () => {
    const bad = defineModel({
      load: p.load({ max: 10 }),
      flows: { a: { rate: () => 1 } },
      components: { db: { name: 'DB', capacity: measured(1, 'x'), over: '' } },
      stages: { c: cache({ hit: 1.2 }), db: store('db') },
      routes: { a: ['c', 'db'] },
    })
    expect(() => bad.evaluate()).toThrow('cache "c" needs a hit share from 0 to 1, not 1.2')
  })
})

describe('default demand', () => {
  it('is what reaches the stages that use the component', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { a: { rate: ({ load }) => 10 * load }, b: { rate: ({ load }) => 5 * load } },
      components: { api: { name: 'API', capacity: measured(100, 'req/s'), over: '' } },
      stages: { api: pass('api') },
      routes: { a: ['api'], b: ['api'] },
    })
    expect(m.evaluate({ load: 2 }).components.api.demand).toBe(30)
  })

  it('is a mistake for a component no stage uses', () => {
    expect(() =>
      defineModel({
        load: p.load({ max: 10 }),
        flows: { a: { rate: () => 1 } },
        components: {
          api: { name: 'API', capacity: measured(1, 'x'), over: '' },
          db: { name: 'DB', capacity: measured(1, 'x'), over: '' },
        },
        stages: { api: pass('api') },
        routes: { a: ['api'] },
      }),
    ).toThrow('component "db" needs a demand: no stage uses it')
  })
})

describe('autoscaled pool', () => {
  // 300 req/s at 1×, 10 ms of CPU each: 3 cores against 10 pods of 1 core at most, each held at 70 %
  const m = defineModel({
    load: p.load({ max: 10, step: 0.1 }),
    flows: { req: { rate: ({ load }) => 300 * load } },
    components: {
      api: {
        name: 'API',
        demand: ({ flows }) => flows.req * 0.01,
        capacity: measured(10, 'cores', '10 pods at most, 1 core each'),
        over: 'x',
      },
    },
    stages: {
      topic: queue({ partitions: { req: 4 } }),
      api: workers('api', { perPod: 4, autoscale: { min: 2, max: 10, target: 0.7 } }),
    },
    routes: { req: ['topic', 'api'] },
  })
  const pool = (load: number) =>
    m.evaluate({ load }).stages.api as Extract<ReturnType<typeof m.evaluate>['stages']['api'], { kind: 'workers' }>

  it('runs enough pods to hold each near its target: ⌈3 ÷ 0.7⌉ = 5', () => {
    expect(pool(1)).toMatchObject({ pods: 10, running: 5, autoscale: { min: 2, max: 10, target: 0.7 } })
    expect(m.evaluate({ load: 1 }).components.api.util).toBeCloseTo(0.3)
  })

  it('stays between its min and max', () => {
    expect(pool(0.1).running).toBe(2)
    expect(pool(3).running).toBe(10)
  })

  it('adds no pod for a rounding error at its target', () => {
    // 1.4 cores is exactly 2 pods at 70 %
    expect(pool(1.4 / 3).running).toBe(2)
  })

  it('runs out where it cannot grow further: 10 cores at 3.33×', () => {
    expect(m.evaluate().components.api.full).toBeCloseTo(10 / 3, 6)
  })

  it('needs pods or autoscale, and whole numbers within min and max', () => {
    const def = (o: object) =>
      defineModel({
        load: p.load({ max: 10 }),
        flows: { a: { rate: () => 1 } },
        components: { w: { name: 'W', capacity: measured(1, 'x'), over: '' } },
        stages: { w: workers('w', { perPod: 1, ...o } as any) },
        routes: { a: ['w'] },
      })
    expect(() => def({})).toThrow('workers "w" needs pods or autoscale, one of them')
    expect(() => def({ autoscale: { min: 4, max: 2, target: 0.7 } }).evaluate()).toThrow('1 ≤ min ≤ max')
    expect(() => def({ autoscale: { min: 1, max: 2, target: 1.5 } }).evaluate()).toThrow('at most 1, not 1.5')
  })
})

describe('rate limiter', () => {
  // a 1,000 req/s limit in front of a database that takes 2,000
  const m = (kind: 'limit' | 'pass') =>
    defineModel({
      load: p.load({ max: 10, step: 0.1 }),
      flows: { req: { rate: ({ load }) => 1000 * load } },
      components: {
        limiter: {
          name: 'Rate limiter',
          capacity: configured(1000, 'req/s', 'gateway config'),
          over: 'clients get 429s',
        },
        db: { name: 'Database', capacity: measured(2000, 'queries/s'), over: 'y' },
      },
      stages: { limiter: kind === 'limit' ? limit('limiter') : pass('limiter'), db: store('db') },
      routes: { req: ['limiter', 'db'] },
    })

  it('turns away the share above its limit: a third at 1.5×', () => {
    const ev = m('limit').evaluate({ load: 1.5 })
    expect(ev.stages.limiter).toMatchObject({ kind: 'limit' })
    expect((ev.stages.limiter as { rejects: number }).rejects).toBeCloseTo(1 / 3)
  })

  it('lets only its limit through, where a pass stage past capacity does not cut what follows', () => {
    expect(m('limit').evaluate({ load: 1.5 }).at.db.req).toBeCloseTo(1000)
    expect(m('limit').evaluate({ load: 1.5 }).components.db.util).toBeCloseTo(0.5)
    expect(m('pass').evaluate({ load: 1.5 }).at.db.req).toBeCloseTo(1500)
    // behind the limit the database never runs out
    expect(m('limit').evaluate().components.db.full).toBe(Number.POSITIVE_INFINITY)
  })

  it('lists a configured capacity as exact', () => {
    const ev = m('limit').evaluate({ load: 1 })
    expect(ev.components.limiter.capacity).toEqual({
      value: 1000,
      unit: 'req/s',
      provenance: 'configured',
      source: 'gateway config',
    })
    expect(ev.verdict.text).not.toContain('capacity configured')
  })
})

describe('retries', () => {
  // a gateway of 2,000 req/s in front of a service of 1,000; clients retry what is turned away
  const m = (retry?: { times: number; budget?: number }, within = 0) =>
    defineModel({
      load: p.load({ max: 10, step: 0.1 }),
      flows: { req: { rate: ({ load }) => 1000 * load, ...(retry ? { retry } : {}) } },
      components: {
        gateway: { name: 'Gateway', capacity: measured(2000, 'req/s'), over: 'x' },
        service: { name: 'Service', capacity: estimated(1000, 'req/s', { within }), over: 'clients get 503s' },
      },
      stages: { gateway: pass('gateway'), service: pass('service') },
      routes: { req: ['gateway', 'service'] },
    })

  it('change nothing below capacity: one attempt each', () => {
    expect(m({ times: 3 }).evaluate({ load: 0.9 }).retry.req).toEqual({
      times: 3,
      rate: 900,
      attempts: 900,
      rejected: 0,
      retried: 1,
      failed: 0,
    })
  })

  it('settle where p = (1 − C/λ)^(1/(n+1)) and the attempts are C ÷ (1 − p)', () => {
    const r = m({ times: 3 }).evaluate({ load: 2 }).retry.req!
    const y = 0.5 ** (1 / 4)
    expect(r.rejected).toBeCloseTo(y, 9)
    expect(r.attempts).toBeCloseTo(1000 / (1 - y), 6)
    // retries save nobody past capacity: λ − C fail with or without them
    expect(r.failed).toBeCloseTo(0.5, 9)
    expect(m().evaluate({ load: 2 }).components.gateway.util).toBeCloseTo(1)
    expect(m({ times: 3 }).evaluate({ load: 2 }).components.gateway.util).toBeCloseTo(1000 / (1 - y) / 2000, 6)
  })

  it('bring the gateway in front to its limit early: 1,000 ÷ (1 − 0.5⁴) = 1.0667× instead of 2×', () => {
    expect(m().evaluate().components.gateway.full).toBeCloseTo(2, 6)
    expect(m({ times: 3 }).evaluate().components.gateway.full).toBeCloseTo(1000 / (1 - 0.5 ** 4) / 1000, 6)
    // the service itself runs out where it did
    expect(m({ times: 3 }).evaluate().components.service.full).toBeCloseTo(1, 6)
  })

  it('stay within a budget: at most 10 % more attempts', () => {
    const r = m({ times: 3, budget: 0.1 }).evaluate({ load: 2 }).retry.req!
    expect(r.attempts).toBeCloseTo(2200, 6)
    expect(r.rejected).toBeCloseTo(1 - 1000 / 2200, 9)
    // 1 + y + y² + y³ = 1.1 for y = p × retried
    const y = r.rejected * r.retried
    expect(1 + y + y ** 2 + y ** 3).toBeCloseTo(1.1, 9)
    expect(r.failed).toBeCloseTo(0.5, 9)
    // the gateway reaches 2,000 attempts at 2,000 ÷ 1.1
    expect(m({ times: 3, budget: 0.1 }).evaluate().components.gateway.full).toBeCloseTo(2000 / 1.1 / 1000, 6)
  })

  it('range with the capacity: the gateway runs out between 800 and 1,200 behind the service ±20 %', () => {
    const g = m({ times: 3 }, 0.2).evaluate().components.gateway
    const at = (c: number) => c / (1 - (1 - c / 2000) ** 4) / 1000
    expect(g.fullRange!.low).toBeCloseTo(at(800), 6)
    expect(g.fullRange!.high).toBeCloseTo(at(1200), 6)
  })

  it('settle together for two flows on one service, as one flow of their sum', () => {
    const two = defineModel({
      load: p.load({ max: 10 }),
      flows: {
        a: { rate: ({ load }) => 600 * load, retry: { times: 3 } },
        b: { rate: ({ load }) => 400 * load, retry: { times: 3 } },
      },
      components: { service: { name: 'Service', capacity: measured(1000, 'req/s'), over: 'x' } },
      stages: { service: pass('service') },
      routes: { a: ['service'], b: ['service'] },
    })
    const ev = two.evaluate({ load: 2 })
    const y = 0.5 ** (1 / 4)
    const s = 1 + y + y ** 2 + y ** 3
    expect(ev.retry.a!.attempts).toBeCloseTo(1200 * s, 4)
    expect(ev.retry.b!.attempts).toBeCloseTo(800 * s, 4)
    expect(ev.retry.a!.rejected).toBeCloseTo(y, 6)
    // just past the knee too, where a tiny first call is still far from the answer
    for (const load of [1 + 1e-9, 1.01, 100]) {
      const q = (1 - 1 / load) ** (1 / 4)
      expect(two.utilization({ load }).service, String(load)).toBeCloseTo(load * (1 + q + q ** 2 + q ** 3), 6)
    }
  })

  it('refuse a count that is not whole', () => {
    expect(() => m({ times: 1.5 }).evaluate()).toThrow('flow "req" retries a whole number of times, not 1.5')
  })

  it('stay cheap: a model with retries finds its limits in well under a second', () => {
    const model = m({ times: 3 }, 0.2)
    const t0 = process.threadCpuUsage()
    model.evaluate({ load: 3 })
    const ms = (process.threadCpuUsage(t0).user + process.threadCpuUsage(t0).system) / 1000
    expect(ms).toBeLessThan(1000)
  })
})

describe('review fixes', () => {
  it('evaluate a rate limiter in front of a fan-out', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { a: { rate: ({ load }) => 1000 * load } },
      components: { gw: { name: 'Limiter', capacity: configured(1500, 'req/s'), over: '' } },
      stages: { g: limit('gw'), f: fanout({ to: [{ stage: 'out', share: 2 }] }), out: sink() },
      routes: { a: ['g', 'f'] },
    })
    const ev = m.evaluate({ load: 3 })
    expect((ev.stages.g as { rejects: number }).rejects).toBeCloseTo(0.5)
    // the limiter lets 1,500 through, and the fan-out copies each twice
    expect(ev.at.out.a).toBeCloseTo(3000)
  })

  it('let an overload rule read the model, as before retries', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: {
        a: {
          rate: ({ load }) => 100 * load,
          overload: ({ util }) => ((util.db ?? 0) > 1 ? { drop: { olderThan: 30 } } : {}),
        },
      },
      components: { db: { name: 'DB', demand: ({ flows }) => flows.a, capacity: measured(200, 'u/s'), over: '' } },
      stages: { q: queue({ partitions: { a: 1 } }), db: workers('db', { pods: 1, perPod: 1 }) },
      routes: { a: ['q', 'db'] },
    })
    expect(m.evaluate({ load: 1 }).overload.a).toEqual({})
    expect(m.evaluate({ load: 3 }).overload.a).toEqual({ drop: { olderThan: 30 } })
  })

  it('turn away a share of what actually reaches a stage, behind one that cut first', () => {
    // 4,000 offered; the gateway takes 2,000, so the service turns away half of what reaches it, a quarter offered
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { a: { rate: ({ load }) => 1000 * load } },
      components: {
        gateway: { name: 'Gateway', capacity: measured(2000, 'req/s'), over: '' },
        service: { name: 'Service', capacity: measured(1000, 'req/s'), over: '' },
      },
      stages: { gateway: pass('gateway'), service: pass('service') },
      routes: { a: ['gateway', 'service'] },
    })
    const ev = m.evaluate({ load: 4 })
    expect(ev.stages.gateway).toMatchObject({ rejects: 0.5, shed: 0.5 })
    expect(ev.stages.service).toMatchObject({ rejects: 0.75, shed: 0.5 })
  })

  it('turn away copies at a branch of a fan-out', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { a: { rate: ({ load }) => 100 * load } },
      components: { push: { name: 'Push', capacity: measured(100, 'u/s'), over: '' } },
      stages: { f: fanout({ to: [{ stage: 'push', share: 2 }] }), push: pass('push') },
      routes: { a: ['f'] },
    })
    // 200 copies a second against 100
    expect(m.evaluate({ load: 1 }).stages.push).toMatchObject({ rejects: 0.5, shed: 0.5 })
  })
})
