import type { Evaluation, Model } from '@loadmap/core'
import { anchor, legPath, type Point, pointAt, type Scene, type View } from '@loadmap/layout'
import { morph } from '@loadmap/layout/internal'
import { createSim, type Particle, type Sim, type SimOptions } from '@loadmap/sim'
import {
  between,
  boxComponent,
  changeSeconds,
  framing,
  type Rect,
  SHOTS,
  type Shapes,
  stepDetail,
  stepTitle,
  targets,
  whole,
} from './camera'

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

/** What the diagram says while the story plays a step: its title, and what the boxes framed show. */
export interface Cue {
  step: number
  title: string
  detail: string
  /** The step's values are shown. */
  after: boolean
  /** The boxes framed are low on the board: the title sits at its top. */
  top: boolean
}

/** How the story player reaches the page: it starts and stops, shows a step's values and says what it is at. */
export interface StoryHost {
  playing(on: boolean): void
  show(i: number): void
  cue(c: Cue | null): void
  /** Each box's shape and the edges drawn at these values (`shapesOf`, with the page's direction and fonts). */
  shapes(ev: Evaluation): Shapes
}

type Shot = 'establish' | 'in' | 'close' | 'change' | 'out' | 'wide' | 'back'

/** Where the story player is. */
interface Playing {
  i: number
  shot: Shot
  t: number
  /** The camera the flight starts from, and the framing close to the boxes the step changes. */
  from: Rect
  close: Rect
  targets: string[]
  components: string[]
  before: Evaluation
  /** The step's values are shown, and the page has not drawn them yet. */
  waiting: boolean
}

/** Seconds the breathing of the first limit takes, in and out. */
const BREATH = 2.4

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
  /** Flights cut and the first limit holds still. */
  reducedMotion = false
  /** The part of the scene the board shows while the story plays; null for all of it. */
  camera: Rect | null = null
  /** What the diagram says about the step the story plays; null when it does not play. */
  cue: Cue | null = null
  host: StoryHost | null = null
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
  /** Seconds the engine has run since the last reset: the first limit breathes on it. */
  #clock = 0
  #halos: { el: SVGGElement; glow: SVGElement | null; cx: number; cy: number }[] = []
  #story: Playing | null = null

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
    this.#clock = 0
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
    this.#halos = []
    if (!svg) return
    for (const el of svg.querySelectorAll<SVGGElement>('g[data-halo]'))
      this.#halos.push({
        el,
        glow: el.querySelector('[data-glow]'),
        cx: Number(el.dataset.cx),
        cy: Number(el.dataset.cy),
      })
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
    this.applyCamera()
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

  /** Advances the sim, the move to a new structure and the story played, by `dtReal` seconds. */
  step(dtReal: number, o: { particles?: boolean } = {}): void {
    this.#driven = this.paused
    this.sim.step(dtReal, o)
    if (dtReal > 0) this.#clock += dtReal
    const m = this.#move
    if (m && dtReal > 0) {
      m.t += dtReal / m.seconds
      if (m.t >= 1) this.#move = null
      this.#show(m.at(m.t))
    }
    if (this.#story) this.#direct(dtReal)
  }

  /** The story plays: from the whole diagram, step `from` and the ones after it. */
  get playing(): boolean {
    return !!this.#story && this.#story.shot !== 'back'
  }

  /**
   * Plays the story from step `from` on the engine's clock: the whole diagram, then for each step a flight in to what it
   * changes, the change, a flight out and the whole diagram for its seconds. The host shows each step's values.
   */
  playStory(from: number): void {
    if (!this.frame || !this.model.story[from]) return
    this.#story = {
      i: from - 1,
      shot: 'establish',
      t: 0,
      from: whole(this.frame),
      close: whole(this.frame),
      targets: [],
      components: [],
      before: this.ev,
      waiting: false,
    }
    this.#setCamera(null)
    this.host?.playing(true)
  }

  /** Stops the story: the camera flies back to the whole diagram (cuts with `cut`), and the step shown stays. */
  stopStory(o: { cut?: boolean } = {}): void {
    const s = this.#story
    if (!s) return
    this.cue = null
    this.host?.cue(null)
    if (s.shot !== 'back') this.host?.playing(false)
    if (o.cut || !this.camera || this.reducedMotion) {
      this.#story = null
      this.#setCamera(null)
    } else this.#story = { ...s, shot: 'back', t: 0, from: this.camera }
  }

  /** The page has drawn the values and the structure the engine has: a step's change can run. */
  #caughtUp(): boolean {
    return !!this.scene && this.scene.key === this.wantKey && this.drawnValues === JSON.stringify(this.ev.values)
  }

  #length(s: Playing): number {
    if (s.shot === 'change') return changeSeconds(this.transition)
    if (s.shot === 'wide') return this.model.story[s.i]?.seconds ?? 0
    return SHOTS[s.shot]
  }

  /** For tests and recordings: the shot the story is at. */
  get story(): { i: number; shot: Shot; t: number } | null {
    const s = this.#story
    return s && { i: s.i, shot: s.shot, t: s.t }
  }

  #direct(dt: number): void {
    const s = this.#story!
    const frame = this.frame
    if (!frame) return
    // the change waits for the page to draw the step's values: the time it takes is no shot's
    if (s.waiting) {
      if (!this.#caughtUp()) return
      s.waiting = false
    }
    s.t += dt
    while (this.#story === s && s.t >= this.#length(s) && !s.waiting) {
      s.t -= this.#length(s)
      this.#next(s)
    }
    if (this.#story !== s) return
    const p = this.#length(s) > 0 ? s.t / this.#length(s) : 1
    const cut = this.reducedMotion
    const all = whole(frame)
    let cam: Rect
    if (s.shot === 'in') cam = cut ? s.close : between(all, s.close, p)
    else if (s.shot === 'close') cam = s.close
    // the framing follows the boxes while the structure moves
    else if (s.shot === 'change') cam = framing(frame, s.targets)
    else if (s.shot === 'out' || s.shot === 'back') cam = cut ? all : between(s.from, all, p)
    else cam = all
    this.#setCamera(cam)
  }

  /** The shot after `s.shot`. */
  #next(s: Playing): void {
    const frame = this.frame!
    const story = this.model.story
    if (s.shot === 'back') {
      this.#story = null
      this.#setCamera(null)
      return
    }
    if (s.shot === 'establish' || s.shot === 'wide') {
      if (s.i + 1 >= story.length) {
        this.#story = null
        this.#setCamera(null)
        this.cue = null
        this.host?.cue(null)
        this.host?.playing(false)
        return
      }
      // the next step: what it changes, framed on the diagram as it is now
      const i = s.i + 1
      const st = story[i]!
      const after = this.model.evaluate(st.values)
      const host = this.host
      const ids = host
        ? targets(frame, this.ev, after, { a: host.shapes(this.ev), b: host.shapes(after) }, st.focus)
        : []
      const nodes = frame.nodes.filter((n) => ids.includes(n.id))
      const components = [...new Set(nodes.map((n) => boxComponent(after, n)).filter((c) => c != null))]
      const close = framing(frame, ids)
      Object.assign(s, { i, shot: 'in', from: whole(frame), close, targets: ids, components, before: this.ev })
      this.#cue({
        step: i,
        title: stepTitle(this.model, this.ev.values, st, i),
        detail: stepDetail(this.ev, null, components),
        after: false,
        top: close.y + close.h / 2 > frame.height * 0.55,
      })
      return
    }
    if (s.shot === 'in') s.shot = 'close'
    else if (s.shot === 'close') {
      s.shot = 'change'
      s.waiting = true
      this.host?.show(s.i)
      this.#cue({ ...this.cue!, detail: stepDetail(s.before, this.ev, s.components), after: true })
    } else if (s.shot === 'change') {
      s.shot = 'out'
      s.from = this.camera ?? whole(frame)
    } else if (s.shot === 'out') s.shot = 'wide'
  }

  #cue(c: Cue): void {
    this.cue = c
    this.host?.cue(c)
  }

  #setCamera(cam: Rect | null): void {
    const f = this.frame
    const all = f && cam && Math.abs(cam.x) < 1e-6 && Math.abs(cam.y) < 1e-6 && Math.abs(cam.w - f.width) < 1e-6
    this.camera = !cam || all ? null : cam
    this.applyCamera()
  }

  /** Points the SVG at the camera: React draws the whole scene's viewBox, the camera replaces it after each render. */
  applyCamera(): void {
    const f = this.frame
    if (!this.svg || !f) return
    const c = this.camera ?? whole(f)
    const box = `${c.x} ${c.y} ${c.w} ${c.h}`
    if (this.svg.getAttribute('viewBox') !== box) this.svg.setAttribute('viewBox', box)
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
    // the first limit breathes, on the engine's clock, while the story plays and once it is past the target: a scale and
    // a glow on its own layer, which moves nothing else. Decided here, not by a render, so a recording never waits on one
    const first = this.ev.firstLimit
    const breathe = !this.reducedMotion && (this.playing || first?.state === 'warn' || first?.state === 'over')
    for (const h of this.#halos) {
      const still = !breathe
      const b = still ? 0.5 : 0.5 - 0.5 * Math.cos((2 * Math.PI * this.#clock) / BREATH)
      const k = 1 + 0.035 * b
      h.el.setAttribute(
        'transform',
        still ? '' : `translate(${h.cx} ${h.cy}) scale(${k.toFixed(4)}) translate(${-h.cx} ${-h.cy})`,
      )
      h.glow?.setAttribute('stroke-opacity', (0.1 + 0.25 * b).toFixed(3))
    }
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

  /**
   * Paints the dots onto any 2D context, scene units × `scale`: the overlay, or an export frame. Under the camera they
   * go where the SVG shows their places (its viewBox, centred where its shape differs), so they keep matching the bars.
   */
  paintParticles(ctx: CanvasRenderingContext2D, scale: number): void {
    const f = this.frame
    if (!f) return
    const c = this.camera ?? whole(f)
    const [bw, bh] = [f.width * scale, f.height * scale]
    const k = Math.min(bw / c.w, bh / c.h)
    ctx.save()
    ctx.transform(k, 0, 0, k, (bw - c.w * k) / 2 - c.x * k, (bh - c.h * k) / 2 - c.y * k)
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
