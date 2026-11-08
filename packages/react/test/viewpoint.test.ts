import type { Scene } from '@loadmap/layout'
import { describe, expect, it } from 'vitest'
import { whole } from '../src/camera'
import {
  anchorOf,
  bring,
  cameraOf,
  clamp,
  frame,
  free,
  NO_INSET,
  panBy,
  placement,
  range,
  shot,
  shown,
  toScene,
  towards,
  type Viewport,
  ZOOM,
  zoomAt,
} from '../src/viewpoint'

const scene = { width: 1000, height: 300 }
/** A 1440×852 canvas with the code floating over 472 px on the left and the panel over 356 px on the right. */
const vp: Viewport = { w: 1440, h: 852, inset: { top: 0, right: 356, bottom: 0, left: 472 }, margin: 24, fitMax: 1.5 }

/** Where a scene point lands on the board under a viewpoint. */
const onBoard = (v: { x: number; y: number; k: number }, p: { x: number; y: number }) => ({
  x: vp.w / 2 + (p.x - v.x) * v.k,
  y: vp.h / 2 + (p.y - v.y) * v.k,
})

describe('the reader’s viewpoint', () => {
  it('fits the whole diagram in the free part, centred, with the margin, and no closer than its most', () => {
    const fit = frame(whole(scene), vp)
    const f = free(vp)
    expect(f).toEqual({ x: 472, y: 0, w: 612, h: 852 })
    // 612 − 2 × 24 = 564 px for 1000 units: the width decides
    expect(fit.k).toBeCloseTo(0.564, 9)
    const a = onBoard(fit, { x: 0, y: 0 })
    const b = onBoard(fit, { x: scene.width, y: scene.height })
    expect(a.x).toBeCloseTo(f.x + 24, 9)
    expect(b.x).toBeCloseTo(f.x + f.w - 24, 9)
    expect((a.y + b.y) / 2).toBeCloseTo(f.y + f.h / 2, 9)
    // a small diagram is not blown up past the most Fit comes
    expect(frame({ x: 0, y: 0, w: 100, h: 40 }, vp).k).toBe(1.5)
  })

  it('fits a board at the scene’s shape exactly, with no inset nor margin', () => {
    const page: Viewport = { w: 800, h: 240, inset: NO_INSET, margin: 0, fitMax: Number.POSITIVE_INFINITY }
    const r = shown(frame(whole(scene), page), page)
    expect(r.x).toBeCloseTo(0, 9)
    expect(r.y).toBeCloseTo(0, 9)
    expect(r.w).toBeCloseTo(1000, 9)
    expect(r.h).toBeCloseTo(300, 9)
  })

  it('uses the whole board when the insets leave nothing free', () => {
    expect(free({ ...vp, inset: { top: 0, right: 900, bottom: 0, left: 900 } })).toEqual({
      x: 0,
      y: 0,
      w: 1440,
      h: 852,
    })
  })

  it('zooms about a point, which keeps the scene under it', () => {
    const v = frame(whole(scene), vp)
    const p = { x: 900, y: 300 }
    const under = toScene(v, vp, p.x, p.y)
    const z = zoomAt(v, vp, p.x, p.y, 2)
    expect(z.k).toBeCloseTo(v.k * 2, 9)
    const after = toScene(z, vp, p.x, p.y)
    expect(after.x).toBeCloseTo(under.x, 9)
    expect(after.y).toBeCloseTo(under.y, 9)
  })

  it('pans with the pointer: the scene moves as far as the drag on the board', () => {
    const v = { x: 500, y: 150, k: 2 }
    const p = panBy(v, 40, -20)
    const a = onBoard(v, { x: 100, y: 100 })
    const b = onBoard(p, { x: 100, y: 100 })
    expect(b.x - a.x).toBeCloseTo(40, 9)
    expect(b.y - a.y).toBeCloseTo(-20, 9)
  })

  it('keeps the zoom in its range and the diagram in sight', () => {
    const fit = frame(whole(scene), vp)
    const lim = range(fit)
    expect(lim).toEqual({ min: ZOOM.min, max: ZOOM.max })
    expect(clamp({ ...fit, k: 40 }, vp, whole(scene), lim).k).toBe(ZOOM.max)
    expect(clamp({ ...fit, k: 0.001 }, vp, whole(scene), lim).k).toBe(ZOOM.min)
    // dragged far off to the left and up, under the code floating there: 64 px of it come back into the free part
    const lost = clamp({ x: 50_000, y: 50_000, k: 1 }, vp, whole(scene), lim)
    expect(onBoard(lost, { x: scene.width, y: scene.height }).x).toBeCloseTo(472 + ZOOM.keep, 9)
    expect(onBoard(lost, { x: scene.width, y: scene.height }).y).toBeCloseTo(ZOOM.keep, 9)
    // and off to the right and down, under the panel
    const gone = clamp({ x: -50_000, y: -50_000, k: 1 }, vp, whole(scene), lim)
    expect(onBoard(gone, { x: 0, y: 0 }).x).toBeCloseTo(vp.w - 356 - ZOOM.keep, 9)
    expect(onBoard(gone, { x: 0, y: 0 }).y).toBeCloseTo(vp.h - ZOOM.keep, 9)
    // a view in sight stays as it is
    expect(clamp(fit, vp, whole(scene), lim)).toEqual(fit)
  })

  it('lets a large diagram zoom out to half its fit', () => {
    const big = { x: 0, y: 0, w: 40_000, h: 12_000 }
    const fit = frame(big, vp)
    expect(range(fit).min).toBeCloseTo(fit.k / 2, 12)
  })

  it('frames a story shot as Fit frames the whole diagram, a closer camera as much closer', () => {
    const fit = frame(whole(scene), vp)
    expect(shot(whole(scene), scene, fit, vp)).toEqual(fit)
    const cam = { x: 400, y: 50, w: 400, h: 120 }
    const s = shot(cam, scene, fit, vp)
    expect(s.k).toBeCloseTo(fit.k * 2.5, 9)
    const f = free(vp)
    const c = onBoard(s, { x: 600, y: 110 })
    expect(c.x).toBeCloseTo(f.x + f.w / 2, 9)
    expect(c.y).toBeCloseTo(f.y + f.h / 2, 9)
  })

  it('turns the reader’s view into the camera Play flies from', () => {
    const fit = frame(whole(scene), vp)
    const v = { x: 300, y: 120, k: 1.7 }
    const cam = cameraOf(v, scene, fit, vp)
    expect(cam.w / cam.h).toBeCloseTo(scene.width / scene.height, 9)
    const back = shot(cam, scene, fit, vp)
    expect(back.k).toBeCloseTo(v.k, 9)
    expect(back.x).toBeCloseTo(v.x, 9)
    expect(back.y).toBeCloseTo(v.y, 9)
  })

  it('brings a box out of view into the middle of the free part, and leaves one in view alone', () => {
    const fit = frame(whole(scene), vp)
    expect(bring(fit, vp, { x: 10, y: 10, w: 50, h: 30 })).toBeNull()
    const close = { x: 100, y: 100, k: 3 }
    const to = bring(close, vp, { x: 900, y: 200, w: 80, h: 40 })!
    expect(to.k).toBe(3)
    const f = free(vp)
    const c = onBoard(to, { x: 940, y: 220 })
    expect(c.x).toBeCloseTo(f.x + f.w / 2, 9)
    expect(c.y).toBeCloseTo(f.y + f.h / 2, 9)
  })

  it('holds on to the box under the middle of the free part, of those the next scene keeps', () => {
    const box = (id: string, x: number, y: number, extra = {}) => ({ id, x, y, w: 100, h: 60, ...extra })
    const at = (nodes: object[]) => ({ nodes }) as unknown as Scene
    const from = at([box('a', 0, 0), box('b', 400, 0), box('c', 800, 0), box('d', 600, 200, { fade: 0.5 })])
    const f = free(vp)
    // the middle of the free part over b's right half
    const v = { x: 0, y: 0, k: 2 }
    const mid = toScene(v, vp, f.x + f.w / 2, f.y + f.h / 2)
    const over = { ...v, x: v.x + (470 - mid.x), y: v.y + (30 - mid.y) }
    expect(anchorOf(over, vp, from, at([box('a', 0, 0), box('b', 0, 300), box('c', 0, 0)]))).toEqual({
      id: 'b',
      dx: over.x - 450,
      dy: over.y - 30,
    })
    // b leaves: the nearest box that stays; a box still fading is never held
    expect(anchorOf(over, vp, from, at([box('a', 0, 0), box('c', 0, 0), box('d', 0, 0)]))?.id).toBe('c')
    expect(anchorOf(over, vp, from, at([box('e', 0, 0)]))).toBeNull()
  })

  it('places a viewBox on the board as SVG does: scaled to fit and centred', () => {
    expect(placement({ x: 0, y: 0, w: 1000, h: 300 }, 500, 300)).toEqual({ k: 0.5, dx: 0, dy: 75 })
    expect(placement({ x: 100, y: 50, w: 200, h: 100 }, 400, 200)).toEqual({ k: 2, dx: -200, dy: -100 })
  })

  it('flies from one viewpoint to another, landing on each end', () => {
    const a = { x: 0, y: 0, k: 1 }
    const b = { x: 100, y: 50, k: 4 }
    expect(towards(a, b, 0)).toEqual(a)
    expect(towards(a, b, 1)).toEqual(b)
    // the scale changes by the same factor each moment: halfway is the geometric middle
    expect(towards(a, b, 0.5).k).toBeCloseTo(2, 9)
  })
})
