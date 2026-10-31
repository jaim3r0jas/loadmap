import { defineModel, measured, p, pass, queue, workers } from '@loadmap/core'
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
