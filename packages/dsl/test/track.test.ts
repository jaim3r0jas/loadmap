import { describe, expect, it } from 'vitest'
import type { DslSymbol } from '../src'
import { changedBoxes, type Drawn } from '../src/track'

const box = (id: string, x: number, w = 100, extra = {}) => ({ id, x, y: 0, w, h: 60, stages: [], ...extra })
const edge = (from: string, to: string) => ({ id: `${from}->${to}`, from, to, points: [] })
const drawn = (nodes: object[], edges: object[] = [], o: object = {}): Drawn =>
  ({
    scene: { nodes, edges, stageNode: { topic: 'kafka' }, flowFrom: { orders: 'phones' }, ...o },
    ev: { stages: {}, components: {}, routes: { orders: ['topic'] } },
  }) as unknown as Drawn
const sym = (kind: DslSymbol['kind'], id: string, from: number, to: number, detail?: string): DslSymbol => ({
  kind,
  id,
  span: { from, to: from + id.length },
  decl: { from, to },
  detail,
})

describe('what an edit changed on the board', () => {
  const text = 'node db "Postgres" {\n  capacity: 1\n}\nflow orders { rate: 2 }\nphones -> gateway\n'
  const was = drawn([box('phones', 0), box('gateway', 200), box('kafka', 400), box('db', 600)])

  it('is the box whose lines the edit is in, not the boxes that only moved to make room', () => {
    const now = drawn([box('phones', 0), box('gateway', 250), box('kafka', 450), box('db', 650)])
    const at = text.indexOf('1')
    expect(changedBoxes(was, now, text, [{ from: at, to: at + 1 }], [sym('node', 'db', 0, 36)])).toEqual(['db'])
  })

  it('follows a flow to the boxes on its route, and an edge line to the boxes it names', () => {
    const at = text.indexOf('2')
    const flow = sym('flow', 'orders', text.indexOf('flow'), text.indexOf('}\n', at) + 1)
    expect(changedBoxes(was, was, text, [{ from: at, to: at + 1 }], [flow])).toEqual(['phones', 'kafka'])
    const line = text.indexOf('gateway')
    expect(changedBoxes(was, was, text, [{ from: line, to: line }], [])).toEqual(['phones', 'gateway'])
    // new lines typed above an edge are not the edge's
    const above = 'gateway -> kafka\nphones -> gateway\n'
    expect(changedBoxes(was, was, above, [{ from: 0, to: 17 }], [])).toEqual(['gateway', 'kafka'])
    // written without spaces, as typing leaves it until Format
    const tight = 'phones->gateway\n'
    expect(changedBoxes(was, was, tight, [{ from: 0, to: 2 }], [])).toEqual(['phones', 'gateway'])
  })

  it('takes a box that is new, or another size, and the ends of an edge that came or went', () => {
    const now = drawn(
      [box('phones', 0), box('gateway', 200, 140), box('kafka', 400), box('db', 600), box('cache', 800)],
      [edge('gateway', 'cache')],
    )
    expect(changedBoxes(was, now, text, [], [])).toEqual(['gateway', 'cache'])
    const gone = drawn([box('phones', 0), box('gateway', 200), box('db', 600)])
    expect(changedBoxes(drawn(was.scene.nodes, [edge('gateway', 'kafka')]), gone, text, [], [])).toEqual(['gateway'])
  })

  it('falls back on the boxes whose component changed state', () => {
    const at = (state: string) =>
      ({
        ...drawn([box('db', 600, 100, { component: 'db' })]),
        ev: { components: { db: { state } }, stages: {}, routes: {} },
      }) as unknown as Drawn
    expect(changedBoxes(at('ok'), at('over'), text, [], [])).toEqual(['db'])
    expect(changedBoxes(at('ok'), at('ok'), text, [], [])).toEqual([])
  })
})
