import { defineModel, lost, measured, p, pass, queue, sink, workers } from '@loadmap/core'
import { describe, expect, it } from 'vitest'
import { createSim } from '../src'

// 100 jobs a second at 1×, through an inbox to runners that take 200 a second
const shop = (o: { holds?: number; block?: boolean } = {}) =>
  defineModel({
    load: p.load({ max: 10 }),
    flows: { jobs: { label: 'jobs', rate: ({ load }) => 100 * load } },
    components: {
      api: { name: 'API', capacity: measured(10_000, 'req/s'), over: 'x' },
      runners: { name: 'Runners', demand: ({ flows }) => flows.jobs * 0.01, capacity: measured(2, 'cores'), over: 'x' },
    },
    stages: {
      api: pass('api'),
      inbox: queue({
        partitions: { jobs: 1 },
        ...(o.holds ? { holds: o.holds } : {}),
        ...(o.block ? { whenFull: 'block' as const } : {}),
      }),
      runners: workers('runners', { pods: 2, perPod: 4 }),
      refused: lost({ from: [o.block || !o.holds ? 'api' : 'inbox'] }),
      out: sink(),
    },
    routes: { jobs: ['api', 'inbox', 'runners', 'out'] },
  })

/** Two simulated minutes at 3×: where the dots ended, and the queue then. */
const run = (o: { holds?: number; block?: boolean }) => {
  const m = shop(o)
  const sim = createSim(m, m.evaluate({ load: 3 }), { seed: 4, speed: 10, maxDots: 80, dotTarget: 100 })
  const ends = new Map<string, number>()
  const seen = new Set<number>()
  for (let i = 0; i < 60 * 120; i++) {
    sim.step(1 / 60)
    for (const d of sim.particles)
      if (d.phase === 'fade' && !seen.has(d.id)) {
        seen.add(d.id)
        const k = `${d.to.stage}:${d.outcome}`
        ends.set(k, (ends.get(k) ?? 0) + 1)
      }
  }
  return { ends, q: sim.queue('inbox', 'jobs') }
}

describe('a queue with a size', () => {
  it('keeps no more than it holds, and turns away the share the model counts', () => {
    const { ends, q } = run({ holds: 5000 })
    expect(q.backlog).toBeCloseTo(5000, 6)
    // a full queue is read through in 5000 ÷ 200 a second
    expect(q.lag).toBeGreaterThan(24)
    expect(q.lag).toBeLessThan(26)
    expect(q.refused).toBeCloseTo(100, 3)
    const refused = ends.get('refused:rejected') ?? 0
    const share = refused / (refused + (ends.get('out:delivered') ?? 0))
    // a third in the model; the first 50 s, while it fills, turn nothing away
    expect(share).toBeGreaterThan(0.28)
    expect(share).toBeLessThan(0.36)
  })

  it('sends what it turned away into the lost box of the stage before it with block', () => {
    const { ends, q } = run({ holds: 5000, block: true })
    expect(q.backlog).toBeCloseTo(5000, 6)
    expect(ends.get('refused:rejected')).toBeGreaterThan(1000)
  })

  it('grows without end and refuses nothing without a size', () => {
    const { ends, q } = run({})
    expect(q.backlog).toBeGreaterThan(100_000)
    expect(q.refused).toBe(0)
    expect([...ends.keys()]).toEqual(['out:delivered'])
  })
})
