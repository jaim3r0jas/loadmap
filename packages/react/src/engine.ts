import type { Evaluation, Model } from '@loadmap/core'
import { anchor, legPath, type Point, pointAt, type Scene, type View } from '@loadmap/layout'
import { morph } from '@loadmap/layout/internal'
import { createSim, type Particle, type Sim, type SimOptions } from '@loadmap/sim'

const TOKENS = ['accent', 'alt', 'ok', 'warn', 'drop', 'muted', 'fg', 'surface', 'line'] as const
/** The stroke of a hollow dot, in scene units. */
const RING = 1.4

/** A dot as it is drawn now, in scene units. */
export interface Dot {
  x: number
  y: number
  r: number
  color: string
  alpha: number
  /** A retry: drawn as a ring of this stroke width, inside r. */
  ring?: number
}

/**
 * Everything that moves, without React: the sim, the dots on the canvas, the worker fills in the SVG, and the move from
 * one structure to the next. React renders the structure once per scene, and once per frame while it moves; the engine
 * updates the moving parts every frame, and export drives it frame by frame instead of the animation loop.
 */
export class Engine {
  readonly model: Model
  readonly view: View
  sim: Sim
  ev: Evaluation
  scene: Scene | null = null
  /** What the diagram draws now: the scene, or a frame of the move to it. */
  frame: Scene | null = null
  /** Counts the frames: export waits until the diagram drew this one. */
  frameId = 0
  drawnFrame = -1
  /** Seconds a new structure takes to move in; 0 cuts. */
  transition = 0.8
  /** The structure key the current values want; `scene.key` catches up once the layout is done. */
  wantKey = ''
  /** The values React last drew labels and colours for; a frame is complete once they match `ev.values`. */
  drawnValues = ''
  /** The component a story step points at, and the one the diagram last outlined: export waits for them to match. */
  wantFocus: string | null = null
  /** The story step shown, set as soon as one is chosen: a recorder holding an old handle still reads it. */
  storyStep: number | null = null
  drawnFocus: string | null = null
  paused = false
  colors: Record<string, string> = {}
  svg: SVGSVGElement | null = null
  canvas: HTMLCanvasElement | null = null

  #o: SimOptions
  #slots: { el: SVGRectElement; stage: string; index: number; y: number; s: number }[] = []
  #paths = new Map<number, { key: string; points: Point[] }>()
  #move: { at: (t: number) => Scene; t: number; seconds: number } | null = null
  #listeners = new Set<() => void>()
  /** The last steps came while paused: export drives a paused engine, a page that only paused it does not. */
  #driven = false
  /** While the structure moves, each leg's path in this frame, shared by the dots on it. */
  #legs = { frame: -1, paths: new Map<string, Point[]>() }

  constructor(model: Model, view: View, ev: Evaluation, o: SimOptions = {}) {
    this.model = model
    this.view = view
    this.ev = ev
    this.#o = o
    this.sim = createSim(model, ev, o)
  }

  setEvaluation(ev: Evaluation): void {
    if (ev === this.ev) return
    const same = JSON.stringify(ev.values) === JSON.stringify(this.ev.values)
    this.ev = ev
    if (!same) this.sim.update(ev)
  }

  /**
   * Takes a new scene. A new structure moves in from what is drawn now, unless `cut`, the diagram turned (a new
   * direction is a new screen size, not a new design), or it is paused with nothing stepping it; the first scene just
   * shows.
   */
  setScene(scene: Scene, o: { cut?: boolean } = {}): void {
    if (scene === this.scene) return
    const from = this.frame
    const seconds = this.transition
    this.scene = scene
    this.#paths.clear()
    const move =
      from &&
      !o.cut &&
      seconds > 0 &&
      Number.isFinite(seconds) &&
      (!this.paused || this.#driven) &&
      from.direction === scene.direction &&
      from.key !== scene.key
    this.#move = move ? { at: morph(from, scene), t: 0, seconds } : null
    this.#show(move ? this.#move!.at(0) : scene)
  }

  /** Calls `f` whenever the frame changes; returns a function that stops it. */
  subscribe = (f: () => void): (() => void) => {
    this.#listeners.add(f)
    return () => this.#listeners.delete(f)
  }

  #show(frame: Scene): void {
    this.frame = frame
    this.frameId++
    for (const f of this.#listeners) f()
  }

  /** Starts the sim over from empty queues, with this seed (default: the original one), and ends a move. */
  reset(seed?: number): void {
    this.sim = createSim(this.model, this.ev, { ...this.#o, seed: seed ?? this.#o.seed })
    this.#paths.clear()
    // a recording starts from the scene, whatever the page was doing before
    if (this.#move && this.scene) {
      this.#move = null
      this.#show(this.scene)
    }
  }

  bind(svg: SVGSVGElement | null, canvas: HTMLCanvasElement | null): void {
    const fresh = canvas !== this.canvas
    this.svg = svg
    this.canvas = canvas
    this.#slots = []
    if (!svg) return
    for (const el of svg.querySelectorAll<SVGRectElement>('rect[data-slot]'))
      this.#slots.push({
        el,
        stage: el.dataset.stage!,
        index: Number(el.dataset.slot),
        y: Number(el.dataset.y),
        s: Number(el.dataset.s),
      })
    // the board's ResizeObserver keeps the size after that
    if (fresh) this.resize()
    // a render puts the fills' geometry back from its props: draw them again for the sim as it is
    this.drawFills()
  }

  /** Reads the theme tokens from the element that carries them. Call again when the theme changes. */
  readColors(root: Element): void {
    const cs = getComputedStyle(root)
    for (const t of TOKENS) this.colors[t] = cs.getPropertyValue(`--lm-${t}`).trim()
  }

  flowColor(flow: string): string {
    const c = (this.view.def.flows as Record<string, { color: string }>)[flow]?.color ?? 'accent'
    return this.colors[c] || c
  }

  outcomeColor(outcome: Particle['outcome']): string {
    if (outcome === 'dropped' || outcome === 'rejected') return this.colors.drop || '#b7392e'
    if (outcome === 'superseded' || outcome === 'unread') return this.colors.muted || '#5d6d7c'
    return this.colors.ok || '#2a7f5a'
  }

  resize(): void {
    const c = this.canvas
    if (!c || !this.scene) return
    const r = c.getBoundingClientRect()
    if (!r.width) return
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
    const w = Math.round(r.width * dpr)
    const h = Math.round(r.height * dpr)
    if (c.width === w && c.height === h) return
    c.width = w
    c.height = h
    // a new size clears the canvas: the dots come back now, not on the next step (every frame of a move resizes it)
    this.draw()
  }

  /** Advances the sim, and the move to a new structure, by `dtReal` seconds. */
  step(dtReal: number, o: { particles?: boolean } = {}): void {
    this.#driven = this.paused
    this.sim.step(dtReal, o)
    const m = this.#move
    if (!m || dtReal <= 0) return
    m.t += dtReal / m.seconds
    if (m.t >= 1) this.#move = null
    this.#show(m.at(m.t))
  }

  /** Draws the dots on the overlay canvas and the worker fills in the SVG. */
  draw(o: { particles?: boolean } = {}): void {
    this.drawFills()
    const c = this.canvas
    const ctx = c?.getContext('2d')
    if (!c || !ctx || !this.frame) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    if (o.particles === false) return
    // the SVG is as wide as the board, its height following the frame
    this.paintParticles(ctx, c.width / this.frame.width)
  }

  drawFills(): void {
    for (const sl of this.#slots) {
      const b = this.sim.slotBusy(sl.stage, sl.index)
      const h = b < 0.02 ? 0 : (sl.s - 2) * b
      sl.el.setAttribute('y', (sl.y + sl.s - 1 - h).toFixed(2))
      sl.el.setAttribute('height', h.toFixed(2))
    }
  }

  /** Every dot as it is drawn now, in scene units: for the canvas, and for an SVG export. */
  dots(): Dot[] {
    const scene = this.frame
    if (!scene) return []
    const out: Dot[] = []
    const live = new Set<number>()
    for (const d of this.sim.particles) {
      live.add(d.id)
      const [x, y] = this.#position(scene, d)
      const inCell = d.to.cell != null && d.phase !== 'move'
      const done = d.outcome === 'delivered' || d.outcome === 'answered'
      out.push({
        x,
        y: y - (d.phase === 'fade' && !done ? (d.t / d.dur) * 8 : 0),
        r: inCell ? 3 : 3.4,
        color: d.phase === 'fade' ? this.outcomeColor(d.outcome) : this.flowColor(d.flow),
        alpha: d.phase === 'fade' ? Math.max(0, 1 - d.t / d.dur) : 1,
        ...(d.attempt ? { ring: RING } : {}),
      })
    }
    for (const id of this.#paths.keys()) if (!live.has(id)) this.#paths.delete(id)
    return out
  }

  /** Paints the dots onto any 2D context, scene units × `scale`: the overlay, or an export frame. */
  paintParticles(ctx: CanvasRenderingContext2D, scale: number): void {
    if (!this.frame) return
    ctx.save()
    ctx.transform(scale, 0, 0, scale, 0, 0)
    for (const d of this.dots()) {
      ctx.globalAlpha = d.alpha
      ctx.beginPath()
      if (d.ring) {
        // a retry: a ring, so the extra attempts show against the units sent once
        ctx.strokeStyle = d.color
        ctx.lineWidth = d.ring
        ctx.arc(d.x, d.y, d.r - d.ring / 2, 0, Math.PI * 2)
        ctx.stroke()
      } else {
        ctx.fillStyle = d.color
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  #position(scene: Scene, d: Particle): Point {
    if (d.phase !== 'move') return anchor(scene, d.to, d.flow)
    const key = `${d.leg}|${d.from.stage}|${d.from.cell}|${d.to.stage}|${d.to.cell}`
    // while the structure moves, so do the paths: each frame its own
    if (this.#move) {
      const legs = this.#legs
      if (legs.frame !== this.frameId) {
        legs.frame = this.frameId
        legs.paths.clear()
      }
      const leg = `${d.flow}|${key}`
      let points = legs.paths.get(leg)
      if (!points) {
        points = legPath(scene, d.from, d.to, d.flow)
        legs.paths.set(leg, points)
      }
      return pointAt(points, d.t / d.dur)
    }
    let p = this.#paths.get(d.id)
    if (!p || p.key !== key) {
      p = { key, points: legPath(scene, d.from, d.to, d.flow) }
      this.#paths.set(d.id, p)
    }
    return pointAt(p.points, d.t / d.dur)
  }
}
