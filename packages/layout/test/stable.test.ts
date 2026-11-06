import { defineModel, measured, p, store, workers } from '@loadmap/core'
import { collisions, defineView, edge, layout, node, pool, type Scene } from '@loadmap/layout'
import { describe, expect, it } from 'vitest'
import { expectEdgesOnBoxes } from '../../../examples/phases'

const m = defineModel({
  load: p.load({ max: 10 }),
  params: {
    pods: p.select({ label: 'Pods', options: [2, 4, 6], default: 2 }),
    audit: p.switch({ label: 'Audit log', default: false }),
    shards: p.range({ label: 'Shards', min: 1, max: 9, default: 1 }),
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
    // a label that is widest between a range's ends, where nothing the model declares stands
    db: node({
      label: 'Database',
      sub: ({ shards }) => (shards === 5 ? 'five shards, a label wider than any other' : `${shards} shards`),
      stage: 'db',
      shape: 'cylinder',
    }),
    audit: node({ label: 'Audit log' }),
  },
  edges: [edge('users', 'app'), edge('app', 'db'), edge('app', 'audit', { when: ({ audit }) => audit })],
  flows: { requests: { from: 'users', color: 'accent' } },
})
type V = Parameters<typeof m.evaluate>[0]
const centres = (s: Scene) => Object.fromEntries(s.nodes.map((n) => [n.id, [n.x + n.w / 2, n.y + n.h / 2]]))

describe('a stable layout', () => {
  for (const direction of ['RIGHT', 'DOWN'] as const) {
    const at = (v: V) => layout(view, m.evaluate(v), { direction })

    it(`keeps every box where it is when an edge comes or goes (${direction})`, async () => {
      const [off, on] = [await at({ audit: false }), await at({ audit: true })]
      expect(off.edges.map((e) => e.id)).toEqual(['e0', 'e1'])
      expect(on.edges.map((e) => e.id)).toEqual(['e0', 'e1', 'e2'])
      expect(centres(on)).toEqual(centres(off))
      expect([on.width, on.height]).toEqual([off.width, off.height])
    })

    it(`draws a smaller box in the middle of its slot, its edges still on its sides (${direction})`, async () => {
      const [small, big] = [await at({ pods: 2 }), await at({ pods: 6 })]
      const app = (s: Scene) => s.nodes.find((n) => n.id === 'app')!
      expect(app(small).members).toHaveLength(2)
      expect(app(small).w * app(small).h).toBeLessThan(app(big).w * app(big).h)
      expect(centres(small)).toEqual(centres(big))
      for (const s of [small, big]) {
        expect(collisions(s)).toEqual([])
        expectEdgesOnBoxes(s)
      }
    })

    it(`lays out again for values nothing declared reaches, and keeps the rest (${direction})`, async () => {
      const [one, three, five] = [await at({ shards: 1 }), await at({ shards: 3 }), await at({ shards: 5 })]
      expect(centres(three)).toEqual(centres(one))
      const db = (s: Scene) => s.nodes.find((n) => n.id === 'db')!
      expect(db(five).w).toBeGreaterThan(db(one).w)
      expect(collisions(five)).toEqual([])
      expectEdgesOnBoxes(five)
    })
  }

  it('reaches every step of a short range: three pods pack taller than four', async () => {
    const r = defineModel({
      load: p.load({ max: 10 }),
      params: { pods: p.range({ label: 'Pods', min: 1, max: 4, default: 2 }) },
      flows: { requests: { rate: ({ load }) => 100 * load } },
      components: {
        app: { name: 'App', capacity: ({ pods }) => measured(pods, 'cores'), demand: () => 1, over: 'x' },
      },
      stages: { app: workers('app', { pods: ({ pods }) => pods, perPod: 4 }) },
      routes: { requests: ['app'] },
    })
    const v = defineView(r, {
      nodes: { users: node({ label: 'Users' }), app: pool({ label: 'App', stage: 'app' }) },
      edges: [edge('users', 'app')],
      flows: { requests: { from: 'users', color: 'accent' } },
    })
    const [two, three] = [await layout(v, r.evaluate({ pods: 2 })), await layout(v, r.evaluate({ pods: 3 }))]
    expect(centres(three)).toEqual(centres(two))
  })

  it('leaves out a combination the model cannot evaluate, and lays out the rest', async () => {
    const r = defineModel({
      load: p.load({ max: 10 }),
      params: { region: p.select({ label: 'Region', options: ['eu', 'us', 'moon'], default: 'eu' }) },
      flows: { requests: { rate: ({ load }) => 100 * load } },
      components: { app: { name: 'App', capacity: measured(4, 'cores'), demand: () => 1, over: 'x' } },
      stages: {
        app: workers('app', {
          pods: ({ region }) => {
            if (region === 'moon') throw new Error('no pods on the moon')
            return region === 'us' ? 4 : 2
          },
          perPod: 4,
        }),
      },
      routes: { requests: ['app'] },
    })
    const v = defineView(r, {
      nodes: { users: node({ label: 'Users' }), app: pool({ label: 'App', stage: 'app' }) },
      edges: [edge('users', 'app')],
      flows: { requests: { from: 'users', color: 'accent' } },
    })
    const [eu, us] = [await layout(v, r.evaluate()), await layout(v, r.evaluate({ region: 'us' }))]
    expect(centres(us)).toEqual(centres(eu))
  })

  it('never moves with the load', async () => {
    const a = await layout(view, m.evaluate({ load: 1, pods: 4 }))
    expect(await layout(view, m.evaluate({ load: 10, pods: 4 }))).toBe(a)
  })
})
