import { collisions, labelsAt, layout, legPath, structureKey } from '@loadmap/layout'
import { describe, expect, it } from 'vitest'
import { checkout } from './model'
import { view } from './view'

describe('checkout layout', () => {
  for (const direction of ['RIGHT', 'DOWN'] as const) {
    it(`has no label over another label or a node (${direction})`, async () => {
      for (const values of [{}, { pods: 6, threads: 16 }, { pods: 2, threads: 4, batch: false }] as const) {
        const scene = await layout(view, checkout.evaluate(values), { direction })
        expect(collisions(scene)).toEqual([])
        expect(scene.edges.filter((e) => e.label)).toHaveLength(3)
      }
    })
  }

  it('does not move when the load changes', async () => {
    const a = await layout(view, checkout.evaluate({ load: 1 }))
    const b = await layout(view, checkout.evaluate({ load: 100 }))
    expect(b).toBe(a)
    expect(labelsAt(view, checkout.evaluate({ load: 100 })).edges.e1).toBe('4.0k orders/s')
  })

  it('moves when the shape changes', () => {
    const key = (v: object) => structureKey(view, checkout.evaluate(v))
    expect(key({ pods: 6 })).not.toBe(key({ pods: 3 }))
    expect(key({ batch: false })).not.toBe(key({}))
  })

  it('packs partitions across brokers and workers into pods', async () => {
    const scene = await layout(view, checkout.evaluate({ pods: 4, threads: 8 }))
    const kafka = scene.nodes.find((n) => n.id === 'kafka')!
    const workers = scene.nodes.find((n) => n.id === 'workers')!
    expect(kafka.members.map((m) => m.label)).toEqual(['broker 0', 'broker 1', 'broker 2'])
    expect(kafka.cells.filter((c) => c.flow === 'orders')).toHaveLength(12)
    expect(kafka.cells.filter((c) => c.flow === 'events')).toHaveLength(24)
    expect(workers.members).toHaveLength(4)
    expect(workers.slots.map((s) => s.index)).toEqual(Array.from({ length: 32 }, (_, i) => i))
    // every cell and worker sits inside its node
    for (const n of [kafka, workers])
      for (const c of [...n.cells, ...n.slots]) {
        expect(c.x).toBeGreaterThanOrEqual(n.x)
        expect(c.y + c.h).toBeLessThanOrEqual(n.y + n.h)
      }
  })

  it('routes a dot along the edge between two stages', async () => {
    const scene = await layout(view, checkout.evaluate())
    const path = legPath(scene, { stage: 'topic', cell: 3 }, { stage: 'workers', cell: 5 }, 'orders')
    const edge = scene.edges.find((e) => e.from === 'kafka' && e.to === 'workers')!
    expect(path.slice(1, -1)).toEqual(edge.points)
  })
})

describe('layout cache', () => {
  it('tells apart structures with the same sizes but cells split differently', async () => {
    const { defineModel, measured, p, pass, queue } = await import('@loadmap/core')
    const { cluster, topology } = await import('@loadmap/layout')
    const m = defineModel({
      load: p.load({ max: 10 }),
      params: { swap: p.switch({ label: 'Swap', default: false }) },
      flows: { a: { rate: () => 1 }, b: { rate: () => 1 } },
      components: { q: { name: 'Q', demand: () => 1, capacity: measured(10, 'x'), over: '' } },
      stages: {
        q: queue({ component: 'q', partitions: ({ swap }) => (swap ? { a: 12, b: 6 } : { a: 6, b: 12 }) }),
        out: pass('q'),
      },
      routes: { a: ['q', 'out'], b: ['q', 'out'] },
    })
    const v = topology(m, {
      nodes: {
        q: cluster({ label: 'Queue', members: 3, stage: 'q' }),
        out: { kind: 'node', label: 'Out', stage: 'out', shape: 'box' },
      },
      edges: [],
      flows: { a: { from: 'q', color: 'accent' }, b: { from: 'q', color: 'alt' } },
    })
    const a = await layout(v, m.evaluate())
    const b = await layout(v, m.evaluate({ swap: true }))
    expect(b).not.toBe(a)
    expect(b.nodes[0]!.cells.filter((c) => c.flow === 'a')).toHaveLength(12)
  })
})
