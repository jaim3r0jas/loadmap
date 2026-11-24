import { defineModel, measured, p, pass, store } from '@loadmap/core'
import { anchor, defineView, edge, layout, node } from '@loadmap/layout'
import { describe, expect, it } from 'vitest'
import { expectCompact, expectSteady } from '../../../examples/phases'

// a database sharded by key: its parts on three members, half of the writes on the hottest key
const m = defineModel({
  load: p.load({ max: 10 }),
  params: { parts: p.select({ label: 'Parts', options: [6, 9], default: 6 }) },
  flows: { writes: { rate: ({ load }) => 100 * load } },
  components: {
    gate: { name: 'Gateway', capacity: measured(10_000, 'req/s'), over: 'x' },
    db: { name: 'Database', capacity: measured(5_000, 'writes/s'), over: 'x' },
  },
  stages: { gate: pass('gate'), db: store('db') },
  routes: { writes: ['gate', 'db'] },
  connections: {
    shard: {
      from: 'gate',
      to: 'db',
      assign: 'key',
      members: 3,
      parts: ({ parts }) => parts,
      skew: measured(0.5, 'share'),
    },
  },
})
const view = defineView(m, {
  nodes: {
    users: node({ label: 'Users' }),
    gate: node({ label: 'Gateway', stage: 'gate' }),
    db: node({ label: 'Database', stage: 'db' }),
  },
  edges: [edge('users', 'gate'), edge('gate', 'db')],
  flows: { writes: { from: 'users', color: 'accent' } },
})

describe('a store sharded by key', () => {
  it('draws its members, each holding the parts it keeps: part i on member i mod members', async () => {
    const scene = await layout(view, m.evaluate({}))
    const db = scene.nodes.find((n) => n.id === 'db')!
    expect(db.members.map((x) => x.label)).toEqual(['member 0', 'member 1', 'member 2'])
    expect(db.cells.map((c) => c.index).sort()).toEqual([0, 1, 2, 3, 4, 5])
    const inside = (c: { x: number; y: number }, b: { x: number; y: number; w: number; h: number }) =>
      c.x >= b.x && c.x <= b.x + b.w && c.y >= b.y && c.y <= b.y + b.h
    for (const c of db.cells) expect(inside(c, db.members[c.index % 3]!)).toBe(true)
    // a dot sent to part 0 sits in member 0
    const [x, y] = anchor(scene, { stage: 'db', cell: 0 }, 'writes')
    expect(inside({ x, y }, db.members[0]!)).toBe(true)
    // the plain box beside it holds none
    expect(scene.nodes.find((n) => n.id === 'gate')!.members).toEqual([])
  })

  it('moves no box as its parts change, laid out stable or compact', async () => {
    await expectSteady(view, m, 'RIGHT')
    await expectCompact(view, m, 'RIGHT')
  })
})
