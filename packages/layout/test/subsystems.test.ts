import { defineModel, measured, p, pass } from '@loadmap/core'
import {
  type AnyNodeDef,
  collisions,
  defineView,
  type EdgeDef,
  edge,
  labelsAt,
  layout,
  node,
  type Scene,
  type TierDef,
} from '@loadmap/layout'
import { closing, morph } from '@loadmap/layout/internal'
import { describe, expect, it } from 'vitest'
import { expectEdgesOnBoxes } from '../../../examples/phases'

// in -> [eu: lb -> [orders: queue -> work] -> db] -> out, and the same again as us; b is the one component. A box
// stands in the subsystem its id starts with: eu.orders.queue in eu.orders, which stands in eu
const m = defineModel({
  load: p.load({ max: 10 }),
  flows: { f: { rate: ({ load }) => load } },
  components: { b: { name: 'B', demand: ({ flows }) => flows.f, capacity: measured(100, 'req/s'), over: 'x' } },
  stages: { b: pass('b') },
  routes: { f: ['b'] },
})
const region = (r: string, tiers: readonly [string, string, string] | [] = []) => ({
  [`${r}.lb`]: node({ label: 'LB', ...(tiers[0] ? { tier: tiers[0] } : {}) }),
  [`${r}.orders.queue`]: node({ label: 'Queue', ...(tiers[1] ? { tier: tiers[1] } : {}) }),
  [`${r}.orders.work`]: node({ label: 'Workers', ...(tiers[1] ? { tier: tiers[1] } : {}) }),
  [`${r}.db`]: node({ label: 'Database', ...(tiers[2] ? { tier: tiers[2] } : {}) }),
})
const wires = (r: string): EdgeDef[] => [
  edge('in', `${r}.lb`),
  edge(`${r}.lb`, `${r}.orders.queue`, { label: ({ load }) => `${String(load).repeat(Number(load))} a second` }),
  edge(`${r}.orders.queue`, `${r}.orders.work`),
  edge(`${r}.orders.work`, `${r}.db`),
  edge(`${r}.db`, 'out'),
]
const subsystems = {
  eu: { label: 'EU region' },
  'eu.orders': { label: 'Orders' },
  us: { label: 'US region' },
  'us.orders': { label: 'Orders' },
}
const flows = { f: { from: 'in' as const, color: 'accent' } }
const TIERS: Record<string, TierDef> = { front: { label: 'Front' }, app: { label: 'App' }, data: { label: 'Data' } }
const view = (tiers: readonly [string, string, string] | [] = []) => {
  const nodes: Record<string, AnyNodeDef<'b', string>> = {
    in: node({ label: 'In', stage: 'b' }),
    ...region('eu', tiers),
    ...region('us', tiers),
    out: node({ label: 'Out' }),
  }
  return defineView(m, {
    nodes,
    edges: [...wires('eu'), ...wires('us')],
    flows,
    subsystems,
    ...(tiers.length ? { tiers: TIERS } : {}),
  })
}

const frame = (s: Scene, id: string) => s.subsystems.find((x) => x.id === id)!
const holds = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h

describe('a subsystem on the board', () => {
  it('leaves a view without subsystems as it was', async () => {
    const plain = defineView(m, { nodes: { in: node({ label: 'In', stage: 'b' }) }, edges: [], flows })
    expect((await layout(plain, m.evaluate())).subsystems).toEqual([])
  })

  for (const direction of ['RIGHT', 'DOWN'] as const)
    for (const rows of [1, 2])
      it(`frames its boxes and the subsystems in it, clear of everything else (${direction}, ${rows} rows)`, async () => {
        const s = await layout(view(), m.evaluate(), { direction, rows })
        // an outer frame before the ones in it
        expect(s.subsystems.map((x) => [x.id, x.in, x.depth])).toEqual([
          ['eu', undefined, 0],
          ['us', undefined, 0],
          ['eu.orders', 'eu', 1],
          ['us.orders', 'us', 1],
        ])
        expect(frame(s, 'eu').nodes).toEqual(['eu.lb', 'eu.orders.queue', 'eu.orders.work', 'eu.db'])
        expect(frame(s, 'eu.orders').nodes).toEqual(['eu.orders.queue', 'eu.orders.work'])
        expect(frame(s, 'us').label).toBe('US region')
        for (const x of s.subsystems) {
          for (const id of x.nodes)
            expect(holds(x, s.nodes.find((n) => n.id === id)!), `${x.id} holds ${id}`).toBe(true)
          // its name stands inside it, clear of its boxes: above them, or up their left side running down
          expect(x.title.x).toBeGreaterThan(x.x)
          expect(x.title.y).toBeGreaterThan(x.y)
          expect(x.vertical).toBe(direction === 'DOWN')
          for (const id of x.nodes) {
            const n = s.nodes.find((n) => n.id === id)!
            expect(x.vertical ? n.x : n.y).toBeGreaterThan(x.vertical ? x.title.x : x.title.y)
          }
        }
        expect(holds(frame(s, 'eu'), frame(s, 'eu.orders'))).toBe(true)
        const board = { x: 0, y: 0, w: s.width, h: s.height }
        expect(holds(board, frame(s, 'eu')) && holds(board, frame(s, 'us'))).toBe(true)
        expect(collisions(s)).toEqual([])
        expectEdgesOnBoxes(s)
      })

  it('is at least as wide as its name', async () => {
    const label = 'A subsystem with a name far wider than the one box it holds'
    const v = defineView(m, {
      nodes: { 'wide.in': node({ label: 'In', stage: 'b' }) },
      edges: [],
      flows: { f: { from: 'wide.in' as const, color: 'accent' } },
      subsystems: { wide: { label } },
    })
    const s = await layout(v, m.evaluate())
    expect(frame(s, 'wide').w).toBeGreaterThan(label.length * 5)
    expect(collisions(s)).toEqual([])
  })

  it('never moves with the load', async () => {
    const v = view()
    const at = (load: number) => layout(v, m.evaluate({ load }))
    const [a, b] = [await at(1), await at(10)]
    expect(b.subsystems).toEqual(a.subsystems)
    expect(b).toBe(a)
  })

  it('stands in the lane of its tier, and goes without a frame where its boxes stand in several', async () => {
    // each region reaches from the front to the data: only its orders, all in "app", can be framed
    const across = await layout(view(['front', 'app', 'data']), m.evaluate())
    expect(across.subsystems.map((x) => [x.id, x.in, x.depth])).toEqual([
      ['eu.orders', undefined, 0],
      ['us.orders', undefined, 0],
    ])
    const lane = across.tiers.find((t) => t.id === 'app')!
    for (const x of across.subsystems) {
      expect(x.x).toBeGreaterThanOrEqual(lane.x)
      expect(x.x + x.w).toBeLessThanOrEqual(lane.x + lane.w)
    }
    expect(collisions(across)).toEqual([])
    // a region all in one tier keeps its frame, with the frame in it
    const one = await layout(view(['app', 'app', 'app']), m.evaluate())
    expect(one.subsystems.map((x) => x.id)).toEqual(['eu', 'us', 'eu.orders', 'us.orders'])
    expect(collisions(one)).toEqual([])
    // running down, a frame in a frame takes more room before its boxes than the lanes are apart: its lane holds it
    const nodes: Record<string, AnyNodeDef<'b', string>> = {
      in: node({ label: 'In', stage: 'b', tier: 'front' }),
      ...region('eu', ['app', 'app', 'app']),
    }
    const down = await layout(
      defineView(m, { nodes, edges: wires('eu').slice(0, 4), flows, subsystems, tiers: TIERS }),
      m.evaluate(),
      { direction: 'DOWN' },
    )
    const app = down.tiers.find((t) => t.id === 'app')!
    for (const x of down.subsystems) {
      expect(x.y, x.id).toBeGreaterThanOrEqual(app.y)
      expect(x.y + x.h, x.id).toBeLessThanOrEqual(app.y + app.h)
    }
    expect(collisions(down)).toEqual([])
  })

  it('takes a box by its name: the longest subsystem id it starts with', async () => {
    const v = defineView(m, {
      nodes: { 'a.b.in': node({ label: 'In', stage: 'b' }), 'a.x': node({ label: 'X' }), ab: node({ label: 'AB' }) },
      edges: [],
      flows: { f: { from: 'a.b.in' as const, color: 'accent' } },
      // "a.b.c" holds no box, and "ab" is no box of "a": neither is drawn
      subsystems: { a: { label: 'A' }, 'a.b': { label: 'B' }, 'a.b.c': { label: 'C' } },
    })
    const s = await layout(v, m.evaluate())
    expect(s.subsystems.map((x) => [x.id, x.in, x.nodes])).toEqual([
      ['a', undefined, ['a.b.in', 'a.x']],
      ['a.b', 'a', ['a.b.in']],
    ])
    expect(collisions(s)).toEqual([])
  })

  it('moves with its boxes from one scene to the next, and fades where it comes or goes', async () => {
    const to = await layout(view(), m.evaluate())
    const from: Scene = {
      ...to,
      subsystems: to.subsystems.flatMap((x) =>
        x.id === 'us.orders'
          ? []
          : x.id === 'eu'
            ? [{ ...x, x: x.x + 100, title: { ...x.title, x: x.title.x + 100 } }]
            : [x],
      ),
    }
    const mid = morph(from, to)(0.5)
    const eu = frame(mid, 'eu')
    expect(eu.x).toBeGreaterThan(frame(to, 'eu').x)
    expect(eu.x).toBeLessThan(frame(to, 'eu').x + 100)
    expect(eu.title.x - eu.x).toBeCloseTo(frame(to, 'eu').title.x - frame(to, 'eu').x, 6)
    // new in `to`: not there yet at the half
    expect(frame(mid, 'us.orders').fade).toBe(0)
    // gone in `to`: still listed while it fades out
    const back = morph(to, from)(0.1)
    expect(frame(back, 'us.orders').fade).toBeGreaterThan(0)
    expect(frame(back, 'us.orders').fade).toBeLessThan(1)
    expect(morph(from, to)(1)).toBe(to)
  })
})

describe('a closed subsystem', () => {
  // in -> [eu: lb -> [orders: work] -> db] -> out; the balancer and the workers are stages with a component each
  const m2 = defineModel({
    load: p.load({ max: 10 }),
    flows: { f: { rate: ({ load }) => load } },
    components: {
      c1: { name: 'Balancer', demand: ({ flows }) => flows.f, capacity: measured(100, 'req/s'), over: 'x' },
      c2: { name: 'Workers', demand: ({ flows }) => flows.f, capacity: measured(10, 'req/s'), over: 'x' },
    },
    stages: { lb: pass('c1'), work: pass('c2') },
    routes: { f: ['lb', 'work'] },
  })
  const v = defineView(m2, {
    nodes: {
      in: node({ label: 'In' }),
      'eu.lb': node({ label: 'LB', stage: 'lb' }),
      'eu.orders.work': node({ label: 'Workers', stage: 'work' }),
      'eu.db': node({ label: 'Database' }),
      out: node({ label: 'Out' }),
    },
    edges: [
      edge('in', 'eu.lb'),
      edge('eu.lb', 'eu.orders.work'),
      edge('eu.orders.work', 'eu.db'),
      edge('eu.db', 'out'),
    ],
    flows: { f: { from: 'in', color: 'accent' } },
    subsystems: { eu: { label: 'EU region' }, 'eu.orders': { label: 'Orders' } },
  })
  const ev = m2.evaluate({ load: 5 })

  it('is one box that stands for everything inside it', async () => {
    const close = (await closing(v))!
    const shut = close(v, ['eu'])
    const s = await layout(shut, ev)
    expect(s.nodes.map((n) => n.id)).toEqual(['in', 'eu', 'out'])
    expect(s.subsystems).toEqual([])
    const eu = s.nodes.find((n) => n.id === 'eu')!
    // every stage inside is shown by the box: dots pass through it, and a limit inside is its limit
    expect(eu).toMatchObject({ subsystem: 'eu', stages: ['lb', 'work'], kind: 'node' })
    expect(s.stageNode).toEqual({ lb: 'eu', work: 'eu' })
    // an edge keeps its id open and closed; the ones that ran inside are not drawn
    expect(s.edges.map((e) => [e.id, e.from, e.to])).toEqual([
      ['e0', 'in', 'eu'],
      ['e3', 'eu', 'out'],
    ])
    // its name wears the mark of a closed folder, and its second line names the busiest component inside
    const { title, sub } = labelsAt(shut, ev).nodes.eu!
    expect(title).toBe('\u25B8 EU region')
    expect(sub).toMatch(/^Workers 50\s?%$/)
    expect(collisions(s)).toEqual([])
    expectEdgesOnBoxes(s)
  })

  it('closes one inside another on its own, in the frame of the one around it', async () => {
    const close = (await closing(v))!
    const s = await layout(close(v, ['eu.orders']), ev)
    expect(s.nodes.map((n) => n.id)).toEqual(['in', 'eu.lb', 'eu.orders', 'eu.db', 'out'])
    expect(s.subsystems.map((x) => [x.id, x.nodes])).toEqual([['eu', ['eu.lb', 'eu.orders', 'eu.db']]])
    expect(s.stageNode).toEqual({ lb: 'eu.lb', work: 'eu.orders' })
    expect(collisions(s)).toEqual([])
  })

  it('draws the edges that come to join the same two boxes as one, where any of them is drawn', async () => {
    const two = defineView(m, {
      nodes: { in: node({ label: 'In', stage: 'b' }), 'eu.a': node({ label: 'A' }), 'eu.b': node({ label: 'B' }) },
      edges: [edge('in', 'eu.a', { when: ({ load }) => Number(load) > 5 }), edge('in', 'eu.b')],
      flows,
      subsystems: { eu: { label: 'EU region' } },
    })
    const close = (await closing(two))!
    // at this load only the second is drawn open: closed, the one edge is there, in the first's place
    const s = await layout(close(two, ['eu']), m.evaluate({ load: 1 }))
    expect(s.edges.map((e) => [e.id, e.from, e.to])).toEqual([['e0', 'in', 'eu']])
  })

  it('stands in the tier its boxes share, and in none of its own when they stand in several', async () => {
    const tiered = (a: string, b: string) => {
      const nodes: Record<string, AnyNodeDef<'b', string>> = {
        in: node({ label: 'In', stage: 'b', tier: 'front' }),
        'eu.a': node({ label: 'A', tier: a }),
        'eu.b': node({ label: 'B', tier: b }),
      }
      return defineView(m, {
        nodes,
        edges: [edge('in', 'eu.a'), edge('eu.a', 'eu.b')],
        flows,
        subsystems: { eu: { label: 'EU region' } },
        tiers: TIERS,
      })
    }
    const one = tiered('app', 'app')
    expect((await closing(one))!(one, ['eu']).def.nodes.eu).toMatchObject({ tier: 'app' })
    const several = tiered('app', 'data')
    const shut = (await closing(several))!(several, ['eu'])
    expect(shut.def.nodes.eu).not.toHaveProperty('tier')
    expect(collisions(await layout(shut, m.evaluate()))).toEqual([])
  })

  it('gives the same view for the same subsystems, and the view itself when none of its own is closed', async () => {
    const close = (await closing(v))!
    expect(close(v, [])).toBe(v)
    expect(close(v, ['nowhere'])).toBe(v)
    expect(close(v, ['eu'])).toBe(close(v, ['eu']))
    // one in a closed one is closed with it
    expect(close(v, ['eu.orders', 'eu'])).toBe(close(v, ['eu']))
    expect(close(v, ['eu.orders'])).not.toBe(close(v, ['eu']))
    // a view without subsystems has nothing to close, and loads nothing
    const plain = defineView(m, { nodes: { in: node({ label: 'In', stage: 'b' }) }, edges: [], flows })
    expect(closing(plain)).toBeUndefined()
  })
})
