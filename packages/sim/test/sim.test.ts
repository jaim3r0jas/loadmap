import {
  cache,
  configured,
  defineModel,
  fanout,
  limit,
  measured,
  p,
  pass,
  queue,
  sink,
  split,
  store,
  workers,
} from '@loadmap/core'
import { describe, expect, it } from 'vitest'
import { busyOf, createSim, fillOrder } from '../src'

/** a (priority 1) and b (priority 2) wait in a topic for a pool of workers that serves `cap` units per second. */
const pipeline = (o: { a: number; b: number; cap: number; dropAfter?: number; gate?: number }) =>
  defineModel({
    load: p.load({ max: 10 }),
    flows: {
      a: { rate: ({ load }) => o.a * load, priority: 1 },
      b: {
        rate: ({ load }) => o.b * load,
        priority: 2,
        overload: o.dropAfter ? { drop: { olderThan: o.dropAfter } } : undefined,
      },
    },
    components: {
      gate: {
        name: 'Gate',
        demand: ({ flows }) => flows.a + flows.b,
        capacity: measured(o.gate ?? 1e9, 'u/s'),
        over: '',
      },
      pool: { name: 'Pool', demand: ({ flows }) => flows.a + flows.b, capacity: measured(o.cap, 'u/s'), over: '' },
    },
    stages: {
      gate: pass('gate'),
      topic: queue({ partitions: { a: 4, b: 4 } }),
      pool: workers('pool', { pods: 3, perPod: 4 }),
    },
    routes: { a: ['gate', 'topic', 'pool'], b: ['gate', 'topic', 'pool'] },
  })

const run = (m: ReturnType<typeof pipeline>, simSeconds: number, seed = 1) => {
  const sim = createSim(m, m.evaluate({ load: 1 }), { seed, speed: 10 })
  for (let i = 0; i < simSeconds * 6; i++) sim.step(1 / 60)
  return sim
}

describe('queues', () => {
  it('keep no backlog under capacity', () => {
    const sim = run(pipeline({ a: 50, b: 50, cap: 200 }), 120)
    expect(sim.queue('topic', 'b')).toMatchObject({ backlog: 0, lag: 0 })
    expect(sim.busy('pool')).toBeCloseTo(0.5, 2)
  })

  it('grow over capacity: the oldest unit ages at (λ − μ) / λ', () => {
    // λ = 200, μ = 100: after 120 s, 12,000 units wait and the oldest arrived at 60 s
    const sim = run(pipeline({ a: 0, b: 200, cap: 100 }), 120)
    const q = sim.queue('topic', 'b')
    expect(q.backlog).toBeCloseTo(12_000, -2)
    expect(q.lag).toBeGreaterThan(59)
    expect(q.lag).toBeLessThan(61.5)
    expect(sim.busy('pool')).toBeCloseTo(1, 2)
  })

  it('serve the higher priority first', () => {
    const sim = run(pipeline({ a: 50, b: 150, cap: 100 }), 120)
    expect(sim.queue('topic', 'a')).toMatchObject({ backlog: 0, lag: 0 })
    expect(sim.queue('topic', 'a').served).toBeCloseTo(50, 0)
    expect(sim.queue('topic', 'b').served).toBeCloseTo(50, 0)
    expect(sim.queue('topic', 'b').lag).toBeGreaterThan(70)
  })

  it('drop only what is older than the rule allows', () => {
    const m = pipeline({ a: 50, b: 150, cap: 100, dropAfter: 30 })
    const early = run(m, 25)
    expect(early.queue('topic', 'b').dropped).toBe(0)
    const late = run(m, 300)
    expect(late.queue('topic', 'b').lag).toBeLessThanOrEqual(31.5)
    // 150 arrive, 50 are served: the other 100 a second age out
    expect(late.queue('topic', 'b').dropped).toBeCloseTo(100, -1)
  })

  it('reject the share above capacity at a pass stage', () => {
    const sim = run(pipeline({ a: 0, b: 400, cap: 1000, gate: 200 }), 60)
    expect(sim.shed('gate')).toBeCloseTo(0.5)
    expect(sim.queue('topic', 'b').arriving).toBeCloseTo(200, 0)
  })
})

describe('worker fill', () => {
  const podSums = (fill: 'round-robin' | 'in-order') => {
    const f = fillOrder(3, 8, fill, 7)
    return [0, 1, 2].map((pod) =>
      Array.from({ length: 8 }, (_, t) => busyOf(pod * 8 + t, f, 1 / 3)).reduce((a, b) => a + b),
    )
  }

  it('spreads work evenly across pods, round-robin', () => {
    const s = podSums('round-robin')
    expect(Math.max(...s) - Math.min(...s)).toBeLessThan(0.75)
  })

  it('fills pod 0 first in order', () => {
    const s = podSums('in-order')
    expect(s[0]).toBeGreaterThan(5)
    expect(s[2]).toBe(0)
  })

  it('adds up to the pool’s utilization', () => {
    const f = fillOrder(3, 8, 'round-robin')
    const total = Array.from({ length: 24 }, (_, i) => busyOf(i, f, 0.4)).reduce((a, b) => a + b)
    expect(total / 24).toBeCloseTo(0.4, 1)
  })
})

describe('dots', () => {
  it('play the same with the same seed', () => {
    const m = pipeline({ a: 50, b: 150, cap: 100 })
    const a = run(m, 30, 42)
    const b = run(m, 30, 42)
    const c = run(m, 30, 43)
    expect(a.particles.length).toBeGreaterThan(10)
    expect(a.particles).toEqual(b.particles)
    expect(a.particles).not.toEqual(c.particles)
  })

  it('show the scale and keep a small flow visible', () => {
    const sim = run(pipeline({ a: 2, b: 938, cap: 2000 }), 30)
    // 940 a second ÷ 28 dots → 50 per dot; a, at 2 a second, still gets one dot a second
    expect(sim.dotScale).toBe(50)
    expect(sim.particles.some((d) => d.flow === 'a')).toBe(true)
  })

  it('end delivered, dropped or rejected', () => {
    const sim = run(pipeline({ a: 50, b: 150, cap: 100, dropAfter: 10, gate: 150 }), 120)
    const outcomes = new Set<string | undefined>()
    for (let i = 0; i < 600; i++) {
      sim.step(1 / 60)
      for (const d of sim.particles) if (d.phase === 'fade') outcomes.add(d.outcome)
    }
    expect(outcomes).toEqual(new Set(['delivered', 'dropped', 'rejected']))
  })
})

describe('review fixes', () => {
  it('ignores a step of zero length instead of turning the meters into NaN', () => {
    const sim = run(pipeline({ a: 50, b: 150, cap: 100 }), 10)
    sim.step(0)
    sim.step(1 / 60)
    expect(Number.isNaN(sim.queue('topic', 'b').served)).toBe(false)
    expect(Number.isNaN(sim.busy('pool'))).toBe(false)
  })

  it('drains a backlog once its arrivals stop, even with an idle cost', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      params: { on: p.switch({ label: 'On', default: true }) },
      flows: { a: { rate: ({ load, on }) => (on ? 200 * load : 0) } },
      components: {
        pool: { name: 'Pool', demand: ({ flows }) => 5 + flows.a, capacity: measured(105, 'u/s'), over: '' },
      },
      stages: { topic: queue({ partitions: { a: 4 } }), pool: workers('pool', { pods: 1, perPod: 4 }) },
      routes: { a: ['topic', 'pool'] },
    })
    const sim = createSim(m, m.evaluate(), { speed: 10 })
    for (let i = 0; i < 600; i++) sim.step(1 / 60)
    expect(sim.queue('topic', 'a').backlog).toBeGreaterThan(1000)
    sim.update(m.evaluate({ on: false }))
    for (let i = 0; i < 60; i++) sim.step(1 / 60)
    expect(sim.queue('topic', 'a')).toMatchObject({ backlog: 0, lag: 0 })
  })

  it('runs out where the model says, also with a "full" below 100 %', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      thresholds: { full: 0.8 },
      flows: { a: { rate: ({ load }) => 90 * load } },
      components: {
        gate: { name: 'Gate', demand: ({ flows }) => flows.a, capacity: measured(100, 'u/s'), over: '' },
        pool: { name: 'Pool', demand: ({ flows }) => flows.a, capacity: measured(100, 'u/s'), over: '' },
      },
      stages: {
        gate: pass('gate'),
        topic: queue({ partitions: { a: 4 } }),
        pool: workers('pool', { pods: 1, perPod: 4 }),
      },
      routes: { a: ['gate', 'topic', 'pool'] },
    })
    const ev = m.evaluate({ load: 1 })
    expect(ev.components.pool.state).toBe('over')
    const sim = createSim(m, ev, { speed: 10 })
    for (let i = 0; i < 600; i++) sim.step(1 / 60)
    // 90 a second against a full of 80: one ninth rejected at the gate, the pool takes the remaining 80
    expect(sim.shed('gate')).toBeCloseTo(1 / 9)
    expect(sim.queue('topic', 'a').served).toBeCloseTo(80, 0)
  })

  it('applies priority across queues that feed the same workers', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: {
        low: { rate: ({ load }) => 150 * load, priority: 2 },
        high: { rate: ({ load }) => 50 * load, priority: 1 },
      },
      components: {
        pool: { name: 'Pool', demand: ({ flows }) => flows.low + flows.high, capacity: measured(100, 'u/s'), over: '' },
      },
      stages: {
        first: queue({ partitions: { low: 4 } }),
        second: queue({ partitions: { high: 4 } }),
        pool: workers('pool', { pods: 1, perPod: 4 }),
      },
      routes: { low: ['first', 'pool'], high: ['second', 'pool'] },
    })
    const sim = createSim(m, m.evaluate({ load: 1 }), { speed: 10 })
    for (let i = 0; i < 600; i++) sim.step(1 / 60)
    expect(sim.queue('second', 'high')).toMatchObject({ backlog: 0, lag: 0 })
    expect(sim.queue('first', 'low').served).toBeCloseTo(50, 0)
  })
})

/** One flow through a topic to a pool, then a fan-out to two receivers. `merge` switches keep-newest on. */
const fanModel = (o: { rate: number; cap: number; shares?: [number, number] }) =>
  defineModel({
    load: p.load({ max: 10 }),
    params: { merge: p.switch({ label: 'Merge', default: true }) },
    flows: {
      pos: {
        rate: ({ load }) => o.rate * load,
        overload: ({ merge }) => (merge ? { merge: { share: 0.4 } } : {}),
      },
    },
    components: {
      pool: { name: 'Pool', demand: ({ flows }) => flows.pos, capacity: measured(o.cap, 'u/s'), over: '' },
    },
    stages: {
      topic: queue({ partitions: { pos: 6 }, label: 'positions topic' }),
      pool: workers('pool', { pods: 2, perPod: 4 }),
      push: fanout({
        to: [
          { stage: 'viewers', share: o.shares?.[0] ?? 1 },
          { stage: 'watchers', share: o.shares?.[1] ?? 0.5 },
        ],
      }),
      viewers: sink(),
      watchers: sink(),
    },
    routes: { pos: ['topic', 'pool', 'push'] },
  })

describe('merge', () => {
  it('supersedes its share of what is handled, without using capacity', () => {
    const m = fanModel({ rate: 200, cap: 100 })
    const sim = createSim(m, m.evaluate({ load: 1 }), { speed: 10 })
    for (let i = 0; i < 1200; i++) sim.step(1 / 60)
    const q = sim.queue('topic', 'pos')
    expect(q.merging).toBe(true)
    // 100 a second of capacity handles 100 / (1 − 0.4) ≈ 167 units: 100 kept, 67 superseded
    expect(q.served).toBeCloseTo(100, 0)
    expect(q.merged).toBeCloseTo(100 * (0.4 / 0.6), 0)
  })

  it('keeps the lag lower than without it', () => {
    const m = fanModel({ rate: 200, cap: 100 })
    const lag = (merge: boolean) => {
      const sim = createSim(m, m.evaluate({ load: 1, merge }), { speed: 10 })
      for (let i = 0; i < 1200; i++) sim.step(1 / 60)
      return sim.queue('topic', 'pos').lag
    }
    expect(lag(true)).toBeLessThan(lag(false) * 0.5)
  })

  it('does nothing without a backlog', () => {
    const m = fanModel({ rate: 50, cap: 100 })
    const sim = createSim(m, m.evaluate({ load: 1 }), { speed: 10 })
    for (let i = 0; i < 600; i++) sim.step(1 / 60)
    expect(sim.queue('topic', 'pos')).toMatchObject({ merging: false, merged: 0 })
  })
})

describe('fan-out', () => {
  const outcomes = (m: ReturnType<typeof fanModel>) => {
    const sim = createSim(m, m.evaluate({ load: 1 }), { speed: 10, seed: 3 })
    const seen = new Map<number, string>()
    for (let i = 0; i < 3600; i++) {
      sim.step(1 / 60)
      for (const d of sim.particles)
        if (d.phase === 'fade' && d.t === 0) seen.set(d.id, `${d.branch ?? d.to.stage}:${d.outcome}`)
    }
    const count = (k: string) => [...seen.values()].filter((v) => v === k).length
    return { count, seen }
  }

  it('copies each dot to its branches in proportion to their shares', () => {
    const { count } = outcomes(fanModel({ rate: 50, cap: 1000 }))
    const viewers = count('viewers:delivered')
    const watchers = count('watchers:delivered')
    expect(viewers).toBeGreaterThan(30)
    expect(watchers / viewers).toBeGreaterThan(0.35)
    expect(watchers / viewers).toBeLessThan(0.65)
  })

  it('marks a dot nobody receives as unread', () => {
    const { count } = outcomes(fanModel({ rate: 50, cap: 1000, shares: [0, 0.2] }))
    expect(count('push:unread')).toBeGreaterThan(count('watchers:delivered'))
  })

  it('rejects a fan-out that is not the last stage, or a branch into a queue', () => {
    const base = {
      load: p.load({ max: 10 }),
      flows: { a: { rate: () => 1 } },
      components: { c: { name: 'C', demand: () => 1, capacity: measured(1, 'x'), over: '' } },
    }
    expect(() =>
      defineModel({
        ...base,
        stages: { f: fanout({ to: [] }), s: sink() },
        routes: { a: ['f', 's'] },
      }),
    ).toThrow(/must be the last stage/)
    const m = defineModel({
      ...base,
      stages: { q: queue({ partitions: { a: 1 } }), f: fanout({ to: [{ stage: 'q', share: 1 }] }) },
      routes: { a: ['f'] },
    })
    expect(() => m.evaluate()).toThrow(/not a sink, store or pass stage/)
  })
})

describe('second review', () => {
  it('does not merge without backlog, even with steps over a second', () => {
    const m = fanModel({ rate: 50, cap: 100 })
    const sim = createSim(m, m.evaluate({ load: 1 }), { speed: 10 })
    for (let i = 0; i < 40; i++) sim.step(1 / 8)
    expect(sim.queue('topic', 'pos')).toMatchObject({ merging: false, merged: 0 })
  })

  it('rejects fan-out copies when its component is past capacity', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { a: { rate: ({ load }) => 50 * load } },
      components: { push: { name: 'Push', demand: ({ flows }) => flows.a, capacity: measured(25, 'u/s'), over: '' } },
      stages: { push: fanout({ component: 'push', to: [{ stage: 'out', share: 1 }] }), out: sink() },
      routes: { a: ['push'] },
    })
    const sim = createSim(m, m.evaluate({ load: 1 }), { speed: 10, seed: 2 })
    expect(sim.shed('push')).toBeCloseTo(0.5)
    const seen = new Map<number, string | undefined>()
    for (let i = 0; i < 3600; i++) {
      sim.step(1 / 60)
      for (const d of sim.particles) if (d.branch && d.phase === 'fade') seen.set(d.id, d.outcome)
    }
    const rejected = [...seen.values()].filter((o) => o === 'rejected').length
    expect(rejected / seen.size).toBeGreaterThan(0.35)
    expect(rejected / seen.size).toBeLessThan(0.65)
  })

  it('gives a merging flow only the capacity it needs, the rest to its peers', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: {
        a: { rate: () => 100, overload: { merge: { share: 0.5 } } },
        b: { rate: () => 100 },
      },
      components: {
        pool: { name: 'Pool', demand: ({ flows }) => flows.a + flows.b, capacity: measured(150, 'u/s'), over: '' },
      },
      stages: {
        qa: queue({ partitions: { a: 2 } }),
        qb: queue({ partitions: { b: 2 } }),
        pool: workers('pool', { pods: 1, perPod: 2 }),
      },
      routes: { a: ['qa', 'pool'], b: ['qb', 'pool'] },
    })
    const sim = createSim(m, m.evaluate({ load: 1 }), { speed: 10 })
    for (let i = 0; i < 3600; i++) sim.step(1 / 60)
    // the pool is saturated: every unit of its 150/s is used
    expect(sim.queue('qa', 'a').served + sim.queue('qb', 'b').served).toBeCloseTo(150, 0)
  })

  it('keeps the dots when only a fan-out share changes', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      params: { wide: p.switch({ label: 'Wide', default: false }) },
      flows: { a: { rate: () => 100 } },
      components: { c: { name: 'C', demand: () => 1, capacity: measured(10, 'x'), over: '' } },
      stages: {
        q: queue({ partitions: { a: 2 } }),
        f: fanout({ to: ({ wide }) => [{ stage: 's', share: wide ? 2 : 1 }] }),
        s: sink(),
      },
      routes: { a: ['q', 'f'] },
    })
    const sim = createSim(m, m.evaluate(), { speed: 10 })
    for (let i = 0; i < 60; i++) sim.step(1 / 60)
    const before = sim.particles.length
    sim.update(m.evaluate({ wide: true }))
    expect(before).toBeGreaterThan(0)
    expect(sim.particles.length).toBe(before)
  })
})

describe('a new shape', () => {
  const sized = defineModel({
    load: p.load({ max: 10 }),
    params: { pods: p.select({ label: 'Pods', options: [1, 2, 4], default: 2 }) },
    flows: { a: { rate: ({ load }) => 40 * load } },
    components: { pool: { name: 'Pool', demand: ({ flows }) => flows.a, capacity: measured(1000, 'u/s'), over: '' } },
    stages: { topic: queue({ partitions: { a: 4 } }), pool: workers('pool', { pods: ({ pods }) => pods, perPod: 4 }) },
    routes: { a: ['topic', 'pool'] },
  })

  it('keeps the dots whose worker still exists', () => {
    const sim = createSim(sized, sized.evaluate({ load: 5 }), { seed: 2 })
    for (let i = 0; i < 90; i++) sim.step(1 / 30)
    const ids = (s: typeof sim) => new Set(s.particles.map((d) => d.id))
    const before = ids(sim)
    expect(before.size).toBeGreaterThan(5)
    // more pods: every worker of two pods is still there
    sim.update(sized.evaluate({ load: 5, pods: 4 }))
    expect(ids(sim)).toEqual(before)
    // fewer: the dots at workers 4 to 7 go, the rest stay
    const inSecondPod = sim.particles.filter((d) =>
      [d.from, d.to].some((x) => x.stage === 'pool' && (x.cell ?? 0) >= 4),
    )
    sim.update(sized.evaluate({ load: 5, pods: 1 }))
    expect(sim.particles.length).toBe(before.size - inSecondPod.length)
    expect(sim.particles.every((d) => [d.from, d.to].every((x) => x.stage !== 'pool' || (x.cell ?? 0) < 4))).toBe(true)
  })
})

describe('building blocks', () => {
  /** Simulated seconds at `load`, with dots. */
  const at = (m: any, load: number, simSeconds: number, seed = 1) => {
    const sim = createSim(m, m.evaluate({ load }), { seed, speed: 10 })
    for (let i = 0; i < simSeconds * 3; i++) sim.step(1 / 30)
    return sim
  }

  describe('cache', () => {
    // 1,000 lookups/s at 1×, 80 % answered: the database's 500/s runs out at 2.5×
    const m = defineModel({
      load: p.load({ max: 10, step: 0.01 }),
      flows: { lookups: { rate: ({ load }) => 1000 * load } },
      components: { db: { name: 'DB', capacity: measured(500, 'queries/s'), over: '' } },
      stages: {
        cache: cache({ hit: 0.8 }),
        topic: queue({ partitions: { lookups: 4 } }),
        db: workers('db', { pods: 2, perPod: 4 }),
      },
      routes: { lookups: ['cache', 'topic', 'db'] },
    })

    it('backs up behind it only past the full the bars show', () => {
      const full = m.evaluate().components.db.full!
      expect(full).toBeCloseTo(2.5, 6)
      expect(at(m, full * 0.99, 120).queue('topic', 'lookups').backlog).toBe(0)
      // 520 arrive, 500 are served: 20 a second wait
      const over = at(m, 2.6, 120).queue('topic', 'lookups')
      expect(over.arriving).toBeCloseTo(520, 0)
      expect(over.backlog).toBeCloseTo(2400, -2)
    })

    it('sends its hits back where they came from, answered', () => {
      const sim = at(m, 1, 30)
      const seen = new Set<string | undefined>()
      for (let i = 0; i < 300; i++) {
        sim.step(1 / 30)
        for (const d of sim.particles) if (d.back) seen.add(`${d.from.stage}→${d.to.stage}:${d.outcome ?? ''}`)
      }
      // on its way back, then fading where it came from (here the source)
      expect(seen).toEqual(new Set(['cache→null:', 'null→null:answered']))
    })
  })

  describe('autoscaled pool', () => {
    const m = defineModel({
      load: p.load({ max: 10, step: 0.01 }),
      flows: { req: { rate: ({ load }) => 300 * load } },
      components: {
        api: { name: 'API', demand: ({ flows }) => flows.req * 0.01, capacity: measured(10, 'cores'), over: '' },
      },
      stages: {
        topic: queue({ partitions: { req: 4 } }),
        api: workers('api', { perPod: 4, autoscale: { min: 2, max: 10, target: 0.7 } }),
      },
      routes: { req: ['topic', 'api'] },
    })

    it('keeps its running pods busy near the target and the others idle', () => {
      const sim = at(m, 1, 60)
      // 3 cores on 5 running pods of 1 core: 60 % each
      expect(sim.running('api')).toBe(5)
      expect(sim.busy('api')).toBeCloseTo(0.6, 2)
      const pod = (k: number) =>
        Array.from({ length: 4 }, (_, t) => sim.slotBusy('api', k * 4 + t)).reduce((a, b) => a + b)
      expect(pod(4)).toBeGreaterThan(0)
      expect(pod(5)).toBe(0)
      expect(pod(9)).toBe(0)
    })

    it('puts its dots only in the pods it runs', () => {
      const sim = at(m, 0.3, 60)
      expect(sim.running('api')).toBe(2)
      const cells = sim.particles.flatMap((d) => [d.from, d.to]).filter((x) => x.stage === 'api' && x.cell != null)
      expect(cells.length).toBeGreaterThan(0)
      expect(cells.every((x) => x.cell! < 2 * 4)).toBe(true)
    })

    it('backs up only past the full the bars show, at max pods', () => {
      const full = m.evaluate().components.api.full!
      expect(at(m, full * 0.99, 120).queue('topic', 'req').backlog).toBe(0)
      expect(at(m, full * 1.01, 120).queue('topic', 'req').backlog).toBeGreaterThan(0)
      expect(at(m, full * 1.01, 10).running('api')).toBe(10)
    })
  })

  it('turns away copies at a branch of a fan-out, as the bars say', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { a: { rate: ({ load }) => 100 * load } },
      components: { push: { name: 'Push', capacity: measured(100, 'u/s'), over: '' } },
      stages: { f: fanout({ to: [{ stage: 'push', share: 2 }] }), push: pass('push') },
      routes: { a: ['f'] },
    })
    expect(createSim(m, m.evaluate({ load: 1 })).shed('push')).toBeCloseTo(0.5)
  })

  describe('rate limiter', () => {
    const m = defineModel({
      load: p.load({ max: 10, step: 0.1 }),
      flows: { req: { rate: ({ load }) => 1000 * load } },
      components: {
        limiter: { name: 'Limiter', capacity: configured(1000, 'req/s'), over: '' },
        db: { name: 'DB', capacity: measured(2000, 'queries/s'), over: '' },
      },
      stages: {
        limiter: limit('limiter'),
        topic: queue({ partitions: { req: 4 } }),
        db: workers('db', { pods: 2, perPod: 4 }),
      },
      routes: { req: ['limiter', 'topic', 'db'] },
    })

    it('turns away what the bars say, and lets its limit through', () => {
      const sim = at(m, 1.5, 120)
      expect(sim.shed('limiter')).toBeCloseTo(1 / 3)
      expect(sim.queue('topic', 'req').arriving).toBeCloseTo(1000, 0)
      expect(sim.queue('topic', 'req').backlog).toBe(0)
    })
  })

  describe('retries', () => {
    // a gateway of 2,000 in front of a service of 1,000; three retries
    const m = defineModel({
      load: p.load({ max: 10, step: 0.1 }),
      flows: { req: { rate: ({ load }) => 1000 * load, retry: { times: 3 } } },
      components: {
        gateway: { name: 'Gateway', capacity: measured(2000, 'req/s'), over: '' },
        service: { name: 'Service', capacity: measured(1000, 'req/s'), over: '' },
      },
      stages: { gateway: pass('gateway'), service: pass('service') },
      routes: { req: ['gateway', 'service'] },
    })

    it('turn away the share the model settles on, counted against the bottleneck', () => {
      const ev = m.evaluate({ load: 2 })
      const sim = createSim(m, ev)
      // 6,285 attempts: the gateway takes 2,000, the service 1,000 of those
      expect(sim.shed('gateway')).toBeCloseTo(1 - 2000 / ev.retry.req!.attempts, 9)
      expect(sim.shed('service')).toBeCloseTo(0.5, 9)
      expect((1 - sim.shed('gateway')) * (1 - sim.shed('service'))).toBeCloseTo(1 - ev.retry.req!.rejected, 9)
    })

    it('send the units turned away again, as many attempts per unit as the model says', () => {
      const ev = m.evaluate({ load: 2 })
      const sim = createSim(m, ev, { seed: 3, maxParticles: 5000 })
      const first = new Set<number>()
      const again = new Set<number>()
      for (let i = 0; i < 30 * 120; i++) {
        sim.step(1 / 30)
        for (const d of sim.particles) (d.attempt ? again : first).add(d.id)
      }
      expect(Math.max(...sim.particles.map((d) => d.attempt ?? 0))).toBeLessThanOrEqual(3)
      // 1 + p + p² + p³ = 3.14 attempts per unit
      expect((first.size + again.size) / first.size).toBeCloseTo(ev.retry.req!.attempts / 2000, 1)
    })
  })
})

describe('a split', () => {
  // 100 units a second: a fifth to the primary, the rest through a replica to the response
  const routed = () =>
    defineModel({
      load: p.load({ max: 10 }),
      flows: { req: { rate: 100 } },
      components: {
        db: { name: 'Primary', capacity: measured(1e6, 'u/s'), over: '' },
        rep: { name: 'Replica', capacity: measured(1e6, 'u/s'), over: '' },
      },
      stages: {
        router: split({
          to: [
            { stages: ['primary'], share: 0.2 },
            { stages: ['replica'], share: 0.8 },
          ],
        }),
        primary: store('db'),
        replica: pass('rep'),
        out: sink(),
      },
      routes: { req: ['router', 'out'] },
    })

  it('sends each dot one way by share, the same ways for the same seed', () => {
    const count = (seed: number) => {
      const m = routed()
      const sim = createSim(m, m.evaluate(), { seed, speed: 10, maxDots: 60, dotTarget: 100 })
      const seen = new Map<number, Set<string>>()
      for (let i = 0; i < 60 * 40; i++) {
        sim.step(1 / 60)
        for (const d of sim.particles) {
          const s = seen.get(d.id) ?? new Set<string>()
          if (d.to.stage) s.add(d.to.stage)
          seen.set(d.id, s)
        }
      }
      const primary = [...seen.values()].filter((s) => s.has('primary')).length
      const replica = [...seen.values()].filter((s) => s.has('replica')).length
      return { primary, replica, sim }
    }
    const a = count(1)
    // a fifth, give or take the draw
    expect(a.primary / (a.primary + a.replica)).toBeGreaterThan(0.12)
    expect(a.primary / (a.primary + a.replica)).toBeLessThan(0.28)
    // the replica's way goes on to the response; the primary's ends there
    expect(a.sim.particles.every((d) => !(d.path === 0 && d.to.stage === 'out'))).toBe(true)
    expect(count(1).sim.particles).toEqual(a.sim.particles)
  })

  it('turns dots away at a split that runs out, as the model does', () => {
    // a coordinator of 50 u/s gets 100: half turned away
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { req: { rate: 100 } },
      components: {
        co: { name: 'Coordinator', capacity: measured(50, 'u/s'), over: '' },
        db: { name: 'Shard', capacity: measured(1e6, 'u/s'), over: '' },
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
    const sim = createSim(m, m.evaluate(), { seed: 3, speed: 10, maxDots: 60, dotTarget: 100 })
    expect(sim.shed('router')).toBeCloseTo(0.5, 9)
    const outcomes = new Map<number, string>()
    for (let i = 0; i < 60 * 40; i++) {
      sim.step(1 / 60)
      for (const d of sim.particles) if (d.outcome) outcomes.set(d.id, d.outcome)
    }
    const rejected = [...outcomes.values()].filter((o) => o === 'rejected').length
    expect(rejected / outcomes.size).toBeGreaterThan(0.35)
    expect(rejected / outcomes.size).toBeLessThan(0.65)
  })
})
