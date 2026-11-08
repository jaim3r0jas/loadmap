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
      // a name too long for its band takes two lines, the second cut short; every header then takes two
      expect(band('app').lines.map((l) => l.text)).toEqual([
        expect.stringMatching(/^SERVICES/),
        expect.stringMatching(/…$/),
      ])
      expect(band('data').lines.map((l) => l.text)).toEqual(['DATA'])
      for (const t of s.tiers) expect(direction === 'DOWN' ? t.head.w : t.head.h).toBe(44)
      expect(collisions(s)).toEqual([])
      expectEdgesOnBoxes(s)
    })

  for (const direction of ['RIGHT', 'DOWN'] as const)
    it(`draws each tier as a lane with a header the boxes and labels stay clear of (${direction})`, async () => {
      const down = direction === 'DOWN'
      const across = (b: { x: number; y: number }) => (down ? b.x : b.y)
      const lanes = (app: string, edgeName = 'Edge') =>
        layout(
          defineView(m, {
            nodes: {
              ...nodes,
              a: { ...nodes.a, tier: 'edge' },
              b: { ...nodes.b, tier: 'app' },
              d: { ...nodes.d, tier: 'data' },
            },
            edges: [...edges.slice(0, 4), edge('b', 's', { label: 'to the sink' })],
            flows,
            tiers: { edge: { label: edgeName }, app: { label: app }, data: { label: 'Data' } },
          }),
          m.evaluate(),
          { direction },
        )
      const one = await lanes('App')
      // one line: a header of 30 px at the band's start, the name in capitals from its start
      for (const t of one.tiers) {
        expect(t.head).toEqual(down ? { x: 0, y: t.y, w: 30, h: t.h } : { x: t.x, y: 0, w: t.w, h: 30 })
        expect(t.lines).toHaveLength(1)
        expect(down ? t.lines[0]!.y : t.lines[0]!.x).toBe((down ? t.y : t.x) + 10)
      }
      expect(one.tiers.map((t) => t.lines[0]!.text)).toEqual(['EDGE', 'APP', 'DATA'])
      // no box and no edge label under a header, the boxes 16 px past it
      expect(collisions(one)).toEqual([])
      expect(Math.min(...one.nodes.map(across))).toBe(30 + 16)

      // a name wider than its band (two layers long: wide running right, short running down) but not than two lines
      // of it: two lines, whole, and every header 14 px deeper; the frame moves with them
      const long = down
        ? 'Application services and background workers'
        : 'Application services, background workers and the schedulers'
      const two = await lanes(long)
      const app = two.tiers.find((t) => t.id === 'app')!
      expect(app.lines.map((l) => l.text).join(' ')).toBe(long.toUpperCase())
      expect(app.lines).toHaveLength(2)
      for (const t of two.tiers) expect(down ? t.head.w : t.head.h).toBe(44)
      expect(two.tiers.find((t) => t.id === 'edge')!.lines.map((l) => l.text)).toEqual(['EDGE'])
      expect(collisions(two)).toEqual([])
      expect(down ? two.width : two.height).toBe((down ? one.width : one.height) + 14)
      expect(two.nodes.map((n) => across(n) - 14)).toEqual(one.nodes.map(across))
      expectEdgesOnBoxes(two)

      // a first word wider than its band is cut short, and what follows still takes the second line; spaces in a
      // row count as one
      const word = await lanes('App', 'Supercalifragilisticexpialidocious   gateway')
      const gate = word.tiers.find((t) => t.id === 'edge')!.lines.map((l) => l.text)
      expect(gate).toEqual([expect.stringMatching(/^SUPER.*…$/), expect.stringMatching(/^GATE/)])
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
