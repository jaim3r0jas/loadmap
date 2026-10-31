import type { Model, Values } from '@loadmap/core'
import type { Scene, View } from '@loadmap/layout'
import { type ReactNode, type Ref, useEffect, useImperativeHandle } from 'react'
import { Diagram } from './Diagram'
import type { Engine } from './engine'
import { Assumptions, Controls, Limits, Meters, Verdict } from './panels'
import { Compare, HeadroomChart, Scenarios } from './scenarios'
import { injectStyles } from './styles'
import { type LoadmapController, type LoadmapOptions, useLoadmap } from './useLoadmap'

export type Theme = 'auto' | 'light' | 'dark'

/** What a page (or `@loadmap/export`) can drive from outside. */
export interface LoadmapHandle {
  /** Resolves once the current values are laid out and drawn. */
  ready(timeoutMs?: number): Promise<void>
  pause(): void
  resume(): void
  values(): Values<any>
  setValues(v: Partial<Values<any>>): void
  /** Empties the queues and dots and starts over with this seed. */
  reset(seed?: number): void
  /** Advances the sim by `dtReal` seconds and draws the frame: the deterministic way to animate. */
  step(dtReal: number): void
  /** The drawn board, for capturing frames. */
  board(): { svg: SVGSVGElement; canvas: HTMLCanvasElement; scene: Scene } | null
  engine: Engine
}

/** The root element: theme tokens, styles, and the size the layout direction follows. */
export function Root({ lm, theme = 'auto', children }: { lm: LoadmapController; theme?: Theme; children: ReactNode }) {
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
  ref,
  ...o
}: LoadmapProps<P>) {
  const lm = useLoadmap(model, view, o)
  useImperativeHandle(ref, () => handleOf(lm), [lm])
  const side = compare && model.scenarios.length > 1
  return (
    <Root lm={lm} theme={theme}>
      {title !== false && <h2>{title ?? model.title}</h2>}
      <Scenarios lm={lm} />
      <Diagram lm={lm} />
      <Verdict lm={lm} />
      {(headroom || side) && (
        <div className={headroom && side ? 'lm-strip' : undefined}>
          {headroom && <HeadroomChart lm={lm} />}
          {side && <Compare lm={lm} />}
        </div>
      )}
      <div className="lm-strip">
        <div className="lm-card">
          <Meters lm={lm} />
          <Limits lm={lm} />
        </div>
        <Controls lm={lm} />
      </div>
      <Assumptions lm={lm} extra={assumptions} />
    </Root>
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
        engine.drawnValues === JSON.stringify(engine.ev.values)
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
    reset: (seed) => engine.reset(seed),
    step: (dt) => {
      engine.step(dt, { particles: true })
      engine.draw({ particles: true })
    },
    board: () =>
      engine.svg && engine.canvas && engine.scene
        ? { svg: engine.svg, canvas: engine.canvas, scene: engine.scene }
        : null,
  }
}
