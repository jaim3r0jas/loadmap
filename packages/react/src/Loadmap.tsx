import type { Model, Values } from '@loadmap/core'
import type { Scene, View } from '@loadmap/layout'
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Dock, type OpenPanel, VerdictLine } from './compact'
import { Diagram } from './Diagram'
import type { Engine } from './engine'
import { Assumptions, Controls, Limits, LoadRange, Meters, Verdict } from './panels'
import { Compare, HeadroomChart, Scenarios } from './scenarios'
import { Story } from './story'
import { injectStyles } from './styles'
import { type LoadmapController, type LoadmapOptions, useLoadmap } from './useLoadmap'

export type Theme = 'auto' | 'light' | 'dark'

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new theme changes the tokens, so read them again
  useEffect(() => {
    if (!lm.root) return
    lm.engine.readColors(lm.root)
    const m = matchMedia('(prefers-color-scheme: dark)')
    const f = () => lm.root && lm.engine.readColors(lm.root)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [lm.root, lm.engine, theme])
  return (
    <div className="lm" data-theme={theme === 'auto' ? undefined : theme} ref={lm.rootRef}>
      {children}
    </div>
  )
}

/** The panels full screen shows with the diagram, compact: the verdict and the assumptions in a line under it. */
export const LOADMAP_PANELS = ['verdict', 'live', 'limits', 'controls', 'headroom', 'compare', 'assumptions'] as const
export type LoadmapPanel = (typeof LOADMAP_PANELS)[number]

export interface LoadmapProps<P> extends LoadmapOptions<P> {
  model: Model<P>
  view: View
  theme?: Theme
  /** Defaults to the model's title; false hides it. */
  title?: ReactNode | false
  /** Lines added before the generated assumptions. */
  assumptions?: readonly ReactNode[]
  /** The headroom chart. Default true. */
  headroom?: boolean
  /** The scenarios side by side, when the model declares two or more. Default true. */
  compare?: boolean
  /**
   * The panels full screen shows, compact, below the diagram. Default every one the page shows. Focus mode shows the
   * verdict and the load slider of these.
   */
  fullScreen?: readonly LoadmapPanel[]
  /** A click (or Enter) on a box of the diagram, by its id: every box is a button then. */
  onNodeClick?: (id: string) => void
  /** The box drawn as selected, by its id. */
  selected?: string | null
  ref?: Ref<LoadmapHandle>
}

/** The whole page piece: scenarios, diagram, verdict, headroom, live meters, limits, controls and assumptions. */
export function Loadmap<P>({
  model,
  view,
  theme,
  title,
  assumptions,
  headroom = true,
  compare = true,
  fullScreen = LOADMAP_PANELS,
  onNodeClick,
  selected,
  ref,
  ...o
}: LoadmapProps<P>) {
  const lm = useLoadmap(model, view, o)
  useImperativeHandle(ref, () => handleOf(lm), [lm])
  const side = compare && model.scenarios.length > 1
  const charts: LoadmapPanel[] = []
  if (headroom) charts.push('headroom')
  if (side) charts.push('compare')
  // marks what full screen leaves out: a panel not listed, a container none of whose panels are
  const out = (...panels: LoadmapPanel[]) => (panels.some((p) => fullScreen.includes(p)) ? undefined : '')
  const listed = (p: LoadmapPanel) => fullScreen.includes(p) && (p === 'headroom' ? headroom : p !== 'compare' || side)
  const full = lm.fullScreen
  const focus = full && lm.fullScreenMode === 'focus'

  // a panel whole, over the diagram: the page's own panel, shown alone, so there is never a second copy
  const [drawer, setDrawer] = useState<{ panel: LoadmapPanel; from: HTMLElement } | null>(null)
  if (drawer && !full) setDrawer(null)
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (drawer) close.current?.focus()
  }, [drawer])
  const open: OpenPanel = (p, from) => setDrawer({ panel: p, from })
  const shut = () => {
    drawer?.from.focus()
    setDrawer(null)
  }
  // Esc closes the drawer first, before the overlay's Esc on the document sees it
  useEffect(() => {
    if (!drawer) return
    const f = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      drawer.from.focus()
      setDrawer(null)
    }
    document.addEventListener('keydown', f, true)
    return () => document.removeEventListener('keydown', f, true)
  }, [drawer])
  const drawn = (...panels: LoadmapPanel[]) => (drawer && panels.includes(drawer.panel) ? '' : undefined)
  // in full screen only the panel open whole is drawn: the compact ones do the work of the rest
  const panel = (id: LoadmapPanel, children: ReactNode) => (
    <div className="lm-panel" data-panel={id} data-out={out(id)} data-drawn={drawn(id)}>
      {(!full || drawer?.panel === id) && children}
    </div>
  )
  const heading = title !== false && <h2>{title ?? model.title}</h2>
  const verdict = listed('verdict')
  const line = focus ? verdict || listed('controls') : verdict || listed('assumptions')
  return (
    <LoadmapRoot lm={lm} theme={theme}>
      {full ? (
        <div className="lm-head">
          {heading}
          <Scenarios lm={lm} />
        </div>
      ) : (
        <>
          {heading}
          <Scenarios lm={lm} />
        </>
      )}
      {/* focus shows it under the diagram, by its order: here it keeps its keyboard focus and its fill */}
      <Story lm={lm} />
      <Diagram lm={lm} onNodeClick={onNodeClick} selected={selected} />
      {full && line && (
        <div className="lm-line" data-tier={lm.ev.verdict.tier}>
          <VerdictLine
            lm={lm}
            verdict={verdict}
            extra={assumptions?.length}
            open={open}
            assumptions={!focus && listed('assumptions')}
          />
          {focus && listed('controls') && <LoadRange lm={lm} />}
        </div>
      )}
      {full && !focus && <Dock lm={lm} panels={LOADMAP_PANELS.filter(listed)} open={open} />}
      {/* on the page its parts are the root's; in full screen it is the drawer, one panel at a time */}
      <div
        className="lm-side lm-drawer"
        data-out={out('verdict', 'live', 'limits', 'controls', ...charts, 'assumptions')}
        data-drawer={drawer?.panel}
        // a dialog while it is the drawer; on the page nothing but a wrapper
        {...(drawer && { role: 'dialog', 'aria-label': 'The whole panel' })}
      >
        {drawer && (
          <div className="lm-drawer-bar" data-drawn="">
            <button type="button" className="lm-btn" onClick={shut} ref={close}>
              ✕ Back to full screen
            </button>
          </div>
        )}
        {panel('verdict', <Verdict lm={lm} />)}
        {charts.length > 0 && (
          <div
            className={charts.length > 1 ? 'lm-charts lm-strip' : 'lm-charts'}
            data-out={out(...charts)}
            data-drawn={drawn(...charts)}
          >
            {headroom && panel('headroom', <HeadroomChart lm={lm} />)}
            {side && panel('compare', <Compare lm={lm} />)}
          </div>
        )}
        <div
          className="lm-strip lm-live"
          data-out={out('live', 'limits', 'controls')}
          data-drawn={drawn('live', 'limits', 'controls')}
        >
          <div className="lm-card" data-out={out('live', 'limits')} data-drawn={drawn('live', 'limits')}>
            {panel('live', <Meters lm={lm} />)}
            {panel('limits', <Limits lm={lm} />)}
          </div>
          {panel('controls', <Controls lm={lm} />)}
        </div>
        {panel('assumptions', <Assumptions lm={lm} extra={assumptions} />)}
      </div>
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
    setValues: (v) => lm.setValues(v),
    setStoryStep: (i) => lm.setStep(i),
    storyStep: () => engine.storyStep,
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
