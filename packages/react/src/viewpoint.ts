import type { Scene } from '@loadmap/layout'
import type { Rect } from './camera'

/** What the reader looks at: the scene point at the board's centre, and how many board pixels a scene unit takes. */
export interface Viewpoint {
  x: number
  y: number
  k: number
}

/** Pixels on each side of the board that something floats over: Fit frames the diagram in what is left. */
export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

/** The board in pixels, the part of it that is free, and how Fit uses it. */
export interface Viewport {
  w: number
  h: number
  inset: Insets
  /** Room Fit leaves around the diagram, in pixels. */
  margin: number
  /** The closest Fit comes, in board pixels a scene unit. */
  fitMax: number
}

export const NO_INSET: Insets = { top: 0, right: 0, bottom: 0, left: 0 }

/** The zoom's range in board pixels a scene unit, and how much of the diagram always stays in view. */
export const ZOOM = { min: 0.1, max: 4, keep: 64 } as const

/** The free part of the board, in board pixels; the whole board when the insets leave too little. */
export function free(vp: Viewport): Rect {
  const { top, right, bottom, left } = vp.inset
  const w = vp.w - left - right
  const h = vp.h - top - bottom
  return w > 0 && h > 0 ? { x: left, y: top, w, h } : { x: 0, y: 0, w: vp.w, h: vp.h }
}

/** The part of the scene the board shows: its viewBox, at the board's shape. */
export function shown(v: Viewpoint, vp: Viewport): Rect {
  const w = vp.w / v.k
  const h = vp.h / v.k
  return { x: v.x - w / 2, y: v.y - h / 2, w, h }
}

/** The view that shows `r` centred in the free part, as large as fits with the margin, no closer than `max`. */
export function frame(r: Rect, vp: Viewport, max = vp.fitMax): Viewpoint {
  const f = free(vp)
  const m = Math.min(vp.margin, f.w / 4, f.h / 4)
  const k = Math.min((f.w - 2 * m) / r.w, (f.h - 2 * m) / r.h, max)
  return at(r.x + r.w / 2, r.y + r.h / 2, f.x + f.w / 2, f.y + f.h / 2, k, vp)
}

/** The view at scale `k` that puts the scene point (sx, sy) at the board point (px, py). */
function at(sx: number, sy: number, px: number, py: number, k: number, vp: Viewport): Viewpoint {
  return { x: sx + (vp.w / 2 - px) / k, y: sy + (vp.h / 2 - py) / k, k }
}

/** The scene point under a board point. */
export function toScene(v: Viewpoint, vp: Viewport, px: number, py: number): { x: number; y: number } {
  return { x: v.x + (px - vp.w / 2) / v.k, y: v.y + (py - vp.h / 2) / v.k }
}

/** The zoom's range for this diagram: down to half of Fit when that is further out than the usual least. */
export function range(fit: Viewpoint): { min: number; max: number } {
  return { min: Math.min(ZOOM.min, fit.k / 2), max: Math.max(ZOOM.max, fit.k) }
}

/** `v` scaled by `factor` about the board point (px, py), which keeps the scene point under it. */
export function zoomAt(v: Viewpoint, vp: Viewport, px: number, py: number, factor: number): Viewpoint {
  const p = toScene(v, vp, px, py)
  return at(p.x, p.y, px, py, v.k * factor, vp)
}

/** `v` moved by a drag of (dx, dy) board pixels: the scene follows the pointer. */
export function panBy(v: Viewpoint, dx: number, dy: number): Viewpoint {
  return { x: v.x - dx / v.k, y: v.y - dy / v.k, k: v.k }
}

/**
 * `v` inside the zoom's range, and moved back until at least `ZOOM.keep` pixels of the diagram (`bounds`) show in the
 * free part on each axis, or all of it where it is smaller: a diagram can never be lost off the board, nor under what
 * floats over it.
 */
export function clamp(v: Viewpoint, vp: Viewport, bounds: Rect, lim: { min: number; max: number }): Viewpoint {
  const k = Math.min(lim.max, Math.max(lim.min, v.k))
  const f = free(vp)
  const axis = (c: number, size: number, from: number, to: number, lo: number, len: number) => {
    const keep = Math.min(ZOOM.keep, len * k)
    // the diagram's start and end on the board, with the view's centre at c
    const start = size / 2 + (lo - c) * k
    const end = start + len * k
    if (end < from + keep) return c - (from + keep - end) / k
    if (start > to - keep) return c + (start - (to - keep)) / k
    return c
  }
  return {
    x: axis(v.x, vp.w, f.x, f.x + f.w, bounds.x, bounds.w),
    y: axis(v.y, vp.h, f.y, f.y + f.h, bounds.y, bounds.h),
    k,
  }
}

/**
 * The view for a camera of the story, a part of the scene at the scene's shape: the whole scene goes where `fit`
 * puts it, and a closer camera as much closer, centred in the free part.
 */
export function shot(camera: Rect, scene: { width: number; height: number }, fit: Viewpoint, vp: Viewport): Viewpoint {
  const f = free(vp)
  return at(
    camera.x + camera.w / 2,
    camera.y + camera.h / 2,
    f.x + f.w / 2,
    f.y + f.h / 2,
    fit.k * (scene.width / camera.w),
    vp,
  )
}

/** The story camera that `shot` turns into `v`: where Play flies from when the reader had moved the view. */
export function cameraOf(v: Viewpoint, scene: { width: number; height: number }, fit: Viewpoint, vp: Viewport): Rect {
  const f = free(vp)
  const w = scene.width * (fit.k / v.k)
  const h = w * (scene.height / scene.width)
  const c = toScene(v, vp, f.x + f.w / 2, f.y + f.h / 2)
  return { x: c.x - w / 2, y: c.y - h / 2, w, h }
}

/** The view that brings `r` (a box) into the middle of the free part at the same scale; null when it shows whole. */
export function bring(v: Viewpoint, vp: Viewport, r: Rect): Viewpoint | null {
  const f = free(vp)
  const left = vp.w / 2 + (r.x - v.x) * v.k
  const top = vp.h / 2 + (r.y - v.y) * v.k
  const inside = left >= f.x && top >= f.y && left + r.w * v.k <= f.x + f.w && top + r.h * v.k <= f.y + f.h
  return inside ? null : at(r.x + r.w / 2, r.y + r.h / 2, f.x + f.w / 2, f.y + f.h / 2, v.k, vp)
}

/**
 * The box `v` holds on to as the diagram moves from `from` to `to`: of the boxes in both, the one nearest the middle of
 * the free part, and the view's centre from that box's centre. Null when no box stays.
 */
export function anchorOf(
  v: Viewpoint,
  vp: Viewport,
  from: Scene,
  to: Scene,
): { id: string; dx: number; dy: number } | null {
  const f = free(vp)
  const c = toScene(v, vp, f.x + f.w / 2, f.y + f.h / 2)
  const stays = new Set(to.nodes.map((n) => n.id))
  let best: { id: string; dx: number; dy: number } | null = null
  // how far the middle is from the box, then from its centre: a box the middle is inside of wins over one it is near,
  // and of those, the one whose centre is nearest
  let near = { out: Number.POSITIVE_INFINITY, mid: Number.POSITIVE_INFINITY }
  for (const n of from.nodes) {
    if (!stays.has(n.id) || n.fade != null) continue
    const cx = n.x + n.w / 2
    const cy = n.y + n.h / 2
    const out = Math.hypot(Math.max(0, Math.abs(c.x - cx) - n.w / 2), Math.max(0, Math.abs(c.y - cy) - n.h / 2))
    const mid = Math.hypot(c.x - cx, c.y - cy)
    if (out < near.out || (out === near.out && mid < near.mid)) {
      near = { out, mid }
      best = { id: n.id, dx: v.x - cx, dy: v.y - cy }
    }
  }
  return best
}

/** Where a part of the scene (a viewBox) draws on a board of w × h pixels: scaled to fit and centred, as SVG does. */
export function placement(box: Rect, w: number, h: number): { k: number; dx: number; dy: number } {
  const k = Math.min(w / box.w, h / box.h)
  return { k, dx: (w - box.w * k) / 2 - box.x * k, dy: (h - box.h * k) / 2 - box.y * k }
}

/** `t` of the way from `a` to `b`, the scale changing by the same factor each moment. */
export function towards(a: Viewpoint, b: Viewpoint, t: number): Viewpoint {
  const s = (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, t)))) / 2
  return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, k: a.k * (b.k / a.k) ** s }
}

export const sameViewpoint = (a: Viewpoint, b: Viewpoint) =>
  Math.abs(a.k - b.k) < 1e-9 && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6
