import type { Rect } from './camera'
import type { Engine } from './engine'
import { cameraOf, clamp, frame, placement, range, shot, shown, type Viewpoint, type Viewport } from './viewpoint'

// the whole scene, as camera.ts has it: written here, so this chunk takes nothing from the page's first load
const whole = (s: { width: number; height: number }): Rect => ({ x: 0, y: 0, w: s.width, h: s.height })

/**
 * The reader's view of a board that pans and zooms: the board in pixels with what floats over it, and where the reader
 * has moved. It comes with the code that pans and zooms, so a page that never zooms does not load it; the engine asks
 * it what part of the scene to show.
 */
export class Viewer {
  readonly engine: Engine
  viewport: Viewport
  /** The reader's view; null keeps the diagram fitted as the board changes. */
  #view: Viewpoint | null = null

  constructor(engine: Engine, viewport: Viewport) {
    this.engine = engine
    this.viewport = viewport
  }

  /** The board changed size or what floats over it; a reader's view stays, kept in sight. */
  setViewport(vp: Viewport): void {
    this.viewport = vp
    const fit = this.fit()
    if (this.#view && fit) this.#view = clamp(this.#view, vp, whole(this.engine.frame!), range(fit))
    this.#show()
  }

  /** The view Fit gives: the whole diagram in the free part of the board. Null while nothing is drawn. */
  fit(): Viewpoint | null {
    const f = this.engine.frame
    return f && frame(whole(f), this.viewport)
  }

  /** The reader's own view; null while the diagram stays fitted. */
  get readerView(): Viewpoint | null {
    return this.#view
  }

  /** What the board shows now, the story's camera included. */
  shownView(): Viewpoint | null {
    const fit = this.fit()
    const c = this.engine.camera
    if (!fit) return null
    return c ? shot(c, this.engine.frame!, fit, this.viewport) : (this.#view ?? fit)
  }

  /** The zoom's range, in board pixels a scene unit. */
  zoomRange(): { min: number; max: number } | null {
    const fit = this.fit()
    return fit && range(fit)
  }

  /**
   * The reader's view, kept in the zoom's range and with the diagram in sight; null fits it again, and keeps it fitted
   * as the board changes. A story playing stops where it is: the reader took the view.
   */
  setView(v: Viewpoint | null): void {
    const fit = this.fit()
    if (!fit) return
    if (this.engine.story) this.engine.stopStory({ cut: true })
    this.#view = v && clamp(v, this.viewport, whole(this.engine.frame!), range(fit))
    this.#show()
  }

  /** The part of the scene the board shows now: its viewBox. */
  box(): Rect | null {
    const v = this.shownView()
    return v && shown(v, this.viewport)
  }

  /** Where the board draws the scene now, in its pixels: its scale and offset. */
  placement(): { k: number; dx: number; dy: number } | null {
    const b = this.box()
    return b && placement(b, this.viewport.w, this.viewport.h)
  }

  /** Play starts: the camera the first shot flies from, where the reader had moved; the view is the story's now. */
  lead(): Rect | undefined {
    const v = this.#view
    const fit = this.fit()
    this.#view = null
    return v && fit && !this.engine.reducedMotion ? cameraOf(v, this.engine.frame!, fit, this.viewport) : undefined
  }

  /** Paints the dots on the board's canvas where the SVG draws their places: in the board's pixels, then the canvas's. */
  paint(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const p = this.placement()
    if (!p) return
    const sx = canvas.width / this.viewport.w
    const sy = canvas.height / this.viewport.h
    ctx.setTransform(p.k * sx, 0, 0, p.k * sy, p.dx * sx, p.dy * sy)
    this.engine.paintDots(ctx)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  #show(): void {
    this.engine.applyCamera()
    this.engine.draw()
    // the zoom shown follows a board that changes size even where what it shows does not
    this.engine.changed()
  }
}
