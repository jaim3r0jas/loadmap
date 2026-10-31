import type { Evaluation, Model } from '@loadmap/core'
import { anchor, legPath, type Point, pointAt, type Scene, type View } from '@loadmap/layout'
import { createSim, type Particle, type Sim, type SimOptions } from '@loadmap/sim'

const TOKENS = ['accent', 'alt', 'ok', 'warn', 'drop', 'muted', 'fg', 'surface', 'line'] as const

/**
 * Everything that moves, without React: the sim, the dots on the canvas and the worker fills in the SVG. React
 * renders the structure once per scene; the engine updates the moving parts every frame, and export drives it frame
 * by frame instead of the animation loop.
 */
export class Engine {
  readonly model: Model
  readonly view: View
  sim: Sim
  ev: Evaluation
  scene: Scene | null = null
  /** The structure key the current values want; `scene.key` catches up once the layout is done. */
  wantKey = ''
  /** The values React last drew labels and colours for; a frame is complete once they match `ev.values`. */
  drawnValues = ''
  paused = false
  colors: Record<string, string> = {}
  svg: SVGSVGElement | null = null
  canvas: HTMLCanvasElement | null = null

  #o: SimOptions
  #slots: { el: SVGRectElement; stage: string; index: number; y: number; s: number }[] = []
  #paths = new Map<number, { key: string; points: Point[] }>()

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

  setScene(scene: Scene): void {
    if (scene === this.scene) return
    this.scene = scene
    this.#paths.clear()
  }

  /** Starts the sim over from empty queues, with this seed (default: the original one). */
  reset(seed?: number): void {
    this.sim = createSim(this.model, this.ev, { ...this.#o, seed: seed ?? this.#o.seed })
    this.#paths.clear()
  }

  bind(svg: SVGSVGElement | null, canvas: HTMLCanvasElement | null): void {
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
    this.resize()
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
    c.width = Math.round(r.width * dpr)
    c.height = Math.round(r.height * dpr)
  }

  step(dtReal: number, o: { particles?: boolean } = {}): void {
    this.sim.step(dtReal, o)
  }

  /** Draws the dots on the overlay canvas and the worker fills in the SVG. */
  draw(o: { particles?: boolean } = {}): void {
    this.drawFills()
    const c = this.canvas
    const ctx = c?.getContext('2d')
    if (!c || !ctx || !this.scene) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    if (o.particles === false) return
    this.paintParticles(ctx, c.width / this.scene.width)
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
  dots(): { x: number; y: number; r: number; color: string; alpha: number }[] {
    const scene = this.scene
    if (!scene) return []
    const out: { x: number; y: number; r: number; color: string; alpha: number }[] = []
    const live = new Set<number>()
    for (const d of this.sim.particles) {
      live.add(d.id)
      const [x, y] = this.#position(scene, d)
      const inCell = d.to.cell != null && d.phase !== 'move'
      out.push({
        x,
        y: y - (d.phase === 'fade' && d.outcome !== 'delivered' ? (d.t / d.dur) * 8 : 0),
        r: inCell ? 3 : 3.4,
        color: d.phase === 'fade' ? this.outcomeColor(d.outcome) : this.flowColor(d.flow),
        alpha: d.phase === 'fade' ? Math.max(0, 1 - d.t / d.dur) : 1,
      })
    }
    for (const id of this.#paths.keys()) if (!live.has(id)) this.#paths.delete(id)
    return out
  }

  /** Paints the dots onto any 2D context, scene units × `scale`: the overlay, or an export frame. */
  paintParticles(ctx: CanvasRenderingContext2D, scale: number): void {
    if (!this.scene) return
    ctx.save()
    ctx.transform(scale, 0, 0, scale, 0, 0)
    for (const d of this.dots()) {
      ctx.globalAlpha = d.alpha
      ctx.fillStyle = d.color
      ctx.beginPath()
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  #position(scene: Scene, d: Particle): Point {
    if (d.phase !== 'move') return anchor(scene, d.to, d.flow)
    const key = `${d.leg}|${d.from.stage}|${d.from.cell}|${d.to.stage}|${d.to.cell}`
    let p = this.#paths.get(d.id)
    if (!p || p.key !== key) {
      p = { key, points: legPath(scene, d.from, d.to, d.flow) }
      this.#paths.set(d.id, p)
    }
    return pointAt(p.points, d.t / d.dur)
  }
}
