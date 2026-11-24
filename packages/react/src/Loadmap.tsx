import type { Model, Values } from '@loadmap/core'
import type { Scene, View } from '@loadmap/layout'
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useSyncExternalStore } from 'react'
import { storySeconds } from './camera'
import type { Engine } from './engine'
import { FRAME_PANELS, Frame, type FramePanel } from './frame'
import { injectStyles } from './styles'
import { type LoadmapController, type LoadmapOptions, useLoadmap } from './useLoadmap'

/** `auto` follows the system's light or dark; `inherit` the page's own switch (`data-theme`, or a `dark` or `light` class, on `<html>`). */
export type Theme = 'auto' | 'light' | 'dark' | 'inherit'

/** What the page's own switch says, on `<html>`: `data-theme`, or a `dark` or `light` class; null when it says nothing. */
function pageTheme(): 'light' | 'dark' | null {
  if (typeof document === 'undefined') return null
  const html = document.documentElement
  const t = html.dataset.theme
  if (t === 'dark' || t === 'light') return t
  if (html.classList.contains('dark')) return 'dark'
  if (html.classList.contains('light')) return 'light'
  return null
}

// one observer of <html> for every root that follows the page
const following = new Set<() => void>()
let observer: MutationObserver | null = null
function follow(changed: () => void) {
  following.add(changed)
  if (!observer && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(() => {
      for (const f of following) f()
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
  }
  return () => {
    following.delete(changed)
    if (following.size) return
    observer?.disconnect()
    observer = null
  }
}
const stay = () => () => {}

/**
 * The theme to draw: `theme` itself; with `inherit`, what the page's own switch says, followed as it changes, and the
 * system's (`auto`) while it says nothing, as on the server.
 */
export function usePageTheme(theme: Theme = 'auto'): 'auto' | 'light' | 'dark' {
  const page = useSyncExternalStore(theme === 'inherit' ? follow : stay, pageTheme, () => null)
  return theme === 'inherit' ? (page ?? 'auto') : theme
}

/** What a page (or `@loadmap/export`) can drive from outside. */
export interface LoadmapHandle {
  /** Resolves once the current values are laid out and drawn, and the frame of a move to a new structure with them. */
  ready(timeoutMs?: number): Promise<void>
  pause(): void
  resume(): void
  values(): Values<any>
  setValues(v: Partial<Values<any>>): void
  /** Empties the queues and dots and starts over with this seed; a move to a new structure ends where it goes. */
  reset(seed?: number): void
  /** Advances the sim, and a move to a new structure, by `dtReal` seconds and draws the frame: the deterministic way to animate. */
  step(dtReal: number): void
  /** Shows a story step (its values and the box it points at), or leaves the story with null. */
  setStoryStep(i: number | null): void
  /** The story step shown; null outside the story. */
  storyStep(): number | null
  /**
   * Plays the story from its first step on the engine's clock, as Play does: the whole diagram, then for each step a
   * close-up on what it changes, the change, and the whole diagram for its seconds. `step()` advances it; returns its
   * length in seconds. Picking a step or a value stops it.
   */
  playStory(): number
  /**
   * On a board the reader pans and zooms, brings these boxes (node ids) into view, flying there: at the same zoom,
   * further out only as far as it takes to show them all. Nothing when they show already, while the diagram is fitted
   * or the story plays.
   */
  show(ids: readonly string[]): void
  /**
   * Lays a held diagram (`hold`) out as a page draws it, and resolves once that is drawn: before a picture or a
   * recording of an editor's diagram, which is then the one a reload shows. The boxes are there at once; with `move`
   * they move there as to any new structure, and it resolves on the first frame of the way. Nothing for a diagram
   * that is not held.
   */
  tidy(o?: { move?: boolean }): Promise<void>
  /** The drawn board, for capturing frames: while the structure moves, `scene` is the frame drawn. */
  board(): { svg: SVGSVGElement; canvas: HTMLCanvasElement; scene: Scene } | null
  engine: Engine
}

/** The root element: theme tokens, styles, and the size the layout direction follows. */
export function LoadmapRoot({
  lm,
  theme = 'auto',
  children,
}: {
  lm: LoadmapController
  theme?: Theme
  children: ReactNode
}) {
  useEffect(() => injectStyles(), [])
  const shown = usePageTheme(theme)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new theme changes the tokens, so read them again
  useEffect(() => {
    if (!lm.root) return
    lm.engine.readColors(lm.root)
    const m = matchMedia('(prefers-color-scheme: dark)')
    const f = () => lm.root && lm.engine.readColors(lm.root)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [lm.root, lm.engine, shown])
  return (
    <div
      className="lm"
      data-theme={shown === 'auto' ? undefined : shown}
      data-full={lm.fill ? 'fill' : undefined}
      data-mode={lm.fill ? lm.fullScreenMode : undefined}
      ref={lm.rootRef}
    >
      {children}
    </div>
  )
}

/** A loadmap's panels, in the order of their tabs: one opens at a time, beside the diagram. */
export const LOADMAP_PANELS = FRAME_PANELS
export type LoadmapPanel = FramePanel

/** The names `fullScreen` took while the panels were cards under the diagram, and the tab each is in now. */
const BEFORE: Record<string, LoadmapPanel> = {
  verdict: 'limits',
  live: 'live',
  limits: 'limits',
  controls: 'controls',
  headroom: 'headroom',
  compare: 'headroom',
  assumptions: 'assumptions',
}

/** The tabs a list of names stands for, old names or new, in the tabs' own order. */
export function panelsOf(names: readonly string[]): LoadmapPanel[] {
  const on = new Set(names.map((n) => BEFORE[n]))
  return LOADMAP_PANELS.filter((p) => on.has(p))
}

const warned = new Set<string>()
/** Says once that a prop has another name now. */
function renamed(old: string, now: string): void {
  if (warned.has(old)) return
  warned.add(old)
  console.warn(`loadmap: \`${old}\` is \`${now}\` now, and goes in a later version.`)
}

export interface LoadmapProps<P> extends LoadmapOptions<P> {
  model: Model<P>
  view: View
  theme?: Theme
  /** Defaults to the model's title; false hides it. */
  title?: ReactNode | false
  /** Lines added before the generated assumptions. */
  assumptions?: readonly ReactNode[]
  /** The headroom chart, in the Headroom tab. Default true. Without it and the comparison the tab is left out. */
  headroom?: boolean
  /** The scenarios side by side under the headroom chart, when the model declares two or more. Default true. */
  compare?: boolean
  /** The panels offered, in the order of their tabs. Default every one; Design only when the model has one. */
  panels?: readonly LoadmapPanel[]
  /** The panel that is open (one of the page's own by its id); null for none. Leave it out and the loadmap keeps it itself. */
  open?: LoadmapPanel | (string & {}) | null
  /** The panel open at first, when the loadmap keeps it itself. */
  defaultOpen?: LoadmapPanel | (string & {}) | null
  /** A panel opened or closed (null). */
  onOpen?: (panel: LoadmapPanel | (string & {}) | null) => void
  /**
   * The page around it scrolls: the plain wheel and one finger are the page's. Default: true in a page, false with
   * `fill` (say so for a root that fills a frame of a page that scrolls). Never in full screen.
   */
  scrolls?: boolean
  /** @deprecated `panels` now, for the page and full screen alike. Its old names still stand for their tabs. */
  fullScreen?: readonly string[]
  /** A click (or Enter) on a box of the diagram, by its id: every box is a button then. */
  onNodeClick?: (id: string) => void
  /** The box drawn as selected, by its id. */
  selected?: string | null
  /**
   * The page's own, in the canvas: each `Canvas.Panel` a panel whose tab comes before the loadmap's, anything else
   * drawn over the canvas.
   */
  children?: ReactNode
  ref?: Ref<LoadmapHandle>
}

/**
 * The whole piece in one box the page sizes (by default `clamp(420px, 70dvh, 760px)` high): the title, the scenarios
 * and the story over the diagram, the load and the verdict under it, and the limits, the design, the headroom, the
 * live meters and the assumptions in panels that open from their tabs. Full screen is the same box at the screen's
 * size.
 */
export function Loadmap<P>({
  model,
  view,
  theme,
  title,
  assumptions,
  headroom = true,
  compare = true,
  panels,
  open,
  defaultOpen,
  onOpen,
  scrolls,
  fullScreen,
  onNodeClick,
  selected,
  children,
  ref,
  ...o
}: LoadmapProps<P>) {
  const lm = useLoadmap(model, view, o)
  useImperativeHandle(ref, () => handleOf(lm), [lm])
  if (fullScreen) renamed('fullScreen', 'panels')
  if (o.fullScreenMode) renamed('fullScreenMode', 'chrome')
  const listed = panels ?? (fullScreen ? panelsOf(fullScreen) : LOADMAP_PANELS)
  // the Headroom tab holds the chart and the scenarios compared: each can be left out, and the tab with both. A list
  // by the old names, which had a panel for each, says which of the two it meant
  const old = !panels && fullScreen ? fullScreen : null
  const chart = headroom && (!old || old.includes('headroom'))
  const side = compare && model.scenarios.length > 1 && (!old || old.includes('compare'))
  return (
    <LoadmapRoot lm={lm} theme={theme}>
      <Frame
        lm={lm}
        title={title}
        panels={chart || side ? listed : listed.filter((p) => p !== 'headroom')}
        open={open}
        defaultOpen={defaultOpen}
        onOpen={onOpen}
        assumptions={assumptions}
        scrolls={scrolls}
        headroom={chart}
        compare={side}
        onNodeClick={onNodeClick}
        selected={selected}
      >
        {children}
      </Frame>
    </LoadmapRoot>
  )
}

export function handleOf(lm: LoadmapController): LoadmapHandle {
  const { engine } = lm
  return {
    engine,
    async ready(timeoutMs = 10_000) {
      const t0 = performance.now()
      const drawn = () =>
        engine.scene &&
        engine.scene.key === engine.wantKey &&
        engine.svg &&
        engine.drawnValues === JSON.stringify(engine.ev.values) &&
        engine.drawnFocus === engine.wantFocus &&
        engine.drawnFrame === engine.frameId
      while (!drawn()) {
        if (performance.now() - t0 > timeoutMs) throw new Error('loadmap: layout not ready')
        await new Promise((r) => requestAnimationFrame(r))
      }
    },
    pause: () => {
      engine.paused = true
    },
    resume: () => {
      engine.paused = false
    },
    values: () => engine.ev.values,
    show: (ids) => engine.viewer?.show(ids),
    async tidy(o = {}) {
      if (!lm.held) return
      // not ready from now on: the tidy scene has the held one's key, and the hook says so only on its next render
      engine.wantKey = ''
      lm.tidy()
      await this.ready()
      if (o.move) return
      // a picture is of the tidy layout, not of a frame on the way there
      engine.settle()
      await this.ready()
    },
    setValues: (v) => lm.setValues(v),
    setStoryStep: (i) => lm.setStep(i),
    storyStep: () => engine.storyStep,
    playStory: () => {
      const start = engine.ev
      if (!engine.playStory(0))
        throw new Error('loadmap: the story cannot play: nothing is drawn yet, or there is none')
      return storySeconds(engine.model, start, engine.transition)
    },
    reset: (seed) => engine.reset(seed),
    step: (dt) => {
      engine.step(dt, { particles: true })
      engine.draw({ particles: true })
    },
    board: () =>
      engine.svg && engine.canvas && engine.frame
        ? { svg: engine.svg, canvas: engine.canvas, scene: engine.frame }
        : null,
  }
}
