import { useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { Engine } from './engine'
import { Viewer } from './viewer'
import { bring, free, type Insets, panBy, towards, type Viewpoint, zoomAt } from './viewpoint'

/**
 * Injected with the code that uses it: a board the reader zooms keeps its own shape, the SVG filling it whatever part of
 * the scene it shows; a canvas fills its container, the legend and the buttons floating clear of what the page floats
 * over it; the hand and the zoom buttons.
 */
const ZOOM_CSS = `
.lm-board[data-zoom] svg { position: absolute; inset: 0; height: 100%; }
.lm-wrap[data-canvas] { display: block; height: 100%; }
.lm-wrap[data-canvas] > .lm-board { height: 100%; border: 0; border-radius: 0; }
.lm-board[data-zoom] { cursor: grab; user-select: none; -webkit-user-select: none; }
.lm-board[data-zoom] [role="button"] { cursor: pointer; }
.lm-board[data-panning], .lm-board[data-panning] [role="button"] { cursor: grabbing; }
.lm-board[data-zoom]:focus-visible { outline: 2px solid var(--lm-accent); outline-offset: -2px; }
.lm-zoom { position: absolute; right: 8px; bottom: 8px; z-index: 2; display: flex; gap: 2px; padding: 3px; background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 8px; box-shadow: 0 2px 10px rgb(0 0 0 / .12); cursor: auto; }
.lm-zoom .lm-btn { padding: 4px 10px; border-color: transparent; font-variant-numeric: tabular-nums; }
.lm-zoom .lm-btn:nth-child(2) { min-width: 4.4em; }
.lm-zoom [aria-disabled="true"] { opacity: .4; cursor: default; }
@media (pointer: coarse) { .lm-zoom .lm-btn { min-width: 44px; min-height: 44px; } }
.lm-wrap[data-canvas] .lm-zoom { right: calc(var(--lm-inset-right) + 12px); bottom: calc(var(--lm-inset-bottom) + 12px); }
.lm-wrap[data-canvas] > .lm-bar { position: absolute; left: calc(var(--lm-inset-left) + 12px); bottom: calc(var(--lm-inset-bottom) + 12px); z-index: 2; max-width: calc(100% - var(--lm-inset-left) - var(--lm-inset-right) - 260px); padding: 4px 8px; border-radius: 6px; background: color-mix(in srgb, var(--lm-surface) 88%, transparent); pointer-events: none; }
`

function injectZoomStyles(doc: Document): void {
  if (doc.getElementById('loadmap-zoom-css')) return
  const el = doc.createElement('style')
  el.id = 'loadmap-zoom-css'
  el.textContent = ZOOM_CSS
  doc.head.appendChild(el)
}

/** Pixels a press may move and still be a click: a finger wobbles more than a mouse. */
const SLOP = { mouse: 4, other: 8 }
/** What a button or a key zooms by. */
export const ZOOM_STEP = 1.25
/** Pixels an arrow key pans, and with Shift. */
const ARROW = { step: 40, shift: 200 }
/** Seconds a jump from a button or a key takes; reduced motion cuts. */
const FLIGHT = 0.2

// one flight per board: a new move of the reader's takes over from it
const flights = new WeakMap<Viewer, number>()

function land(viewer: Viewer): void {
  const raf = flights.get(viewer)
  if (raf != null) cancelAnimationFrame(raf)
  flights.delete(viewer)
}

/**
 * Moves the reader's view to `to` (null: fitted). From a button or a key it flies there, on the wall clock (a reader's
 * view is never in a recording); from a drag or the wheel, and with reduced motion, it is there at once.
 */
export function goTo(viewer: Viewer, to: Viewpoint | null, fly: boolean): void {
  land(viewer)
  const from = viewer.shownView()
  const target = to ?? viewer.fit()
  if (!fly || viewer.engine.reducedMotion || !from || !target) {
    viewer.setView(to)
    return
  }
  // the reader takes the view from a story playing now; one that starts during the flight takes it back
  if (viewer.engine.playing) viewer.setView(from)
  const t0 = performance.now()
  const frame = (now: number) => {
    if (viewer.engine.playing) {
      flights.delete(viewer)
      return
    }
    const t = (now - t0) / 1000 / FLIGHT
    if (t >= 1) {
      flights.delete(viewer)
      viewer.setView(to)
      return
    }
    viewer.setView(towards(from, target, t))
    flights.set(viewer, requestAnimationFrame(frame))
  }
  flights.set(viewer, requestAnimationFrame(frame))
}

/** Zooms by `factor` about the middle of the free part of the board. */
export function zoomBy(viewer: Viewer, factor: number): void {
  const v = viewer.shownView()
  const vp = viewer.viewport
  const r = viewer.zoomRange()
  if (!v || !vp || !r) return
  const f = free(vp)
  const k = Math.min(r.max, Math.max(r.min, v.k * factor))
  goTo(viewer, zoomAt(v, vp, f.x + f.w / 2, f.y + f.h / 2, k / v.k), true)
}

/** The scene at one board pixel a scene unit, about the middle of the free part. */
export function actualSize(viewer: Viewer): void {
  const v = viewer.shownView()
  if (v) zoomBy(viewer, 1 / v.k)
}

/**
 * The reader's hands on the board: a drag pans (a press that hardly moves is still a click), a pinch zooms about its
 * middle, and the keys + − 0 and the arrows work while the board or a box has the focus. The wheel zooms about the
 * pointer `always` (a board that fills the page), else only with Ctrl or ⌘ held, or a trackpad's pinch, so a page
 * that scrolls keeps its wheel. Returns a function that lets go.
 */
export function attachZoom(board: HTMLElement, viewer: Viewer, o: { always: boolean }): () => void {
  // the board and the boxes take the keys that pan and zoom
  board.tabIndex = 0
  board.setAttribute('role', 'group')
  board.setAttribute('aria-label', 'Diagram: drag to pan; + and − zoom, 0 fits')
  const points = new Map<number, { x: number; y: number }>()
  let start: { x: number; y: number } | null = null
  let panning = false
  // the click a drag ends with, which comes right after it, is no click on a box
  let swallowUntil = -1
  const at = (e: { clientX: number; clientY: number }) => {
    const r = board.getBoundingClientRect()
    return { x: e.clientX - r.left - board.clientLeft, y: e.clientY - r.top - board.clientTop }
  }
  // a drag keeps its pointer when it leaves the board; a pointer the browser no longer knows is let go
  const capture = (id: number) => {
    try {
      board.setPointerCapture(id)
    } catch {}
  }
  const move = (to: Viewpoint) => {
    land(viewer)
    viewer.setView(to)
  }
  // one finger scrolls a page until the reader has zoomed: then it pans, as it always does on a board of its own. Two
  // fingers pinch the board, never the page
  const touch = () => {
    const action = o.always || viewer.readerView ? 'none' : 'pan-x pan-y'
    if (board.style.touchAction !== action) board.style.touchAction = action
  }

  const down = (e: PointerEvent) => {
    if ((e.button !== 0 && e.button !== 1) || (e.target as Element).closest('.lm-zoom')) return
    if (!viewer.shownView()) return
    points.set(e.pointerId, at(e))
    if (points.size === 1) {
      start = at(e)
      panning = false
    }
    // the middle button pans rather than scrolling the page
    if (e.button === 1) e.preventDefault()
  }
  const drag = (e: PointerEvent) => {
    const was = points.get(e.pointerId)
    const v = viewer.shownView()
    const vp = viewer.viewport
    if (!was || !v || !vp) return
    const p = at(e)
    if (points.size >= 2) {
      // a pinch: the scene under the fingers' middle follows it, and grows as they part
      const [a, b] = [...points.values()]
      const mid0 = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 }
      const d0 = Math.hypot(a!.x - b!.x, a!.y - b!.y)
      points.set(e.pointerId, p)
      const [c, d] = [...points.values()]
      const mid1 = { x: (c!.x + d!.x) / 2, y: (c!.y + d!.y) / 2 }
      const d1 = Math.hypot(c!.x - d!.x, c!.y - d!.y)
      if (!panning) {
        panning = true
        for (const id of points.keys()) capture(id)
      }
      if (d0 > 0) move(panBy(zoomAt(v, vp, mid0.x, mid0.y, d1 / d0), mid1.x - mid0.x, mid1.y - mid0.y))
      return
    }
    points.set(e.pointerId, p)
    if (!panning) {
      const slop = e.pointerType === 'mouse' ? SLOP.mouse : SLOP.other
      if (!start || Math.hypot(p.x - start.x, p.y - start.y) < slop) return
      panning = true
      capture(e.pointerId)
      board.setAttribute('data-panning', '')
      move(panBy(v, p.x - start.x, p.y - start.y))
      return
    }
    move(panBy(v, p.x - was.x, p.y - was.y))
  }
  const up = (e: PointerEvent) => {
    if (!points.delete(e.pointerId)) return
    if (points.size) return
    if (panning) swallowUntil = e.timeStamp + 300
    panning = false
    start = null
    board.removeAttribute('data-panning')
  }
  const click = (e: MouseEvent) => {
    if (e.timeStamp > swallowUntil) return
    swallowUntil = -1
    e.stopPropagation()
    e.preventDefault()
  }
  const wheel = (e: WheelEvent) => {
    // a trackpad's pinch comes as the wheel with Ctrl held
    if (!o.always && !e.ctrlKey && !e.metaKey) return
    const v = viewer.shownView()
    const vp = viewer.viewport
    if (!v || !vp) return
    e.preventDefault()
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? vp.h : 1)
    // a pinch sends many small steps; a mouse wheel's notch (a hundred pixels, Ctrl held or not) zooms about 1.2×
    const pinch = e.ctrlKey && Math.abs(dy) < 50
    const p = at(e)
    move(zoomAt(v, vp, p.x, p.y, Math.exp(pinch ? -dy * 0.01 : -Math.max(-100, Math.min(100, dy)) * 0.002)))
  }
  const key = (e: KeyboardEvent) => {
    // the board holds boxes and these buttons, never a field to type in
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const v = viewer.shownView()
    if (!v) return
    const step = e.shiftKey ? ARROW.shift : ARROW.step
    const pan = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
    if (e.key === '+' || e.key === '=') zoomBy(viewer, ZOOM_STEP)
    else if (e.key === '-' || e.key === '_') zoomBy(viewer, 1 / ZOOM_STEP)
    else if (e.key === '0') goTo(viewer, null, true)
    else if (pan) goTo(viewer, panBy(v, pan[0]!, pan[1]!), false)
    else return
    e.preventDefault()
  }
  // a box the keyboard reaches outside the view comes into it; one a press focuses stays where the reader sees it
  const focus = (e: FocusEvent) => {
    const t = e.target as Element
    if (!t.matches?.(':focus-visible')) return
    const id = t.closest?.('[data-node]')?.getAttribute('data-node')
    const n = id != null && viewer.engine.frame?.nodes.find((x) => x.id === id)
    const v = viewer.shownView()
    if (!n || !v || !viewer.viewport || viewer.engine.playing) return
    const to = bring(v, viewer.viewport, n)
    if (to) goTo(viewer, to, true)
  }

  touch()
  const off = viewer.engine.subscribe(touch)
  board.addEventListener('pointerdown', down)
  board.addEventListener('pointermove', drag)
  board.addEventListener('pointerup', up)
  board.addEventListener('pointercancel', up)
  board.addEventListener('click', click, true)
  board.addEventListener('wheel', wheel, { passive: false })
  board.addEventListener('keydown', key)
  board.addEventListener('focusin', focus)
  return () => {
    land(viewer)
    off()
    for (const a of ['tabindex', 'role', 'aria-label']) board.removeAttribute(a)
    board.style.removeProperty('touch-action')
    board.removeAttribute('data-panning')
    board.removeEventListener('pointerdown', down)
    board.removeEventListener('pointermove', drag)
    board.removeEventListener('pointerup', up)
    board.removeEventListener('pointercancel', up)
    board.removeEventListener('click', click, true)
    board.removeEventListener('wheel', wheel)
    board.removeEventListener('keydown', key)
    board.removeEventListener('focusin', focus)
  }
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const

/**
 * Makes a board pan and zoom: its size in pixels with what floats over it (`shape`, read again on each measure), the
 * reader's view on the engine, and the hands. A canvas leaves the diagram room to breathe and takes the wheel alone.
 * `measure` reads the board again (new insets); `off` lets go, and the board shows what the camera frames.
 */
export function mountZoom(
  board: HTMLElement,
  engine: Engine,
  shape: () => { canvas: boolean; inset: Insets },
): { measure(): void; off(): void } {
  injectZoomStyles(board.ownerDocument)
  let off: (() => void) | undefined
  const wrap = board.parentElement
  const measure = () => {
    const { canvas, inset } = shape()
    // the legend and the buttons stay clear of what floats over a canvas
    if (canvas) for (const s of SIDES) wrap?.style.setProperty(`--lm-inset-${s}`, `${inset[s]}px`)
    // to the fraction of a pixel, as the SVG fills it
    const r = board.getBoundingClientRect()
    const w = r.width - 2 * board.clientLeft
    const h = r.height - 2 * board.clientTop
    if (!(w > 0 && h > 0)) return
    const vp = {
      w,
      h,
      inset,
      margin: canvas ? (w < 640 ? 16 : 24) : 0,
      fitMax: canvas ? 1.5 : Number.POSITIVE_INFINITY,
    }
    // the hands come with the first size the board has: a board hidden at first (a tab) gets them when it shows
    if (!engine.viewer) {
      engine.viewer = new Viewer(engine, vp)
      off = attachZoom(board, engine.viewer, { always: canvas })
    }
    engine.viewer.setViewport(vp)
  }
  measure()
  const ro = new ResizeObserver(measure)
  ro.observe(board)
  // the buttons, in a root of their own: the page's render never waits for them
  const corner = board.ownerDocument.createElement('div')
  board.appendChild(corner)
  const buttons = createRoot(corner)
  buttons.render(<ZoomControls engine={engine} />)
  return {
    measure,
    off: () => {
      ro.disconnect()
      off?.()
      // not while the page's own root commits the change that let go
      queueMicrotask(() => {
        buttons.unmount()
        corner.remove()
      })
      for (const s of SIDES) wrap?.style.removeProperty(`--lm-inset-${s}`)
      engine.viewer = null
      engine.applyCamera()
      engine.draw()
    },
  }
}

/** − · the zoom · + · Fit, over a corner of the board. The zoom shown is a button too: one pixel a scene unit. */
function ZoomControls({ engine }: { engine: Engine }) {
  useSyncExternalStore(engine.subscribe, () => engine.viewId)
  const viewer = engine.viewer
  const v = viewer?.shownView()
  const r = viewer?.zoomRange()
  if (!viewer || !v || !r) return null
  const furthest = v.k <= r.min * 1.001
  const closest = v.k >= r.max * 0.999
  return (
    <div className="lm-zoom" role="toolbar" aria-label="Zoom">
      <button
        type="button"
        className="lm-btn"
        aria-label="Zoom out"
        aria-keyshortcuts="-"
        aria-disabled={furthest}
        onClick={() => !furthest && zoomBy(viewer, 1 / ZOOM_STEP)}
      >
        −
      </button>
      <button type="button" className="lm-btn" aria-label="Zoom to 100 %" onClick={() => actualSize(viewer)}>
        {Math.round(v.k * 100)} %
      </button>
      <button
        type="button"
        className="lm-btn"
        aria-label="Zoom in"
        aria-keyshortcuts="+"
        aria-disabled={closest}
        onClick={() => !closest && zoomBy(viewer, ZOOM_STEP)}
      >
        +
      </button>
      <button type="button" className="lm-btn" aria-keyshortcuts="0" onClick={() => goTo(viewer, null, true)}>
        Fit
      </button>
    </div>
  )
}
