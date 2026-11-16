import { defineModel, measured, p, pass } from '@loadmap/core'
import { collisions, defineView, edge, layout, node, type Scene, structureKey } from '@loadmap/layout'
import { describe, expect, it } from 'vitest'
import { expectEdgesOnBoxes } from '../../../examples/phases'

const m = defineModel({
  load: p.load({ max: 10 }),
  flows: { f: { rate: ({ load }) => load } },
  components: { b: { name: 'B', demand: ({ flows }) => flows.f, capacity: measured(100, 'req/s'), over: 'x' } },
  stages: { b: pass('b') },
  routes: { f: ['b'] },
})
const ids = ['a', 'b', 'c', 'd', 'e', 'g', 'h', 'i'] as const
const nodes = {
  a: node({ label: 'A' }),
  b: node({ label: 'B', stage: 'b' }),
  c: node({ label: 'C' }),
  d: node({ label: 'D' }),
  e: node({ label: 'E' }),
  g: node({ label: 'G' }),
  h: node({ label: 'H' }),
  i: node({ label: 'I' }),
}
// a chain of eight, with an edge that skips from the second box to the last
const edges = [...ids.slice(1).map((id, i) => edge(ids[i]!, id)), edge('b', 'i')]
const flows = { f: { from: 'a' as const, color: 'accent' } }
const chain = defineView(m, { nodes, edges, flows })

const box = (s: Scene, id: string) => s.nodes.find((n) => n.id === id)!
/** Where a box stands along the flow and across it. */
const along = (s: Scene, id: string) => (s.direction === 'DOWN' ? box(s, id).y : box(s, id).x)
/** The chain row by row: a box that stands before the one it follows starts a new row. */
const rowsOf = (s: Scene) => {
  const rows: string[][] = []
  for (const id of ids.filter((id) => s.nodes.some((n) => n.id === id))) {
    const last = rows.at(-1)?.at(-1)
    if (last && along(s, id) > along(s, last)) rows.at(-1)!.push(id)
    else rows.push([id])
  }
  return rows
}

describe('a diagram folded into rows', () => {
  for (const direction of ['RIGHT', 'DOWN'] as const) {
    it(`puts a long chain in two rows, half as long, each in the flow's order (${direction})`, async () => {
      const one = await layout(chain, m.evaluate(), { direction })
      const two = await layout(chain, m.evaluate(), { direction, rows: 2 })
      expect(rowsOf(one)).toEqual([[...ids]])
      expect(rowsOf(two)).toEqual([ids.slice(0, 4), ids.slice(4)])
      const length = (s: Scene) => (direction === 'DOWN' ? s.height : s.width)
      expect(length(two)).toBeLessThan(length(one) * 0.65)
      // every row starts where the first does
      expect(along(two, 'e')).toBeCloseTo(along(two, 'a'), 0)
      expect(collisions(two)).toEqual([])
      expectEdgesOnBoxes(two)
      // nothing is drawn outside the board
      for (const e of two.edges)
        for (const [x, y] of e.points) {
          expect(x).toBeGreaterThanOrEqual(0)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(x).toBeLessThanOrEqual(two.width)
          expect(y).toBeLessThanOrEqual(two.height)
        }
    })

    it(`takes an edge to the next row round the end of its row, clear of every box (${direction})`, async () => {
      const s = await layout(chain, m.evaluate(), { direction, rows: 2 })
      const round = s.edges.filter((e) => rowsOf(s)[0]!.includes(e.from) && rowsOf(s)[1]!.includes(e.to))
      // d → e and the edge that skips from b
      expect(round.map((e) => `${e.from}>${e.to}`).sort()).toEqual(['b>i', 'd>e'])
      for (const e of round)
        for (let i = 1; i < e.points.length; i++) {
          const [p, q] = [e.points[i - 1]!, e.points[i]!]
          const [x0, x1, y0, y1] = [
            Math.min(p[0], q[0]),
            Math.max(p[0], q[0]),
            Math.min(p[1], q[1]),
            Math.max(p[1], q[1]),
          ]
          for (const n of s.nodes)
            expect(x1 <= n.x || x0 >= n.x + n.w || y1 <= n.y || y0 >= n.y + n.h, `${e.id} over ${n.id}`).toBe(true)
        }
      // side by side the way round, never on one line
      const [first, second] = round.map((e) => e.points)
      const flat = (ps: [number, number][]) => new Set(ps.map((p) => p.join()))
      expect([...flat(first!)].filter((p) => flat(second!).has(p))).toEqual([])
    })
  }

  it('is one row unless told, and never more rows than layers', async () => {
    const ev = m.evaluate()
    expect(await layout(chain, ev, { rows: 1 })).toEqual(await layout(chain, ev))
    expect(structureKey(chain, ev, { rows: 1 })).toBe(structureKey(chain, ev))
    expect(structureKey(chain, ev, { rows: 2 })).not.toBe(structureKey(chain, ev))
    expect((await layout(chain, ev, { rows: 2 })).key).toBe(structureKey(chain, ev, { rows: 2 }))
    const short = defineView(m, { nodes: { a: nodes.a, b: nodes.b }, edges: [edge('a', 'b')], flows })
    expect(rowsOf(await layout(short, ev, { rows: 5 }))).toEqual([['a'], ['b']])
  })

  it('never moves with the load', async () => {
    const at = async (load: number) => layout(chain, m.evaluate({ load }), { rows: 3 })
    expect(await at(10)).toEqual(await at(1))
  })

  for (const direction of ['RIGHT', 'DOWN'] as const)
    it(`gives each row its lanes, and cuts between two tiers rather than inside one (${direction})`, async () => {
      const tier = (id: string) => (['a', 'b', 'c'].includes(id) ? 'front' : id === 'i' ? 'store' : 'back')
      const view = defineView(m, {
        nodes: {
          a: { ...nodes.a, tier: 'front' },
          b: { ...nodes.b, tier: 'front' },
          c: { ...nodes.c, tier: 'front' },
          d: { ...nodes.d, tier: 'back' },
          e: { ...nodes.e, tier: 'back' },
          g: { ...nodes.g, tier: 'back' },
          h: { ...nodes.h, tier: 'back' },
          i: { ...nodes.i, tier: 'store' },
        },
        edges,
        flows,
        tiers: { front: { label: 'Front' }, back: { label: 'Back' }, store: { label: 'Store' } },
      })
      const s = await layout(view, m.evaluate(), { direction, rows: 2 })
      // three and five rather than four and four: the cut falls where the front ends
      expect(rowsOf(s)).toEqual([ids.slice(0, 3), ids.slice(3)])
      expect(s.tiers.map((t) => t.id)).toEqual(['front', 'back', 'store'])
      // each lane holds its boxes, its header clear of them, and no lane lies over another
      for (const t of s.tiers) {
        for (const id of ids.filter((id) => tier(id) === t.id)) {
          const n = box(s, id)
          expect(n.x).toBeGreaterThanOrEqual(t.x)
          expect(n.x + n.w).toBeLessThanOrEqual(t.x + t.w)
          expect(n.y).toBeGreaterThanOrEqual(t.y)
          expect(n.y + n.h).toBeLessThanOrEqual(t.y + t.h)
          const h = t.head
          expect(n.x >= h.x + h.w || n.x + n.w <= h.x || n.y >= h.y + h.h || n.y + n.h <= h.y).toBe(true)
        }
        for (const u of s.tiers)
          if (u !== t)
            expect(
              u.x >= t.x + t.w || u.x + u.w <= t.x || u.y >= t.y + t.h || u.y + u.h <= t.y,
              `${t.id} ${u.id}`,
            ).toBe(true)
      }
      expect(collisions(s)).toEqual([])
      expectEdgesOnBoxes(s)

      // a tier longer than a row has a lane in each row it reaches, named after the row
      const wide = defineView(m, {
        nodes: {
          a: { ...nodes.a, tier: 'front' },
          b: { ...nodes.b, tier: 'back' },
          c: { ...nodes.c, tier: 'back' },
          d: { ...nodes.d, tier: 'back' },
          e: { ...nodes.e, tier: 'back' },
          g: { ...nodes.g, tier: 'back' },
          h: { ...nodes.h, tier: 'back' },
          i: { ...nodes.i, tier: 'store' },
        },
        edges,
        flows,
        tiers: { front: { label: 'Front' }, back: { label: 'Back' }, store: { label: 'Store' } },
      })
      const three = await layout(wide, m.evaluate(), { direction, rows: 3 })
      // the first cut falls where the front ends, the second inside the back
      expect(three.tiers.map((t) => t.id)).toEqual(['front', 'back', 'back/3', 'store'])
      expect(collisions(three)).toEqual([])
    })
})
