import { defineModel, measured, p, pass, sink } from '@loadmap/core'
import { defineView, directionOf, edge, layout, node, type ViewDef } from '@loadmap/layout'
import { describe, expect, it } from 'vitest'

const sinks = ['s1', 's2', 's3', 's4', 's5'] as const
const m = defineModel({
  load: p.load({ max: 10 }),
  params: { on: p.switch({ label: 'On', default: false }) },
  flows: { f: { rate: ({ load }) => load } },
  components: { a: { name: 'A', demand: ({ flows }) => flows.f, capacity: measured(10, 'req/s'), over: 'x' } },
  stages: { a: pass('a'), ...Object.fromEntries(sinks.map((s) => [s, sink()])) },
  routes: { f: ['a'] },
})
/**
 * A view of the edges written `a>b a>c`; `when` is one more edge, drawn only while a switch is on. Boxes s1 to s5 are
 * sinks, there whether an edge reaches them or not.
 */
const view = (edges: string, when?: string) => {
  const pairs = (s: string) => s.split(' ').map((e) => e.split('>') as [string, string])
  const all = pairs(edges)
  const ids = [...new Set([...all, ...(when ? pairs(when) : [])].flat())]
  return defineView(m, {
    nodes: {
      ...Object.fromEntries(ids.map((id) => [id, node({ label: id })])),
      ...Object.fromEntries(sinks.map((s) => [s, node({ label: s, stage: s })])),
      a: node({ label: 'a', stage: 'a' }),
    },
    edges: [
      ...all.map(([a, b]) => edge(a, b)),
      ...(when ? pairs(when).map(([a, b]) => edge(a, b, { when: ({ on }) => on })) : []),
    ],
    flows: { f: { from: 'a', color: 'accent' } },
  } as ViewDef<'f', string, string>)
}
const shape = (edges: string, when?: string) => directionOf(view(edges, when))

describe('the direction from the shape', () => {
  it('runs a chain right', () => {
    expect(shape('a>b b>c c>d')).toBe('RIGHT')
  })

  it('runs a fan-out wider than it is long down', () => {
    expect(shape('a>b a>c a>d a>e')).toBe('DOWN')
    // a box after one of the four keeps it down: three layers, four side by side
    expect(shape('a>b a>c a>d a>e b>f')).toBe('DOWN')
    // one more makes the chain as long as the fan is wide: right
    expect(shape('a>b a>c a>d a>e b>f f>g')).toBe('RIGHT')
  })

  it('runs right on a tie', () => {
    expect(shape('a>b a>c')).toBe('RIGHT')
  })

  it('counts an edge whatever its when, so no value turns it', () => {
    // with b → c, the boxes stand in three layers, at most two side by side
    expect(shape('a>b a>c a>d', 'b>c')).toBe('RIGHT')
    expect(shape('a>b a>c a>d')).toBe('DOWN')
  })

  it('cuts a loop where the flow comes back, whatever order the boxes are declared in', () => {
    expect(shape('a>b b>c c>a')).toBe('RIGHT')
    expect(shape('a>b a>c a>d b>a')).toBe('DOWN')
    // the boxes come in another order; the loop is cut at the same edge
    expect(shape('c>a a>b b>c b>d b>e')).toBe(shape('a>b b>c b>d b>e c>a'))
  })

  it('leaves out a box with no edge: it is packed beside the rest', () => {
    // five sinks no edge reaches stand in every view here; a chain of four still runs right
    expect(shape('a>b b>c c>d')).toBe('RIGHT')
  })

  it('counts the sinks and stores that feed nothing in the last layer, where ELK draws them', () => {
    // a chain of five, each box feeding a sink on the way: the five sinks stand beside e, six against five layers
    expect(shape('a>b b>c c>d d>e a>s1 b>s2 c>s3 d>s4 a>s5')).toBe('DOWN')
  })

  it('is what layout() runs by when it is not told', async () => {
    const fan = view('a>b a>c a>d a>e')
    expect((await layout(fan, m.evaluate())).direction).toBe('DOWN')
    expect((await layout(fan, m.evaluate(), { direction: 'RIGHT' })).direction).toBe('RIGHT')
  })
})
