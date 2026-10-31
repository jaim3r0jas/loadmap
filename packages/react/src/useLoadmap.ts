import type { Evaluation, Model, Values } from '@loadmap/core'
import { type Direction, labelsAt, layout, type Measure, type Scene, structureKey, type View } from '@loadmap/layout'
import type { SimOptions } from '@loadmap/sim'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Engine } from './engine'

export interface LoadmapOptions<P> extends SimOptions {
  /** Values to start from instead of the model's defaults. */
  initial?: Partial<Values<P>>
  /** Below this container width the diagram is laid out top to bottom. Default 640. */
  narrowBelow?: number
}

export interface LoadmapController<P = any> {
  model: Model<P>
  view: View
  values: Values<P>
  setValues: (v: Partial<Values<P>>) => void
  ev: Evaluation<P>
  /** null until the first layout is done. */
  scene: Scene | null
  labels: ReturnType<typeof labelsAt>
  direction: Direction
  reducedMotion: boolean
  engine: Engine
  /** Attach to the element that carries the `.lm` class: its width picks the direction, its tokens the colours. */
  rootRef: (el: HTMLElement | null) => void
  root: HTMLElement | null
}

/** The state behind a loadmap: values, the model's evaluation, the layout and the engine. */
export function useLoadmap<P>(model: Model<P>, view: View, o: LoadmapOptions<P> = {}): LoadmapController<P> {
  const init = () => ({ ...model.defaults(), ...o.initial }) as Values<P>
  const [state, setState] = useState(() => ({ model, values: init() }))
  // a new model starts from its own defaults
  let values = state.values
  if (state.model !== model) {
    values = init()
    setState({ model, values })
  }

  // setValues evaluates once for the engine; the render reuses that evaluation
  const evaluated = useRef<{ values: Values<P>; ev: Evaluation<P> } | null>(null)
  const ev = useMemo(
    () => (evaluated.current?.values === values ? evaluated.current.ev : model.evaluate(values)),
    [model, values],
  )

  const engineRef = useRef<Engine | null>(null)
  if (!engineRef.current || engineRef.current.model !== model || engineRef.current.view !== view)
    engineRef.current = new Engine(model, view, ev, o)
  const engine = engineRef.current

  const [root, setRoot] = useState<HTMLElement | null>(null)
  const [direction, setDirection] = useState<Direction>('RIGHT')
  const [measure, setMeasure] = useState<Measure | null>(null)
  const [laid, setLaid] = useState<{ view: View; scene: Scene } | null>(null)
  const scene = laid?.view === view ? laid.scene : null
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const narrowBelow = o.narrowBelow ?? 640

  useEffect(() => engine.setEvaluation(ev), [engine, ev])

  useEffect(() => {
    if (!root) return
    setMeasure(() => canvasMeasure(getComputedStyle(root).fontFamily))
    const ro = new ResizeObserver(([e]) => {
      const w = e?.contentRect.width ?? root.clientWidth
      setDirection(w > 0 && w < narrowBelow ? 'DOWN' : 'RIGHT')
    })
    ro.observe(root)
    return () => ro.disconnect()
  }, [root, narrowBelow])

  const key = useMemo(
    () => (measure ? structureKey(view, ev, { direction, measure }) : ''),
    [view, ev, direction, measure],
  )
  engine.wantKey = key
  useEffect(() => {
    if (!measure || !key) return
    let live = true
    layout(view, engine.ev, { direction, measure }).then(
      (s) => {
        // the engine takes the scene when the diagram has drawn it, so dots never run ahead of the SVG
        if (live) setLaid({ view, scene: s })
      },
      (err) => console.error('loadmap: layout failed', err),
    )
    return () => {
      live = false
    }
  }, [key, view, engine, direction, measure])

  const labels = useMemo(() => labelsAt(view, ev), [view, ev])
  const valuesRef = useRef(values)
  valuesRef.current = values
  const setValues = useCallback(
    (v: Partial<Values<P>>) => {
      const next = { ...valuesRef.current, ...v }
      valuesRef.current = next
      // the engine takes the new numbers now, so a frame stepped before React renders already uses them
      const nextEv = model.evaluate(next)
      evaluated.current = { values: next, ev: nextEv }
      engine.setEvaluation(nextEv)
      setState({ model, values: next })
    },
    [engine, model],
  )

  return { model, view, values, setValues, ev, scene, labels, direction, reducedMotion, engine, rootRef: setRoot, root }
}

export function useMediaQuery(q: string): boolean {
  const [on, setOn] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const m = matchMedia(q)
    const f = () => setOn(m.matches)
    f()
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [q])
  return on
}

function canvasMeasure(fontFamily: string): Measure {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return (t, size) => t.length * size * 0.6
  return (text, size, weight = 400) => {
    ctx.font = `${weight} ${size}px ${fontFamily}`
    return Math.ceil(ctx.measureText(text).width)
  }
}
