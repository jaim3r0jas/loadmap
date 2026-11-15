import { describe, expect, it } from 'vitest'
import { cache, configured, defineModel, drain, fanout, limit, measured, p, pass, queue, store, workers } from '../src'
import { lossesOf } from '../src/internal'

// clients → a rate limiter of 1,500 req/s → a service of 1,000 → a database; what is lost goes to drains
const shop = (o: { retry?: { times: number }; reason?: readonly ('rejected' | 'dropped' | 'timedout')[] } = {}) =>
  defineModel({
    load: p.load({ max: 10, step: 0.1 }),
    flows: { req: { rate: ({ load }) => 1000 * load, ...(o.retry ? { retry: o.retry } : {}) } },
    components: {
      limiter: { name: 'Limiter', capacity: configured(1500, 'req/s', 'gateway config'), over: 'clients get 429s' },
      service: { name: 'Service', capacity: measured(1000, 'req/s'), over: 'clients get 503s' },
      db: { name: 'DB', capacity: measured(10_000, 'req/s'), over: 'writes queue' },
    },
    stages: {
      limiter: limit('limiter'),
      service: pass('service'),
      db: store('db'),
      tooMany: drain({ from: ['limiter'], ...(o.reason ? { reason: o.reason } : {}) }),
      failed: drain({ from: ['service'] }),
    },
    routes: { req: ['limiter', 'service', 'db'] },
  })

describe('a drain', () => {
  it('takes what its stages turn away: at 2×, the limiter turns away 500 and the service 500 of the 1,500 let in', () => {
    const ev = shop().evaluate({ load: 2 })
    expect(ev.ctx.at.tooMany.req).toBeCloseTo(500, 6)
    expect(ev.ctx.at.failed.req).toBeCloseTo(500, 6)
    expect(ev.stages.tooMany).toMatchObject({
      kind: 'drain',
      from: ['limiter'],
      reasons: ['rejected', 'dropped', 'timedout'],
    })
    // nothing is lost below capacity
    expect(shop().evaluate({ load: 0.5 }).ctx.at.failed.req).toBe(0)
  })

  it('counts only what fails every retry: the attempts multiply, the units lost do not', () => {
    const ev = shop({ retry: { times: 3 } }).evaluate({ load: 2 })
    const r = ev.retry.req!
    // every unit that fails for good is in one drain or the other
    expect(ev.ctx.at.tooMany.req + ev.ctx.at.failed.req).toBeCloseTo(r.rate * r.failed, 6)
    expect(ev.ctx.at.tooMany.req + ev.ctx.at.failed.req).toBeLessThan(r.attempts * r.rejected)
  })

  it('takes only the reasons it names', () => {
    expect(() => shop({ reason: ['dropped'] })).toThrow(
      'drain "tooMany" takes from "limiter", which loses nothing it counts: "limiter" never has dropped units',
    )
    expect(shop({ reason: ['rejected'] }).evaluate({ load: 2 }).ctx.at.tooMany.req).toBeCloseTo(500, 6)
  })

  it('takes what a queue drops, in steady state what its reader cannot drain', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { ev: { rate: ({ load }) => 100 * load, overload: { drop: { olderThan: 60 } } } },
      components: {
        pool: { name: 'Pool', demand: ({ flows }) => flows.ev, capacity: measured(200, 'ev/s'), over: 'lag' },
      },
      stages: {
        topic: queue({ partitions: { ev: 6 } }),
        pool: workers('pool', { pods: 2, perPod: 2 }),
        old: drain({ from: ['topic'] }),
      },
      routes: { ev: ['topic', 'pool'] },
    })
    // at 4× the pool is at 200 %: half of what reaches the topic grows too old
    expect(m.evaluate({ load: 4 }).ctx.at.old.ev).toBeCloseTo(200, 6)
    expect(m.evaluate({ load: 1 }).ctx.at.old.ev).toBe(0)
  })

  it('takes what is too slow for its client at the end of the way', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { req: { rate: ({ load }) => 100 * load, timeout: 0.05 } },
      components: { api: { name: 'API', capacity: measured(1000, 'req/s'), service: 0.01, over: 'slow' } },
      stages: { api: pass('api'), slow: drain({ from: ['api'], reason: ['timedout'] }) },
      routes: { req: ['api'] },
    })
    const ev = m.evaluate({ load: 8 })
    const late = ev.latency.req!.timedOut!
    expect(late).toBeGreaterThan(0)
    expect(ev.ctx.at.slow.req).toBeCloseTo(800 * late, 6)
  })

  it('refuses what it cannot be', () => {
    // a definition that breaks a rule cannot have its types: each is built as any
    const build =
      (stages: Record<string, unknown>, routes: Record<string, string[]> = { req: ['api', 'db'] }) =>
      () =>
        defineModel({
          load: p.load({ max: 10 }),
          flows: { req: { rate: () => 1 } },
          components: { api: { name: 'API', capacity: measured(10, 'req/s'), over: 'x' } },
          routes,
          stages,
        } as never)
    const api = pass('api')
    const db = store('api')
    expect(build({ api, db, d: drain({ from: ['db'] }) })).toThrow(
      'drain "d" takes from "db", which loses nothing it counts: "db" turns nothing away, drops nothing and times nothing out',
    )
    expect(build({ api, db, d: drain({ from: ['nope'] }) })).toThrow('drain "d" takes from unknown stage "nope"')
    expect(build({ api, db, d: drain({ from: ['api'] }), e: drain({ from: ['api'] }) })).toThrow(
      'what "api" loses as rejected goes to two drains, "d" and "e"',
    )
    expect(build({ api, d: drain({ from: ['api'] }) }, { req: ['api', 'd'] })).toThrow(
      'drain "d" is on the way of "req": it takes only what other stages lose',
    )
  })

  it('counts a unit once: what is turned away is never also too slow', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { req: { rate: ({ load }) => 100 * load, timeout: 0.02 } },
      components: {
        limiter: { name: 'Limiter', capacity: configured(400, 'req/s', 'config'), over: '429s' },
        api: { name: 'API', capacity: measured(1000, 'req/s'), service: 0.01, over: 'slow' },
      },
      stages: {
        limiter: limit('limiter'),
        api: pass('api'),
        lost: drain({ from: ['limiter', 'api'] }),
      },
      routes: { req: ['limiter', 'api'] },
    })
    const ev = m.evaluate({ load: 8 })
    // 800 sent, 400 turned away, the 400 let in are what can be too slow
    expect(ev.ctx.at.lost.req).toBeCloseTo(400 + 400 * ev.latency.req!.timedOut! * (800 / 400) * 0.5, 6)
    expect(ev.ctx.at.lost.req).toBeLessThan(800)
  })

  it('refuses a drain fed by a copy, by a queue nothing reads, and a formula that reads a drain under retries', () => {
    const build = (o: Record<string, unknown>) => () =>
      defineModel({
        load: p.load({ max: 10 }),
        components: { api: { name: 'API', capacity: measured(10, 'req/s'), over: 'x' } },
        ...o,
      } as never)
    expect(
      build({
        flows: { req: { rate: () => 1 } },
        stages: {
          push: fanout({ to: [{ stage: 'phone', share: 1 }] }),
          phone: pass('api'),
          d: drain({ from: ['phone'] }),
        },
        routes: { req: ['push'] },
      }),
    ).toThrow('drain "d" takes from "phone", which loses nothing it counts')
    expect(
      build({
        flows: { req: { rate: () => 1, overload: { drop: { olderThan: 9 } } } },
        stages: {
          api: pass('api'),
          q: queue({ partitions: { req: 1 } }),
          d: drain({ from: ['q'], reason: ['dropped'] }),
        },
        routes: { req: ['api', 'q'] },
      }),
    ).toThrow('drain "d" takes from "q", which loses nothing it counts')
    // the API's own demand reads what it loses: the retries depend on that demand
    const reads = defineModel({
      load: p.load({ max: 10 }),
      flows: { req: { rate: ({ load }) => 1000 * load, retry: { times: 2 } } },
      components: {
        api: {
          name: 'API',
          demand: ({ flows, at }) => flows.req + 0.1 * at.failed.req,
          capacity: measured(1000, 'req/s'),
          over: '503s',
        },
      },
      stages: { api: pass('api'), failed: drain({ from: ['api'] }) },
      routes: { req: ['api'] },
    })
    expect(() => reads.evaluate({ load: 2 })).toThrow('a formula reads at.failed, what the retries leave lost')
  })

  it('takes what a cache answers too slowly, at the cache', () => {
    const def = defineModel({
      load: p.load({ max: 10 }),
      flows: { req: { rate: () => 1, timeout: 1 } },
      components: { api: { name: 'API', capacity: measured(10, 'req/s'), service: 0.01, over: 'x' } },
      stages: { c: cache({ hit: 0.5, component: 'api' }), api: pass('api') },
      routes: { req: ['c', 'api'] },
    }).def as never
    expect(lossesOf(def, 'c')).toEqual(['rejected', 'timedout'])
  })

  it('knows what each stage can lose', () => {
    const def = shop().def as never
    expect(lossesOf(def, 'limiter')).toEqual(['rejected'])
    expect(lossesOf(def, 'db')).toEqual([])
  })
})
