import { describe, expect, it } from 'vitest'
import {
  cache,
  configured,
  defineModel,
  fanout,
  limit,
  lost,
  measured,
  p,
  pass,
  queue,
  split,
  store,
  workers,
} from '../src'
import { lossesIn } from '../src/internal'

// clients → a rate limiter of 1,500 req/s → a service of 1,000 → a database; what is lost goes to lost boxes
const shop = (o: { retry?: { times: number }; takes?: readonly ('rejected' | 'dropped' | 'timedOut')[] } = {}) =>
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
      tooMany: lost({ from: ['limiter'], ...(o.takes ? { takes: o.takes } : {}) }),
      failed: lost({ from: ['service'] }),
    },
    routes: { req: ['limiter', 'service', 'db'] },
  })

describe('a lost box', () => {
  it('takes what its stages turn away: at 2×, the limiter turns away 500 and the service 500 of the 1,500 let in', () => {
    const ev = shop().evaluate({ load: 2 })
    expect(ev.ctx.at.tooMany.req).toBeCloseTo(500, 6)
    expect(ev.ctx.at.failed.req).toBeCloseTo(500, 6)
    expect(ev.stages.tooMany).toMatchObject({
      kind: 'lost',
      from: ['limiter'],
      takes: ['rejected', 'dropped', 'timedOut', 'failed'],
    })
    // nothing is lost below capacity
    expect(shop().evaluate({ load: 0.5 }).ctx.at.failed.req).toBe(0)
  })

  it('counts only what fails every retry: the attempts multiply, the units lost do not', () => {
    const ev = shop({ retry: { times: 3 } }).evaluate({ load: 2 })
    const r = ev.retry.req!
    // every unit that fails for good is in one lost box or the other
    expect(ev.ctx.at.tooMany.req + ev.ctx.at.failed.req).toBeCloseTo(r.rate * r.failed, 6)
    expect(ev.ctx.at.tooMany.req + ev.ctx.at.failed.req).toBeLessThan(r.attempts * r.rejected)
  })

  it('takes only the losses it names', () => {
    expect(() => shop({ takes: ['dropped'] })).toThrow(
      'lost "tooMany" takes from "limiter", which loses nothing it counts: "limiter" never has dropped units',
    )
    expect(shop({ takes: ['rejected'] }).evaluate({ load: 2 }).ctx.at.tooMany.req).toBeCloseTo(500, 6)
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
        old: lost({ from: ['topic'] }),
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
      stages: { api: pass('api'), slow: lost({ from: ['api'], takes: ['timedOut'] }) },
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
    expect(build({ api, db, d: lost({ from: ['db'] }) })).toThrow(
      'lost "d" takes from "db", which loses nothing it counts: "db" turns nothing away, drops nothing and times nothing out',
    )
    expect(build({ api, db, d: lost({ from: ['nope'] }) })).toThrow('lost "d" takes from unknown stage "nope"')
    expect(build({ api, db, d: lost({ from: ['api'] }), e: lost({ from: ['api'] }) })).toThrow(
      'what "api" loses as rejected goes to two lost boxes, "d" and "e"',
    )
    expect(build({ api, d: lost({ from: ['api'] }) }, { req: ['api', 'd'] })).toThrow(
      'lost "d" is on the way of "req": it takes only what other stages lose',
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
        lost: lost({ from: ['limiter', 'api'] }),
      },
      routes: { req: ['limiter', 'api'] },
    })
    const ev = m.evaluate({ load: 8 })
    // 800 sent, 400 turned away, the 400 let in are what can be too slow
    expect(ev.ctx.at.lost.req).toBeCloseTo(400 + 400 * ev.latency.req!.timedOut! * (800 / 400) * 0.5, 6)
    expect(ev.ctx.at.lost.req).toBeLessThan(800)
  })

  // a topic whose reader takes 200 ev/s, for a flow with a drop rule and a timeout
  const queued = (o: { retry?: { times: number } } = {}) =>
    defineModel({
      load: p.load({ max: 10 }),
      flows: {
        ev: {
          rate: ({ load }) => 100 * load,
          overload: { drop: { olderThan: 60 } },
          timeout: 1,
          ...(o.retry ? { retry: o.retry } : {}),
        },
      },
      components: {
        pool: {
          name: 'Pool',
          demand: ({ flows }) => flows.ev,
          capacity: measured(200, 'ev/s'),
          service: 0.01,
          over: 'lag',
        },
      },
      stages: {
        topic: queue({ partitions: { ev: 6 } }),
        pool: workers('pool', { pods: 2, perPod: 2 }),
        old: lost({ from: ['topic'] }),
        slow: lost({ from: ['pool'] }),
      },
      routes: { ev: ['topic', 'pool'] },
    })

  it('counts a unit once: what a queue drops is never also too slow', () => {
    const ev = queued().evaluate({ load: 4 })
    // 400 sent, the pool drains 200: the other 200 grow too old, and only the 200 read can be too slow
    expect(ev.ctx.at.old.ev).toBeCloseTo(200, 6)
    expect(ev.ctx.at.slow.ev).toBeCloseTo(200 * ev.latency.ev!.timedOut!, 6)
    expect(ev.ctx.at.old.ev + ev.ctx.at.slow.ev).toBeLessThanOrEqual(400 + 1e-6)
  })

  it('never sends a dropped unit again: only what the reader took and was too slow is retried', () => {
    const ev = queued({ retry: { times: 2 } }).evaluate({ load: 4 })
    const r = ev.retry.ev!
    // every attempt the pool reads (200 a second) is too slow, so an attempt fails with p = 200 / attempts, and the
    // attempts are 400 (1 + p + p²): 2p³ + 2p² + 2p = 1
    expect(r.attempts * r.rejected).toBeCloseTo(200, 4)
    expect(2 * r.rejected ** 3 + 2 * r.rejected ** 2 + 2 * r.rejected).toBeCloseTo(1, 6)
    // each of the 400 units is dropped once or fails every attempt
    expect(ev.ctx.at.old.ev).toBeCloseTo(r.attempts - 200, 4)
    expect(ev.ctx.at.old.ev + ev.ctx.at.slow.ev).toBeCloseTo(400, 4)
  })

  it('counts each way on its own: a drop on one way of a split takes nothing from the other', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { ev: { rate: ({ load }) => 100 * load, overload: { drop: { olderThan: 60 } }, timeout: 1 } },
      components: {
        pool: { name: 'Pool', capacity: measured(100, 'ev/s'), service: 0.01, over: 'lag' },
        db: { name: 'DB', capacity: measured(10_000, 'ev/s'), service: 0.001, over: 'writes queue' },
      },
      stages: {
        router: split({
          to: [
            { stages: ['topic', 'pool'], share: 0.5 },
            { stages: ['db'], share: 0.5 },
          ],
        }),
        topic: queue({ partitions: { ev: 6 } }),
        pool: pass('pool'),
        db: store('db'),
        all: lost({ from: ['topic', 'pool', 'db'] }),
      },
      routes: { ev: ['router'] },
    })
    const ev = m.evaluate({ load: 4 })
    // 200 a way: the topic drops 100 and the pool takes the other 100, too slowly, turning none away; the DB's
    // 200 are fine
    expect(ev.ctx.at.all.ev).toBeCloseTo(200, 6)
    expect((ev.stages.pool as { shed: number }).shed).toBeCloseTo(0, 9)
  })

  it('counts what a cache answers apart: only the misses a stage let through can be too slow there', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { req: { rate: ({ load }) => 100 * load, timeout: 0.011 } },
      components: { api: { name: 'API', capacity: measured(100, 'req/s'), service: 0.01, over: 'slow' } },
      stages: { c: cache({ hit: 0.5 }), api: pass('api'), all: lost({ from: ['c', 'api'] }) },
      routes: { req: ['c', 'api'] },
    })
    // 400 sent, 200 answered by the cache in time; of the 200 misses the API turns 100 away and is too slow for 100
    expect(m.evaluate({ load: 4 }).ctx.at.all.req).toBeCloseTo(200, 6)
  })

  it('checks a queue on every way: it drops where its reader on that way is past capacity', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { ev: { rate: ({ load }) => 100 * load, overload: { drop: { olderThan: 60 } } } },
      components: {
        fast: { name: 'Fast', capacity: measured(1000, 'ev/s'), over: 'lag' },
        slow: { name: 'Slow', capacity: measured(100, 'ev/s'), over: 'lag' },
      },
      stages: {
        router: split({
          to: [
            { stages: ['topic', 'fast'], share: 0.5 },
            { stages: ['topic', 'slow'], share: 0.5 },
          ],
        }),
        topic: queue({ partitions: { ev: 6 } }),
        fast: pass('fast'),
        slow: pass('slow'),
        old: lost({ from: ['topic'] }),
      },
      routes: { ev: ['router'] },
    })
    // 200 a way: the fast reader keeps up, the slow one drains 100 of its 200
    expect(m.evaluate({ load: 4 }).ctx.at.old.ev).toBeCloseTo(100, 6)
  })

  it('refuses a lost box fed by a copy, by a queue nothing reads, and a formula that reads a lost box under retries', () => {
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
          d: lost({ from: ['phone'] }),
        },
        routes: { req: ['push'] },
      }),
    ).toThrow('lost "d" takes from "phone", which loses nothing it counts')
    expect(
      build({
        flows: { req: { rate: () => 1, overload: { drop: { olderThan: 9 } } } },
        stages: {
          api: pass('api'),
          q: queue({ partitions: { req: 1 } }),
          d: lost({ from: ['q'], takes: ['dropped'] }),
        },
        routes: { req: ['api', 'q'] },
      }),
    ).toThrow('lost "d" takes from "q", which loses nothing it counts')
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
      stages: { api: pass('api'), failed: lost({ from: ['api'] }) },
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
    expect(lossesIn(def)('c')).toEqual(['rejected', 'timedOut'])
  })

  it('knows what each stage can lose', () => {
    const def = shop().def as never
    const losses = lossesIn(def)
    expect(losses('limiter')).toEqual(['rejected'])
    expect(losses('db')).toEqual([])
  })
})
