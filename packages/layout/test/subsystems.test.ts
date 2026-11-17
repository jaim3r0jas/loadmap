import { defineModel, measured, p, pass } from '@loadmap/core'
import {
  type AnyNodeDef,
  collisions,
  defineView,
  type EdgeDef,
  edge,
  layout,
  node,
  type Scene,
  type TierDef,
} from '@loadmap/layout'
import { morph } from '@loadmap/layout/internal'
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
