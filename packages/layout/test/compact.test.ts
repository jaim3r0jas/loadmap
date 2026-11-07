import { defineModel, measured, p, store, workers } from '@loadmap/core'
import { collisions, defineView, edge, layout, node, pool, type Scene, structureKey } from '@loadmap/layout'
import { describe, expect, it } from 'vitest'
import { expectEdgesOnBoxes, laidOut } from '../../../examples/phases'

const m = defineModel({
  load: p.load({ max: 10 }),
  params: {
    pods: p.select({ label: 'Pods', options: [2, 4, 6], default: 2 }),
    audit: p.switch({ label: 'Audit log', default: false }),
  },
  flows: { requests: { rate: ({ load }) => 100 * load } },
  components: {
    app: {
      name: 'App',
      capacity: ({ pods }) => measured(pods, 'cores'),
      demand: ({ flows }) => flows.requests / 100,
      over: 'requests wait',
    },
    db: { name: 'Database', capacity: measured(500, 'queries/s'), over: 'queries queue' },
  },
  stages: { app: workers('app', { pods: ({ pods }) => pods, perPod: 4 }), db: store('db') },
  routes: { requests: ['app', 'db'] },
})
const view = defineView(m, {
  nodes: {
    users: node({ label: 'Users' }),
    app: pool({ label: 'App', stage: 'app' }),
    db: node({ label: 'Database', stage: 'db', shape: 'cylinder' }),
    spill: node({ label: 'Spill queue' }),
    audit: node({ label: 'Audit log' }),
  },
  edges: [
    edge('users', 'app'),
    edge('app', 'db'),
    // past half the load range, an edge the defaults never draw at a low load
    edge('app', 'spill', { label: 'overflow', when: ({ load }) => (load as number) > 5 }),
    edge('db', 'audit', { when: ({ audit, load }) => audit && (load as number) > 5 }),
  ],
  flows: { requests: { from: 'users', color: 'accent' } },
})
type V = Parameters<typeof m.evaluate>[0]
const centres = (s: Scene) => Object.fromEntries(s.nodes.map((n) => [n.id, [n.x + n.w / 2, n.y + n.h / 2]]))

describe('a compact layout', () => {
  for (const direction of ['RIGHT', 'DOWN'] as const) {
    const at = (v: V, on = view) => layout(on, m.evaluate(v), { direction })

    it(`never moves with the load, even where an edge comes in partway up (${direction})`, async () => {
      const [low, high] = [await at({ load: 1 }), await at({ load: 10 })]
      expect(low.edges.map((e) => e.id)).toEqual(['e0', 'e1'])
      expect(high.edges.map((e) => e.id)).toEqual(['e0', 'e1', 'e2'])
      expect(centres(high)).toEqual(centres(low))
      expect([high.width, high.height]).toEqual([low.width, low.height])
      for (const s of [low, high]) {
        expect(collisions(s)).toEqual([])
        expectEdgesOnBoxes(s)
      }
    })

    it(`lays out a small phase smaller than the stable frame (${direction})`, async () => {
      // every box with an edge in this phase: a box with none stands apart, beside the rest
      const small = { pods: 2, audit: true } as const
      const [compact, stable] = [await at(small), await at(small, laidOut(view, 'stable'))]
      expect(compact.width * compact.height).toBeLessThan(stable.width * stable.height)
    })

    it(`moves the boxes from one phase to the next (${direction})`, async () => {
      const [small, big] = [await at({ pods: 2 }), await at({ pods: 6 })]
      expect(big.key).not.toBe(small.key)
      expect(centres(big)).not.toEqual(centres(small))
      for (const s of [small, big]) {
        expect(collisions(s)).toEqual([])
        expectEdgesOnBoxes(s)
      }
    })

    it(`lays out a phase the same whatever came before (${direction})`, async () => {
      const before = laidOut(view, 'compact')
      await at({ pods: 6, audit: true }, before)
      const after = await at({ pods: 2 }, before)
      expect(await at({ pods: 2 }, laidOut(view, 'compact'))).toEqual(after)
    })

    it(`tells apart two phases with the same shapes at this load but different frames (${direction})`, async () => {
      // at 1×, the audit edge is drawn in neither, but the audit phase makes room for it further up the load
      const key = (v: V) => structureKey(view, m.evaluate(v), { direction })
      expect(key({ load: 1, audit: true })).not.toBe(key({ load: 1 }))
      const [off, on] = [await at({ load: 1 }), await at({ load: 1, audit: true })]
      expect(on.edges.map((e) => e.id)).toEqual(off.edges.map((e) => e.id))
      expect(centres(on)).toEqual(centres(await at({ load: 10, audit: true })))
    })
  }
})

describe('a compact layout, at the edges of what a model declares', () => {
  it('never moves with the load at a load a story step names between two stops of the slider', async () => {
    const r = defineModel({
      load: p.load({ max: 10, step: 1 }),
      params: {},
      flows: { requests: { rate: ({ load }) => 100 * load } },
      components: { app: { name: 'App', capacity: measured(4, 'cores'), demand: () => 1, over: 'x' } },
      stages: { app: workers('app', { pods: 2, perPod: 4 }) },
      routes: { requests: ['app'] },
      story: [{ text: 'Between two stops.', set: { load: 2.5 } }],
    })
    const v = defineView(r, {
      nodes: {
        users: node({ label: 'Users' }),
        app: pool({ label: 'App', stage: 'app' }),
        odd: node({ label: 'Odd' }),
      },
      edges: [edge('users', 'app'), edge('app', 'odd', { when: ({ load }) => !Number.isInteger(load) })],
      flows: { requests: { from: 'users', color: 'accent' } },
    })
    const [half, two] = [await layout(v, r.evaluate({ load: 2.5 })), await layout(v, r.evaluate({ load: 2 }))]
    expect(half.edges).toHaveLength(2)
    expect(centres(two)).toEqual(centres(half))
  })

  it('names a layout that is neither compact nor stable', () => {
    expect(() => defineView(m, { ...view.def, layout: 'fixed' as 'stable' })).toThrow(
      'loadmap: layout "fixed" is not compact or stable',
    )
  })
})

describe('a compact layout with range controls', () => {
  const r = defineModel({
    load: p.load({ max: 10 }),
    params: {
      pods: p.range({ label: 'Pods', min: 1, max: 6, default: 2 }),
      shards: p.range({ label: 'Shards', min: 1, max: 9, default: 1 }),
      audit: p.switch({ label: 'Audit log', default: false }),
    },
    flows: { requests: { rate: ({ load }) => 100 * load } },
    components: {
      app: { name: 'App', capacity: ({ pods }) => measured(pods, 'cores'), demand: () => 1, over: 'x' },
      db: { name: 'Database', capacity: measured(500, 'queries/s'), over: 'x' },
    },
    stages: { app: workers('app', { pods: ({ pods }) => pods, perPod: 4 }), db: store('db') },
    routes: { requests: ['app', 'db'] },
  })
  const v = defineView(r, {
    nodes: {
      users: node({ label: 'Users' }),
      app: pool({ label: 'App', stage: 'app' }),
      db: node({ label: 'Database', sub: ({ shards }) => `${shards} shards`, stage: 'db', shape: 'cylinder' }),
      audit: node({ label: 'Audit log' }),
    },
    edges: [edge('users', 'app'), edge('app', 'db'), edge('db', 'audit', { when: ({ audit }) => audit })],
    flows: { requests: { from: 'users', color: 'accent' } },
  })
  type R = Parameters<typeof r.evaluate>[0]

  for (const direction of ['RIGHT', 'DOWN'] as const) {
    const at = (values: R) => layout(v, r.evaluate(values), { direction })

    it(`moves no box while a range is dragged: a box grows where it stands (${direction})`, async () => {
      const first = await at({ pods: 1 })
      for (let pods = 1; pods <= 6; pods++)
        for (const shards of [1, 5, 9]) {
          const s = await at({ pods, shards })
          expect(centres(s), `${pods} pods, ${shards} shards`).toEqual(centres(first))
          expect([s.width, s.height]).toEqual([first.width, first.height])
          expect(collisions(s)).toEqual([])
          expectEdgesOnBoxes(s)
        }
      expect((await at({ pods: 6 })).nodes.find((n) => n.id === 'app')!.members).toHaveLength(6)
    })

    it(`still lays out a switch on its own (${direction})`, async () => {
      const [off, on] = [await at({ pods: 3 }), await at({ pods: 3, audit: true })]
      expect(on.key).not.toBe(off.key)
      expect(on.edges).toHaveLength(3)
      expect(collisions(on)).toEqual([])
    })
  }
})
