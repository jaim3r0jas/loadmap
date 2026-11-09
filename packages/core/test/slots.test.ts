import { describe, expect, it } from 'vitest'
import { configured, defineModel, estimated, measured, p, pass, sink } from '../src'

// 100 requests a second at 1×, each holding one of 50 connections for 200 ms; a socket every 10 s, held a minute
const app = (o: { held?: number | Record<string, number>; pool?: number } = {}) =>
  defineModel({
    load: p.load({ max: 10 }),
    flows: {
      req: { rate: ({ load }) => 100 * load },
      ws: { rate: 0.1 },
    },
    components: {
      api: { name: 'API', capacity: measured(10_000, 'req/s'), over: 'x' },
      pool: {
        name: 'Connections',
        held: o.held ?? 0.2,
        capacity: configured(o.pool ?? 50, 'connections', 'pool size'),
        over: 'requests wait for a connection',
      },
    },
    stages: { api: pass('api'), pool: pass('pool'), out: sink() },
    routes: { req: ['api', 'pool', 'out'], ws: ['api', 'pool', 'out'] },
  })

describe('a component that counts slots', () => {
  it('is in use for what arrives times how long each unit holds one', () => {
    // 100 req/s × 0.2 s + 0.1 ws/s × 0.2 s = 20.02 of 50
    const ev = app().evaluate({ load: 1 })
    expect(ev.components.pool.demand).toBeCloseTo(20.02, 9)
    expect(ev.components.pool.util).toBeCloseTo(20.02 / 50, 9)
    expect(ev.components.pool.held).toEqual({ req: 0.2, ws: 0.2 })
    // 25 of 50 at the target: 20 L + 0.02 = 25
    expect(ev.components.pool.target).toBeCloseTo(24.98 / 20, 6)
    expect(ev.components.pool.full).toBeCloseTo(49.98 / 20, 6)
    // a component that is not held says nothing of it
    expect(ev.components.api.held).toBeUndefined()
  })

  it('takes a time per flow, and one a flow does not name is no time', () => {
    // 100 × 0.2 + 0.1 × 60 = 26 at 1×; at the target 20 L + 6 = 25
    const ev = app({ held: { req: 0.2, ws: 60 } }).evaluate({ load: 1 })
    expect(ev.components.pool.demand).toBeCloseTo(26, 9)
    expect(ev.components.pool.target).toBeCloseTo(19 / 20, 6)
    expect(ev.components.pool.held).toEqual({ req: 0.2, ws: 60 })
    expect(app({ held: { ws: 60 } }).evaluate({ load: 1 }).components.pool.demand).toBeCloseTo(6, 9)
  })

  it('counts the stages it is held on, beside the limit that runs them', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      params: { ms: p.select({ label: 'Query time', options: [20, 50], default: 20 }) },
      flows: { orders: { rate: ({ load }) => 40 * load } },
      components: {
        db: { name: 'Postgres', capacity: estimated(4_000, 'commits/s'), over: 'x' },
        conns: {
          name: 'Postgres connections',
          held: ({ ms }) => ms / 1000,
          on: ['db'],
          capacity: configured(100, 'connections', 'pool size'),
          over: 'orders wait for a connection',
        },
      },
      stages: { db: pass('db') },
      routes: { orders: ['db'] },
    })
    // 40 orders/s × 20 ms = 0.8 of 100 at 1×; 2 at 50 ms
    expect(m.evaluate({ load: 1 }).components.conns.demand).toBeCloseTo(0.8, 9)
    expect(m.evaluate({ load: 1, ms: 50 }).components.conns.demand).toBeCloseTo(2, 9)
    expect(m.evaluate().components.conns.full).toBeCloseTo(125, 6)
    // the database itself still counts its commits
    expect(m.evaluate({ load: 1 }).components.db.demand).toBe(40)
  })

  it('refuses a time that cannot be, a capacity per second, and held beside demand', () => {
    expect(() => app({ held: -1 }).evaluate()).toThrow(
      'loadmap: component "pool" is held -1 s by each unit of "req": a time from 0 up',
    )
    expect(() => app({ held: { reqs: 1 } }).evaluate()).toThrow(
      'loadmap: component "pool" is held by unknown flow "reqs"',
    )
    const perSecond = defineModel({
      load: p.load({ max: 10 }),
      flows: { req: { rate: 100 } },
      components: { pool: { name: 'Pool', held: 0.1, capacity: measured(50, 'req/s'), over: 'x' } },
      stages: { pool: pass('pool') },
      routes: { req: ['pool'] },
    })
    expect(() => perSecond.evaluate()).toThrow(
      'loadmap: component "pool" is held, so its capacity counts slots ("connections", "sessions"), not "req/s"',
    )
    const both = () =>
      defineModel({
        load: p.load({ max: 10 }),
        flows: { req: { rate: 100 } },
        components: {
          pool: { name: 'Pool', held: 0.1, demand: () => 3, capacity: measured(50, 'connections'), over: 'x' },
        },
        stages: { pool: pass('pool') },
        routes: { req: ['pool'] },
      })
    expect(both).toThrow('loadmap: component "pool" takes held or demand, not both')
    const nowhere = () =>
      defineModel({
        load: p.load({ max: 10 }),
        flows: { req: { rate: 100 } },
        components: {
          api: { name: 'API', capacity: measured(500, 'req/s'), over: 'x' },
          pool: { name: 'Pool', held: 0.1, on: ['db'], capacity: measured(50, 'connections'), over: 'x' },
        },
        stages: { api: pass('api') },
        routes: { req: ['api'] },
      })
    expect(nowhere).toThrow('loadmap: component "pool" is held on unknown stage "db"')
  })

  it('holds one slot a unit, lists only the flows that hold one, and reads its stages from on', () => {
    // req passes api and db, ev only api
    const pooled = (o: { on?: string[]; held?: number; unit?: string } = {}) =>
      defineModel({
        load: p.load({ max: 10 }),
        flows: { req: { rate: 100, unit: 'request' }, ev: { rate: 10 } },
        components: {
          api: { name: 'API', capacity: measured(10_000, 'req/s'), over: 'x' },
          pool: {
            name: 'Pool',
            held: o.held,
            on: o.on ?? ['db'],
            capacity: measured(50, o.unit ?? 'connections'),
            over: 'x',
          },
        },
        stages: { api: pass('api'), db: sink() },
        routes: { req: ['api', 'db'], ev: ['api'] },
      })
    const ev = pooled({ held: 0.2 }).evaluate()
    expect(ev.components.pool.demand).toBeCloseTo(20, 9)
    // ev never reaches db: it holds nothing there, and is not listed
    expect(ev.components.pool.held).toEqual({ req: 0.2 })
    expect(() => pooled({ held: 0.2, on: ['api', 'db'] }).evaluate()).toThrow(
      'loadmap: component "pool" is held on "api" and "db", and "req" passes both: a unit holds one slot',
    )
    expect(() => pooled({ on: ['db'] })).toThrow(
      'loadmap: component "pool" names the stages that hold its slots (on): give it held too',
    )
    expect(() => pooled({ held: 0.2, on: [] })).toThrow(
      'loadmap: component "pool" is held on no stage: name them with on',
    )
    for (const unit of ['req/min', 'rps', 'events per second'])
      expect(() => pooled({ held: 0.2, unit }).evaluate(), unit).toThrow('so its capacity counts slots')
  })
})
