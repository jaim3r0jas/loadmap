import { defineModel, measured, p, pass, sink } from '@loadmap/core'
import { collisions, defineView, edge, layout, node, type Scene } from '@loadmap/layout'
import { describe, expect, it } from 'vitest'
import { expectEdgesOnBoxes } from '../../../examples/phases'

// a chain a → b → c → d, a source x that feeds d late, and a sink s that b feeds early
const m = defineModel({
  load: p.load({ max: 10 }),
  flows: { f: { rate: ({ load }) => load }, g: { rate: ({ load }) => load } },
  components: { b: { name: 'B', demand: ({ flows }) => flows.f, capacity: measured(100, 'req/s'), over: 'x' } },
  stages: { b: pass('b'), s: sink() },
  routes: { f: ['b'], g: ['b', 's'] },
})
const nodes = {
  a: node({ label: 'A' }),
  b: node({ label: 'B', stage: 'b' }),
  c: node({ label: 'C' }),
  d: node({ label: 'D' }),
  x: node({ label: 'X' }),
  s: node({ label: 'S', stage: 's' }),
}
const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('x', 'd'), edge('b', 's')]
const flows = { f: { from: 'a' as const, color: 'accent' }, g: { from: 'a' as const, color: 'alt' } }

const along = (s: Scene, id: string) => {
  const n = s.nodes.find((x) => x.id === id)!
  return s.direction === 'DOWN' ? [n.y, n.y + n.h] : [n.x, n.x + n.w]
}

describe('the order along the flow', () => {
  it('puts what nothing feeds first and a sink that feeds nothing last', async () => {
    const view = defineView(m, { nodes, edges, flows })
    const s = await layout(view, m.evaluate())
    expect(s.tiers).toEqual([])
    const starts = Object.keys(nodes).map((id) => along(s, id)[0]!)
    expect(along(s, 'x')[0]).toBe(Math.min(...starts))
    expect(along(s, 'a')[0]).toBe(Math.min(...starts))
    expect(along(s, 's')[0]).toBe(Math.max(...starts))
  })

  for (const direction of ['RIGHT', 'DOWN'] as const)
    it(`cuts the diagram into tiers in their order, a box without one in the tier that feeds it (${direction})`, async () => {
      const view = defineView(m, {
        nodes: { ...nodes, b: { ...nodes.b, tier: 'app' }, d: { ...nodes.d, tier: 'data' } },
        edges,
        flows,
        tiers: {
          edge: { label: 'Edge' },
          app: { label: 'Services and what they call, '.repeat(20) },
          data: { label: 'Data' },
        },
      })
      const s = await layout(view, m.evaluate(), { direction })
      // nothing stands in "edge"; a takes the tier of b, which it feeds; c and s that of b, which feeds them
      expect(s.tiers.map((t) => t.id)).toEqual(['app', 'data'])
      const band = (id: string) => s.tiers.find((t) => t.id === id)!
      const span = (t: Scene['tiers'][number]) => (direction === 'DOWN' ? [t.y, t.y + t.h] : [t.x, t.x + t.w])
      const inBand = (id: string, t: string) => {
        const [a, b] = along(s, id)
        const [lo, hi] = span(band(t))
        return a! >= lo! && b! <= hi!
      }
      for (const id of ['a', 'b', 'c', 's']) expect(inBand(id, 'app'), id).toBe(true)
      for (const id of ['d', 'x']) expect(inBand(id, 'data'), id).toBe(true)
      // the bands tile the board, the whole of it across the flow
      const length = direction === 'DOWN' ? s.height : s.width
      expect(span(band('app'))[0]).toBe(0)
      expect(span(band('app'))[1]).toBe(span(band('data'))[0])
      expect(span(band('data'))[1]).toBe(length)
      for (const t of s.tiers) expect(direction === 'DOWN' ? t.w : t.h).toBe(direction === 'DOWN' ? s.width : s.height)
      expect(band('app').vertical).toBe(direction === 'DOWN')
      // a label too long for its band is cut short
      expect(band('app').text.endsWith('…')).toBe(true)
      expect(band('data').text).toBe('Data')
      expect(collisions(s)).toEqual([])
      expectEdgesOnBoxes(s)
    })

  it('puts a box in the latest tier of all that feed it, whatever order the boxes come in', async () => {
    // x is fed by p (tier a) and by y, which q (tier b) feeds: y stands in b, so x does too
    const view = defineView(m, {
      nodes: {
        x: node({ label: 'X' }),
        y: node({ label: 'Y' }),
        p: node({ label: 'P', tier: 'a' }),
        q: node({ label: 'Q', tier: 'b' }),
        b: node({ label: 'B', stage: 'b' }),
        s: node({ label: 'S', stage: 's' }),
      },
      edges: [edge('p', 'x'), edge('y', 'x'), edge('q', 'y'), edge('x', 'b'), edge('b', 's')],
      flows: { f: { from: 'p', color: 'accent' }, g: { from: 'p', color: 'alt' } },
      tiers: { a: { label: 'A' }, b: { label: 'B' } },
    })
    const s = await layout(view, m.evaluate())
    const b = s.tiers.find((t) => t.id === 'b')!
    for (const id of ['x', 'y', 'b', 's']) expect(along(s, id)[0]!, id).toBeGreaterThanOrEqual(b.x)
  })

  it('refuses a box in a tier the view does not declare', () => {
    expect(() =>
      defineView(m, {
        // @ts-expect-error: the tiers declared are the only ones a box can name
        nodes: { ...nodes, b: { ...nodes.b, tier: 'nope' } },
        edges,
        flows,
        tiers: { app: { label: 'App' } },
      }),
    ).toThrow('node "b" stands in unknown tier "nope"')
  })
})
