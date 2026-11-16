import { defineModel, measured, p, pass, sink } from '@loadmap/core'
import { defineView, directionOf, edge, layout, node, type ViewDef } from '@loadmap/layout'
import { extent } from '@loadmap/layout/internal'
import { describe, expect, it } from 'vitest'
import { arrangementFor } from '../src/fold'

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

describe('the arrangement for a room', () => {
  const chain = view('a>b b>c c>d d>e e>g g>h')
  const sized = async (direction: 'RIGHT' | 'DOWN', rows = 1) => ({
    direction,
    rows,
    ...(await extent(chain, direction, { rows })),
  })
  const ways = async () => [await sized('RIGHT'), await sized('DOWN')]
  const right = { direction: 'RIGHT', rows: 1 } as const
  const down = { direction: 'DOWN', rows: 1 } as const

  it('knows how large each way lays a view out, the same as the scene where nothing changes it', async () => {
    const [RIGHT, DOWN] = await ways()
    const scene = await layout(chain, m.evaluate(), { direction: 'RIGHT' })
    expect(RIGHT).toMatchObject({ width: scene.width, height: scene.height })
    expect(RIGHT!.width).toBeGreaterThan(RIGHT!.height)
    expect(DOWN!.height).toBeGreaterThan(DOWN!.width)
    const folded = await layout(chain, m.evaluate(), { direction: 'RIGHT', rows: 2 })
    expect(await sized('RIGHT', 2)).toMatchObject({ width: folded.width, height: folded.height })
  })

  it('runs a long chain right in a wide room and down in a tall one', async () => {
    const s = await ways()
    expect(arrangementFor(s, { w: 1100, h: 400 }, right)).toEqual(right)
    expect(arrangementFor(s, { w: 400, h: 1100 }, right)).toEqual(down)
    expect(arrangementFor(s, { w: 1100, h: 400 }, down)).toEqual(right)
  })

  const s = [
    { ...right, width: 1000, height: 500 },
    { ...down, width: 500, height: 1000 },
  ]

  it('keeps the way it runs where the other fits no more than a little larger', () => {
    // a square room fits both the same; one a tenth taller fits down a tenth larger
    expect(arrangementFor(s, { w: 600, h: 600 }, right)).toEqual(right)
    expect(arrangementFor(s, { w: 600, h: 600 }, down)).toEqual(down)
    expect(arrangementFor(s, { w: 600, h: 660 }, right)).toEqual(right)
    expect(arrangementFor(s, { w: 600, h: 780 }, right)).toEqual(down)
  })

  it('counts no scale past full size: a diagram that fits as it stands keeps its way', () => {
    const small = [
      { ...right, width: 300, height: 100 },
      { ...down, width: 100, height: 300 },
    ]
    expect(arrangementFor(small, { w: 600, h: 900 }, right)).toEqual(right)
    expect(arrangementFor(small, { w: 200, h: 900 }, right)).toEqual(down)
  })

  // a strip of 2000 × 200, in two rows 1040 × 480, in three 720 × 760
  const rows = [
    { ...right, width: 2000, height: 200 },
    { direction: 'RIGHT', rows: 2, width: 1040, height: 480 },
    { direction: 'RIGHT', rows: 3, width: 720, height: 760 },
  ] as const

  it('folds a diagram only where one row would be hard to read, into the fewest rows that fit about as large', () => {
    // 0.8 in one row: read with ease, left alone though two rows would fit at full size
    expect(arrangementFor(rows, { w: 1600, h: 900 }, right)).toEqual(right)
    // 0.5 in one row, 0.96 in two, 0.99 in three: two
    expect(arrangementFor(rows, { w: 1000, h: 750 }, right)).toEqual({ direction: 'RIGHT', rows: 2 })
    // 0.36 in one row, 0.69 in two, 0.99 in three: three
    expect(arrangementFor(rows, { w: 720, h: 750 }, right)).toEqual({ direction: 'RIGHT', rows: 3 })
    // 0.5 in one row and no better folded: a room too flat for two rows
    expect(arrangementFor(rows, { w: 1000, h: 250 }, right)).toEqual(right)
  })

  it('keeps a fold until one row reads with ease by a margin, and a row count unless another fits clearly larger', () => {
    const two = { direction: 'RIGHT', rows: 2 } as const
    // one row at 0.8: not folded from one row, but not unfolded either until it reaches 0.88
    expect(arrangementFor(rows, { w: 1600, h: 900 }, two)).toEqual(two)
    expect(arrangementFor(rows, { w: 1800, h: 900 }, two)).toEqual(right)
    // three rows fit a tenth larger than two: it stays in two
    expect(arrangementFor(rows, { w: 800, h: 640 }, two)).toEqual(two)
  })

  it('chooses only among the arrangements it is given', () => {
    expect(arrangementFor([s[1]!], { w: 2000, h: 300 }, right)).toEqual(down)
    expect(arrangementFor([rows[1]], { w: 4000, h: 4000 }, right)).toEqual({ direction: 'RIGHT', rows: 2 })
  })
})
