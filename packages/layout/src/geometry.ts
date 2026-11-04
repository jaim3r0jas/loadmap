import type { Box, Scene, SceneNode } from './layout'

export type Point = [number, number]

export interface Collision {
  a: string
  b: string
}

const overlap = (p: Box, q: Box, slack: number) =>
  p.x < q.x + q.w - slack && q.x < p.x + p.w - slack && p.y < q.y + q.h - slack && q.y < p.y + p.h - slack

/** Every edge label that overlaps another edge label or a node. An empty list is the layout's promise. */
export function collisions(scene: Scene, slack = 0.5): Collision[] {
  const labels = scene.edges
    .filter((e) => e.label)
    .map((e) => ({ id: `label ${e.id} (${e.from}→${e.to})`, box: e.label! }))
  const out: Collision[] = []
  labels.forEach((l, i) => {
    for (const m of labels.slice(i + 1)) if (overlap(l.box, m.box, slack)) out.push({ a: l.id, b: m.id })
    for (const n of scene.nodes) if (overlap(l.box, n, slack)) out.push({ a: l.id, b: `node ${n.id}` })
  })
  scene.nodes.forEach((n, i) => {
    for (const m of scene.nodes.slice(i + 1))
      if (overlap(n, m, slack)) out.push({ a: `node ${n.id}`, b: `node ${m.id}` })
  })
  return out
}

const centre = (b: Box): Point => [b.x + b.w / 2, b.y + b.h / 2]

/** Where a dot sits at a place: a partition cell, a worker, or the middle of the stage's node. */
export function anchor(scene: Scene, place: { stage: string | null; cell?: number }, flow: string): Point {
  const n = nodeOf(scene, place.stage, flow)
  if (!n) return [0, 0]
  if (place.cell != null) {
    const cell =
      n.cells.find((c) => c.stage === place.stage && c.flow === flow && c.index === place.cell) ?? n.slots[place.cell]
    if (cell) return centre(cell)
  }
  return centre(n)
}

/**
 * The path a dot takes between two places: along the edge between their nodes when there is one, backwards along
 * the edge the other way when that is the only one (a cache hit heading back).
 */
export function legPath(
  scene: Scene,
  from: { stage: string | null; cell?: number },
  to: { stage: string | null; cell?: number },
  flow: string,
): Point[] {
  const a = anchor(scene, from, flow)
  const b = anchor(scene, to, flow)
  const na = nodeOf(scene, from.stage, flow)
  const nb = nodeOf(scene, to.stage, flow)
  const e = na && nb ? scene.edges.find((x) => x.from === na.id && x.to === nb.id) : undefined
  if (e?.points.length) return [a, ...e.points, b]
  const back = na && nb ? scene.edges.find((x) => x.from === nb.id && x.to === na.id) : undefined
  return back?.points.length ? [a, ...[...back.points].reverse(), b] : [a, b]
}

/** The point a share `t` (0–1) along a polyline, by length. */
export function pointAt(points: readonly Point[], t: number): Point {
  if (points.length < 2) return points[0] ?? [0, 0]
  const lens = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i]![0], p[1] - points[i]![1]))
  let left = Math.min(1, Math.max(0, t)) * lens.reduce((s, l) => s + l, 0)
  for (let i = 0; i < lens.length; i++) {
    const l = lens[i]!
    if (left <= l || i === lens.length - 1) {
      const k = l > 0 ? Math.min(1, left / l) : 1
      const p = points[i]!
      const q = points[i + 1]!
      return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]
    }
    left -= l
  }
  return points.at(-1)!
}

function nodeOf(scene: Scene, stage: string | null, flow: string): SceneNode | undefined {
  const id = stage == null ? scene.flowFrom[flow] : scene.stageNode[stage]
  return scene.nodes.find((n) => n.id === id)
}
