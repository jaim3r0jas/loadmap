import { defineModel, measured, p, store, workers } from '@loadmap/core'
import { defineView, edge, layout, node, pool, type Scene } from '@loadmap/layout'
import { morph } from '@loadmap/layout/internal'
import { describe, expect, it } from 'vitest'

const m = defineModel({
  load: p.load({ max: 10 }),
  params: {
    pods: p.select({ label: 'Pods', options: [2, 4, 6], default: 2 }),
    audit: p.switch({ label: 'Audit log', default: false }),
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
    db: node({ label: 'Database', stage: 'db', shape: 'cylinder' }),
    audit: node({ label: 'Audit log' }),
  },
  edges: [edge('users', 'app'), edge('app', 'db'), edge('app', 'audit', { when: ({ audit }) => audit })],
  flows: { requests: { from: 'users', color: 'accent' } },
})
const at = (v: { pods?: 2 | 4 | 6; audit?: boolean }) => layout(view, m.evaluate(v))
const nodeOf = (s: Scene, id: string) => s.nodes.find((n) => n.id === id)!
const edgeOf = (s: Scene, id: string) => s.edges.find((e) => e.id === id)!
/** The middle of the move: half the way, eased. */
const MID = 0.475

describe('morph', () => {
  it('lands on the new scene itself', async () => {
    const [a, b] = [await at({ pods: 2 }), await at({ pods: 6 })]
    const f = morph(a, b)
    expect(f(1)).toBe(b)
    expect(f(1.5)).toBe(b)
  })

  it('starts where the old scene is, with nothing new showing yet', async () => {
    const [a, b] = [await at({ pods: 2 }), await at({ pods: 6 })]
    const f = morph(a, b)(0)
    expect([f.width, f.height]).toEqual([a.width, a.height])
    for (const n of a.nodes) expect(nodeOf(f, n.id)).toMatchObject({ x: n.x, y: n.y, w: n.w, h: n.h })
    for (const e of a.edges) expect(edgeOf(f, e.id).points.at(-1)).toEqual(e.points.at(-1))
    const app = nodeOf(f, 'app')
    expect(app.members).toHaveLength(6)
    expect(app.members.slice(2).every((x) => x.fade === 0)).toBe(true)
    expect(app.slots.slice(8).every((x) => x.fade === 0)).toBe(true)
    expect(app.members.slice(0, 2).every((x) => x.fade == null)).toBe(true)
  })

  it('moves what stays half the way in the middle', async () => {
    const [a, b] = [await at({ pods: 2 }), await at({ pods: 6 })]
    const f = morph(a, b)(MID)
    for (const id of ['users', 'app', 'db']) {
      const [x, y, n] = [nodeOf(a, id), nodeOf(b, id), nodeOf(f, id)]
      expect(n.x).toBeCloseTo((x.x + y.x) / 2, 6)
      expect(n.w).toBeCloseTo((x.w + y.w) / 2, 6)
      expect(n.title.y).toBeCloseTo((x.title.y + y.title.y) / 2, 6)
    }
    expect(f.width).toBeCloseTo((a.width + b.width) / 2, 6)
    const s = nodeOf(f, 'app').slots[0]!
    expect(s.x).toBeCloseTo((nodeOf(a, 'app').slots[0]!.x + nodeOf(b, 'app').slots[0]!.x) / 2, 6)
  })

  it('fades out what leaves first, and in what is new last', async () => {
    const [two, six] = [await at({ pods: 2 }), await at({ pods: 6 })]
    const fewer = morph(six, two)
    expect(nodeOf(fewer(0.15), 'app').members[5]!.fade).toBeCloseTo(0.5, 6)
    expect(nodeOf(fewer(0.3), 'app').members[5]!.fade).toBe(0)
    const more = morph(two, six)
    expect(nodeOf(more(0.6), 'app').members[5]!.fade).toBe(0)
    expect(nodeOf(more(0.8), 'app').members[5]!.fade).toBeCloseTo(0.5, 6)
  })

  it('goes on from a frame mid-move: a half-faded part neither pops in nor out', async () => {
    const [two, six] = [await at({ pods: 2 }), await at({ pods: 6 })]
    const mid = morph(two, six)(0.8)
    expect(nodeOf(mid, 'app').members[5]!.fade).toBeCloseTo(0.5, 6)
    const again = morph(mid, six)
    expect(nodeOf(again(0), 'app').members[5]!.fade).toBeCloseTo(0.5, 6)
    expect(nodeOf(again(0.8), 'app').members[5]!.fade).toBeCloseTo(0.75, 6)
    const back = morph(mid, two)
    expect(nodeOf(back(0.15), 'app').members[5]!.fade).toBeCloseTo(0.25, 6)
    expect(nodeOf(back(0.15), 'app').members[0]!.fade).toBeUndefined()
  })

  it('draws a new edge in last, and fades out one that goes', async () => {
    const [off, on] = [await at({ audit: false }), await at({ audit: true })]
    expect(on.edges).toHaveLength(off.edges.length + 1)
    const show = morph(off, on)
    expect(edgeOf(show(0.7), 'e2').draw).toBe(0)
    expect(edgeOf(show(0.85), 'e2').draw).toBeCloseTo(0.5, 6)
    const hide = morph(on, off)
    expect(edgeOf(hide(0.15), 'e2').fade).toBeCloseTo(0.5, 6)
    expect(hide(0.15).edges).toHaveLength(on.edges.length)
  })

  it('keeps an edge orthogonal when its bends line up, and resamples one that bends otherwise', () => {
    const scene = (points: [number, number][]): Scene => ({
      key: '',
      direction: 'RIGHT',
      width: 100,
      height: 100,
      nodes: [],
      edges: [{ id: 'e0', from: 'a', to: 'b', points }],
      stageNode: {},
      flowFrom: {},
      tiers: [],
    })
    const [p, q, r] = edgeOf(
      morph(
        scene([
          [0, 0],
          [0, 40],
          [80, 40],
        ]),
        scene([
          [0, 20],
          [0, 60],
          [60, 60],
        ]),
      )(MID),
      'e0',
    ).points as [[number, number], [number, number], [number, number]]
    expect(q[0]).toBe(p[0])
    expect(r[1]).toBe(q[1])
    expect([p[1], q[1], r[0]].map((x) => Math.round(x * 1e6) / 1e6)).toEqual([10, 50, 70])
    // an edge with no route yet has nowhere to move from: it draws in
    expect(
      edgeOf(
        morph(
          scene([]),
          scene([
            [0, 0],
            [80, 0],
          ]),
        )(0.85),
        'e0',
      ),
    ).toMatchObject({ draw: 0.5 })
    const bent = edgeOf(
      morph(
        scene([
          [0, 0],
          [80, 0],
        ]),
        scene([
          [0, 0],
          [0, 40],
          [80, 40],
        ]),
      )(MID),
      'e0',
    ).points
    expect(bent).toHaveLength(24)
    expect(bent[0]).toEqual([0, 0])
    expect(bent.at(-1)![0]).toBeCloseTo(80, 6)
    expect(bent.at(-1)![1]).toBeCloseTo(20, 6)
  })
})

describe('morph inside a box', () => {
  const spot = (y: number) => ({ x: 0, y, size: 9, weight: 400 })
  const brokers = (groups: [string, number][]): Scene => ({
    key: '',
    direction: 'RIGHT',
    width: 100,
    height: 100,
    nodes: [
      {
        id: 'b',
        kind: 'cluster',
        shape: 'box',
        stages: [],
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        title: spot(0),
        members: [],
        groups: groups.map(([flow, y]) => ({ flow, text: flow, spot: spot(y) })),
        cells: [],
        slots: [],
      },
    ],
    edges: [],
    stageNode: {},
    flowFrom: {},
    tiers: [],
  })

  it('moves each flow name on its own member, when another flow joins between them', () => {
    // member 0 then member 1; a second flow adds a name on each, between the old ones
    const a = brokers([
      ['orders', 10],
      ['orders', 50],
    ])
    const b = brokers([
      ['orders', 10],
      ['events', 30],
      ['orders', 60],
      ['events', 80],
    ])
    const groups = morph(a, b)(MID).nodes[0]!.groups
    expect(groups.map((g) => [g.flow, Math.round(g.spot.y), g.fade])).toEqual([
      ['orders', 10, undefined],
      ['events', 30, 0],
      ['orders', 55, undefined],
      ['events', 80, 0],
    ])
  })
})

describe('morph of a tier', () => {
  const lane = (lines: string[]): Scene => ({
    key: '',
    direction: 'RIGHT',
    width: 200,
    height: 100,
    nodes: [],
    edges: [],
    stageNode: {},
    flowFrom: {},
    tiers: [
      {
        id: 't',
        x: 0,
        y: 0,
        w: 200,
        h: 100,
        head: { x: 0, y: 0, w: 200, h: 16 + 14 * lines.length },
        lines: lines.map((text, i) => ({ text, x: 10, y: 20 + 14 * i, size: 11.5, weight: 600 })),
        spacing: 0.92,
        vertical: false,
      },
    ],
  })

  it('fades a name broken in two in, and the one it was out, while the header grows', () => {
    const at = (t: number) => morph(lane(['DATA', 'APPLICATION SERV…']), lane(['DATA', 'APPLICATION', 'SERVICES']))(t)
    const mid = at(MID).tiers[0]!
    expect(mid.head.h).toBeGreaterThan(44)
    expect(mid.head.h).toBeLessThan(58)
    expect(mid.lines.map((l) => [l.text, l.fade])).toEqual([
      ['DATA', undefined],
      ['APPLICATION', 0],
      ['SERVICES', 0],
      ['APPLICATION SERV…', expect.any(Number)],
    ])
    expect(
      at(0.99)
        .tiers[0]!.lines.slice(1, 3)
        .every((l) => l.fade! > 0.9),
    ).toBe(true)
    expect(at(1).tiers[0]!.lines.map((l) => l.text)).toEqual(['DATA', 'APPLICATION', 'SERVICES'])
  })
})
