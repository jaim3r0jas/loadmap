import type { Point } from './geometry'
import type { Box, Cell, Fading, Scene, SceneEdge, SceneNode, TextSpot } from './layout'

/**
 * When each part of a move happens, as shares of it: what leaves fades out first, what stays moves, what is new fades
 * in once the boxes have arrived, and new edges draw in last.
 */
const LEAVE = [0, 0.3] as const
const MOVE = [0.15, 0.8] as const
const ENTER = [0.6, 1] as const
const DRAW = [0.7, 1] as const
/** Points an edge is resampled to when its old and new routes do not bend alike. */
const SAMPLES = 24

const span = (t: number, [a, b]: readonly [number, number]) => Math.min(1, Math.max(0, (t - a) / (b - a)))
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const box = <B extends Box>(a: Box, b: B, k: number): B => ({
  ...b,
  x: lerp(a.x, b.x, k),
  y: lerp(a.y, b.y, k),
  w: lerp(a.w, b.w, k),
  h: lerp(a.h, b.h, k),
})
const spot = (a: TextSpot, b: TextSpot, k: number): TextSpot => ({ ...b, x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) })

/** How far what leaves has faded out and what is new has faded in. */
interface Fades {
  out: number
  enter: number
}
// a move that starts while another runs starts from its frame: a part half faded goes on from where it is
const stays = (a: Fading, f: Fades) => (a.fade == null ? {} : { fade: lerp(a.fade, 1, f.enter) })
const goes = <T extends Fading>(a: T, f: Fades): T => ({ ...a, fade: (a.fade ?? 1) * f.out })

/**
 * The move from one scene to the next, as a scene at each share `t` of it (0–1). Boxes and edges are matched by id,
 * pods and brokers by index, workers by index and partitions by stage, flow and index. What stays moves and resizes,
 * its edges following; what leaves and what is new carry a `fade`, new edges a `draw`. At 1 it is `to` itself.
 */
export function morph(from: Scene, to: Scene): (t: number) => Scene {
  const nodesFrom = new Map(from.nodes.map((n) => [n.id, n]))
  const nodesTo = new Set(to.nodes.map((n) => n.id))
  const edgesFrom = new Map(from.edges.map((e) => [e.id, e]))
  const edgesTo = new Set(to.edges.map((e) => e.id))
  // a route that bends alike moves point by point, so it stays orthogonal; another is resampled by length
  const routes = new Map<string, [readonly Point[], readonly Point[]]>()
  for (const e of to.edges) {
    const a = edgesFrom.get(e.id)?.points
    // a side without a route has nowhere to move from: the edge draws in instead
    if (a?.length && e.points.length)
      routes.set(e.id, alike(a, e.points) ? [a, e.points] : [resample(a, SAMPLES), resample(e.points, SAMPLES)])
  }
  return (t) => {
    if (t >= 1) return to
    const k = ease(span(t, MOVE))
    const f: Fades = { out: 1 - span(t, LEAVE), enter: span(t, ENTER) }
    const draw = span(t, DRAW)
    const edges: SceneEdge[] = to.edges.map((e) => {
      const a = edgesFrom.get(e.id)
      const r = routes.get(e.id)
      if (!a || !r) return { ...e, fade: f.enter, draw }
      const [p, q] = r
      const points = p.map((x, i): [number, number] => [lerp(x[0], q[i]![0], k), lerp(x[1], q[i]![1], k)])
      const label = e.label && (a.label ? box(a.label, e.label, k) : e.label)
      return {
        ...e,
        points,
        label,
        ...stays(a, f),
        ...(a.draw == null ? {} : { draw: lerp(a.draw, 1, draw) }),
      }
    })
    for (const e of from.edges) if (!edgesTo.has(e.id)) edges.push(goes(e, f))
    const nodes: SceneNode[] = to.nodes.map((n) => {
      const a = nodesFrom.get(n.id)
      return a ? between(a, n, k, f) : { ...n, fade: f.enter }
    })
    for (const n of from.nodes) if (!nodesTo.has(n.id)) nodes.push(goes(n, f))
    // a band moves with the boxes it holds
    const tiers = to.tiers.map((t) => {
      const a = from.tiers.find((x) => x.id === t.id)
      return a ? { ...box(a, t, k), spot: spot(a.spot, t.spot, k) } : t
    })
    return {
      ...to,
      width: lerp(from.width, to.width, k),
      height: lerp(from.height, to.height, k),
      nodes,
      edges,
      tiers,
    }
  }
}

/** A box that stays, part of the way: its own parts matched, entering and leaving like the boxes. */
function between(a: SceneNode, b: SceneNode, k: number, f: Fades): SceneNode {
  const members = b.members.map((m, i) => {
    const o = a.members[i]
    return o ? { ...box(o, m, k), spot: spot(o.spot, m.spot, k), ...stays(o, f) } : { ...m, fade: f.enter }
  })
  for (const o of a.members.slice(b.members.length)) members.push(goes(o, f))
  // a flow's name above its partitions, once per member: the k-th of a name is on member k
  const groupKeys = (gs: SceneNode['groups']) => {
    const seen = new Map<string, number>()
    return gs.map((g) => {
      const name = `${g.flow}|${g.text}`
      const n = seen.get(name) ?? 0
      seen.set(name, n + 1)
      return `${name}|${n}`
    })
  }
  const keysFrom = groupKeys(a.groups)
  const groupsFrom = new Map(a.groups.map((g, i) => [keysFrom[i]!, g]))
  const keysTo = groupKeys(b.groups)
  const groups = b.groups.map((g, i) => {
    const o = groupsFrom.get(keysTo[i]!)
    return o ? { ...g, spot: spot(o.spot, g.spot, k), ...stays(o, f) } : { ...g, fade: f.enter }
  })
  const kept = new Set(keysTo)
  a.groups.forEach((o, i) => {
    if (!kept.has(keysFrom[i]!)) groups.push(goes(o, f))
  })
  const cellKey = (c: Cell) => `${c.stage}/${c.flow}/${c.index}`
  const cellsFrom = new Map(a.cells.map((c) => [cellKey(c), c]))
  const cellsTo = new Set(b.cells.map(cellKey))
  const cells = b.cells.map((c) => {
    const o = cellsFrom.get(cellKey(c))
    return o ? { ...box(o, c, k), ...stays(o, f) } : { ...c, fade: f.enter }
  })
  for (const c of a.cells) if (!cellsTo.has(cellKey(c))) cells.push(goes(c, f))
  const slotsFrom = new Map(a.slots.map((s) => [s.index, s]))
  const slotsTo = new Set(b.slots.map((s) => s.index))
  const slots = b.slots.map((s) => {
    const o = slotsFrom.get(s.index)
    return o ? { ...box(o, s, k), ...stays(o, f) } : { ...s, fade: f.enter }
  })
  for (const s of a.slots) if (!slotsTo.has(s.index)) slots.push(goes(s, f))
  return {
    ...box(a, b, k),
    ...stays(a, f),
    title: spot(a.title, b.title, k),
    sub: b.sub && (a.sub ? spot(a.sub, b.sub, k) : b.sub),
    members,
    groups,
    cells,
    slots,
  }
}

/** Two routes with as many segments, each running the same way: horizontal or vertical. */
function alike(a: readonly Point[], b: readonly Point[]): boolean {
  return a.length === b.length && a.every((p, i) => i === 0 || way(a[i - 1]!, p) === way(b[i - 1]!, b[i]!))
}

const way = (p: Point, q: Point) => (Math.abs(q[0] - p[0]) >= Math.abs(q[1] - p[1]) ? 'h' : 'v')

/** `n` points spread evenly by length along a polyline. */
function resample(points: readonly Point[], n: number): Point[] {
  if (points.length < 2) return Array.from({ length: n }, () => points[0] ?? [0, 0])
  const at = [0]
  for (let i = 1; i < points.length; i++)
    at.push(at[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]))
  const total = at.at(-1)!
  const out: Point[] = []
  let i = 1
  for (let j = 0; j < n; j++) {
    const d = (total * j) / (n - 1)
    while (i < at.length - 1 && at[i]! < d) i++
    const seg = at[i]! - at[i - 1]!
    const s = seg > 0 ? (d - at[i - 1]!) / seg : 1
    const p = points[i - 1]!
    const q = points[i]!
    out.push([lerp(p[0], q[0], s), lerp(p[1], q[1], s)])
  }
  return out
}
