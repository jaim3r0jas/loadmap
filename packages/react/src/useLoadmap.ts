import type { Evaluation, Model, Scenario, Values } from '@loadmap/core'
import {
  type Direction,
  directionOf,
  type ElkEngine,
  labelsAt,
  layout,
  type Scene,
  structureKey,
  type TextMeasure,
  type View,
} from '@loadmap/layout'
import { shapesOf } from '@loadmap/layout/internal'
import type { SimOptions } from '@loadmap/sim'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { pageElk } from './elk'
import { type Cue, Engine } from './engine'

export interface LoadmapOptions<P> extends SimOptions {
  /** Values to start from instead of the model's defaults. */
  initial?: Partial<Values<P>>
  /** Where ELK lays the diagram out. Default: one worker shared by the page, or the main thread if it cannot start. */
  elk?: ElkEngine
  /** Below this container width the diagram is laid out top to bottom. Default 640. */
  narrowBelow?: number
  /**
   * Which way the diagram runs where there is room. Default: from its shape (`directionOf`), right unless its widest
   * layer has more boxes than its longest chain; below `narrowBelow` it is always DOWN.
   */
  direction?: Direction
  /** What full screen opens with: the panels around the diagram, or mainly the diagram and the story. Default panels. */
  fullScreenMode?: FullScreenMode
  /**
   * The root fills its container, laid out as full screen is (in `fullScreenMode`), and stays so: no full screen
   * button. For a page of its own made to be framed, such as an embed: the container takes the frame's height, and the
   * layout follows the frame's size as full screen follows the screen's.
   */
  fill?: boolean
  /**
   * The reader can pan and zoom the diagram: drag it, pinch it, the keys + − 0 and the arrows, and the zoom buttons on
   * the board. The wheel zooms with Ctrl or ⌘ held, so the page keeps its scroll; a `<Diagram canvas>` that fills a
   * page of its own zooms with the wheel alone. Pictures and recordings show the whole diagram whatever the view.
   */
  zoom?: boolean
  /**
   * Seconds the diagram takes to move to a new structure (a scenario, a story step or a control that adds pods): what
   * stays moves, what is new fades in. 0 cuts. Default 0.8; with reduced motion it always cuts. The load never moves it.
   */
  transition?: number
}

/** Full screen with every panel it lists in a compact form, or mainly the diagram and the story. */
export type FullScreenMode = 'panels' | 'focus'

export interface LoadmapController<P = any> {
  model: Model<P>
  view: View
  values: Values<P>
  setValues: (v: Partial<Values<P>>) => void
  /** The scenario the values match, load aside; null for values of the reader's own. */
  scenario: Scenario<P> | null
  /** Takes a scenario's values; the load stays. */
  setScenario: (label: string) => void
  /** The story step shown, by index; null outside the story. */
  step: number | null
  /** The reader changed a value since the step was shown: its outline is gone. */
  stepChanged: boolean
  /** Shows a story step (its values, its focus), or leaves the story with null. */
  setStep: (i: number | null) => void
  /** The component the story points at now. */
  focus: string | null
  /**
   * The story plays: the whole diagram, then for each step a close-up on what it changes, the change, and the whole
   * diagram again for its seconds, until the last.
   */
  storyPlaying: boolean
  /**
   * Plays the story from the step after the one shown (from the first outside the story or at its end), or pauses it.
   * A value the reader changes, a scenario or a step they pick stops it.
   */
  setStoryPlaying: (on: boolean) => void
  /** What the diagram says about the step the story plays; null when it does not play. */
  cue: Cue | null
  /** The root is full screen: the browser's, an overlay where the browser has none or refuses, or `fill`. */
  fullScreen: boolean
  /** The root fills its container as full screen does, for good. */
  fill: boolean
  /** The reader can pan and zoom the diagram. */
  zoom: boolean
  toggleFullScreen: () => void
  /** What full screen shows. The reader switches it; the page picks where it starts. */
  fullScreenMode: FullScreenMode
  setFullScreenMode: (m: FullScreenMode) => void
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
  // setValues evaluates once for the engine; the render reuses that evaluation. It also holds the values set last
  const evaluated = useRef<{ values: Values<P>; ev: Evaluation<P> } | null>(null)
  // a new model starts from its own defaults
  let values = state.values
  if (state.model !== model) {
    values = init()
    evaluated.current = null
    setState({ model, values })
  }
  // React can render an older state once more after new values are set (a render already under way): such a render
  // must not hand the engine its older numbers, nor be the base of the next change
  const fresh = !evaluated.current || evaluated.current.values === values

  const ev = useMemo(
    () => (evaluated.current?.values === values ? evaluated.current.ev : model.evaluate(values)),
    [model, values],
  )

  const engineRef = useRef<Engine | null>(null)
  if (!engineRef.current || engineRef.current.model !== model || engineRef.current.view !== view)
    engineRef.current = new Engine(model, view, ev, o)
  const engine = engineRef.current
  engine.transition = o.transition ?? 0.8

  const [root, setRoot] = useState<HTMLElement | null>(null)
  const wide = o.direction ?? directionOf(view)
  // only the width is state: a view of another shape lays out its own way on the render it arrives in
  const [narrow, setNarrow] = useState(false)
  const direction: Direction = narrow ? 'DOWN' : wide
  const [measure, setMeasure] = useState<TextMeasure | null>(null)
  const [laid, setLaid] = useState<{ view: View; scene: Scene } | null>(null)
  const scene = laid?.view === view ? laid.scene : null
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  engine.reducedMotion = reducedMotion
  const narrowBelow = o.narrowBelow ?? 640

  // checked when it runs, not when it rendered: React may run a render's effects after newer values were set
  useEffect(() => {
    if (!evaluated.current || evaluated.current.values === values) engine.setEvaluation(ev)
  }, [engine, ev, values])

  useEffect(() => {
    if (!root) return
    setMeasure(() => canvasMeasure(getComputedStyle(root).fontFamily))
    const ro = new ResizeObserver(([e]) => {
      const w = e?.contentRect.width ?? root.clientWidth
      setNarrow(w > 0 && w < narrowBelow)
    })
    ro.observe(root)
    return () => ro.disconnect()
  }, [root, narrowBelow])

  const key = useMemo(
    () => (measure ? structureKey(view, ev, { direction, measure }) : ''),
    [view, ev, direction, measure],
  )
  if (fresh) engine.wantKey = key
  const elk = o.elk
  useEffect(() => {
    if (!measure || !key) return
    let live = true
    layout(view, engine.ev, { direction, measure, elk: elk ?? pageElk() }).then(
      (s) => {
        // the engine takes the scene when the diagram has drawn it, so dots never run ahead of the SVG
        if (live) setLaid({ view, scene: s })
      },
      (err) => console.error('loadmap: layout failed', err),
    )
    return () => {
      live = false
    }
  }, [key, view, engine, direction, measure, elk])

  const labels = useMemo(() => labelsAt(view, ev), [view, ev])
  const valuesRef = useRef(values)
  if (fresh) valuesRef.current = values
  // the story player's own changes: the reader's stop it
  const apply = useCallback(
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

  // the player's state is its engine's: a new model (a new engine) has no story playing
  const [played, setPlayed] = useState<{ engine: Engine; on: boolean; cue: Cue | null }>({
    engine,
    on: false,
    cue: null,
  })
  const playing = played.engine === engine && played.on
  const cue = played.engine === engine ? played.cue : null
  const stop = useCallback(() => engine.stopStory(), [engine])
  const setValues = useCallback(
    (v: Partial<Values<P>>) => {
      stop()
      apply(v)
    },
    [stop, apply],
  )

  const scenario = useMemo(() => model.scenarioOf(values), [model, values])
  const setScenario = useCallback(
    (label: string) => {
      const s = model.scenarios.find((x) => x.label === label)
      if (s) setValues(s.values as Partial<Values<P>>)
    },
    [model, setValues],
  )

  const [stepState, setStepState] = useState<{ model: Model<P>; i: number | null }>({ model, i: null })
  const step = stepState.model === model && stepState.i != null && stepState.i < model.story.length ? stepState.i : null
  const show = useCallback(
    (i: number | null) => {
      const st = i == null ? undefined : model.story[i]
      if (st) apply(st.values)
      engine.wantFocus = st?.focus ?? null
      engine.storyStep = st ? i : null
      setStepState({ model, i: st ? i : null })
    },
    [model, apply, engine],
  )
  const setStep = useCallback(
    (i: number | null) => {
      stop()
      show(i)
    },
    [stop, show],
  )
  // a value the reader changed since the step was shown: the step's text and outline no longer describe the board
  const shown = step == null ? undefined : model.story[step]
  const stepChanged =
    !!shown && Object.entries(shown.values).some(([k, v]) => (values as Record<string, unknown>)[k] !== v)
  const focus = shown && !stepChanged ? (shown.focus ?? null) : null
  engine.wantFocus = focus
  engine.storyStep = step

  // the story plays on the engine's clock, which shows each step through `show`; the shapes tell it what a step reshapes
  const measureRef = useRef(measure)
  measureRef.current = measure
  engine.host = {
    playing: (on) => setPlayed((p) => ({ engine, on, cue: on && p.engine === engine ? p.cue : null })),
    show,
    cue: (c) => setPlayed((p) => ({ engine, on: p.engine === engine && p.on, cue: c })),
    shapes: (e) => shapesOf(view, e, { direction, measure: measureRef.current ?? undefined }),
  }
  // a value changed from outside the controller (a handle, a new model) stops it too
  useEffect(() => {
    if (playing && stepChanged) stop()
  }, [playing, stepChanged, stop])
  const storyPlaying = playing && model.story.length > 0
  const setStoryPlaying = useCallback(
    (on: boolean) => {
      if (!on) return stop()
      const last = model.story.length - 1
      if (last < 0) return
      // from the step after the one shown; else the first. A step whose values the reader changed is played again,
      // from their values: the story is left first, so they are no longer a change to it
      const from = step == null || step === last ? 0 : stepChanged ? step : step + 1
      if (stepChanged) show(null)
      engine.playStory(from)
      // inline, the board may be off the screen: the story is told on it
      if (!document.fullscreenElement && !root?.hasAttribute('data-full'))
        root?.querySelector('.lm-board')?.scrollIntoView({ block: 'nearest' })
    },
    [step, stepChanged, model, engine, stop, show, root],
  )

  // the browser's full screen, or a fixed overlay where it has none (iPhone) or refuses (a frame without the permission)
  const [screen, setScreen] = useState(false)
  const [overlay, setOverlay] = useState(false)
  const fill = !!o.fill
  const fullScreen = fill || screen || overlay
  useEffect(() => {
    const f = () => setScreen(!!root && document.fullscreenElement === root)
    document.addEventListener('fullscreenchange', f)
    return () => document.removeEventListener('fullscreenchange', f)
  }, [root])
  const start = o.fullScreenMode ?? 'panels'
  const [modeState, setModeState] = useState({ start, mode: start })
  // a page that picks another start resets the reader's choice
  const fullScreenMode = modeState.start === start ? modeState.mode : start
  const setFullScreenMode = useCallback((mode: FullScreenMode) => setModeState({ start, mode }), [start])
  // the stylesheet lays the root out from these. The overlay goes in the top layer: a fixed root would only cover an
  // ancestor with a transform, a filter or containment. A root that fills its frame has them from its first paint:
  // the root renders them
  useEffect(() => {
    if (!root || !fullScreen || fill) return
    root.setAttribute('data-full', overlay ? 'overlay' : 'screen')
    const top = overlay && typeof root.showPopover === 'function'
    if (top) {
      root.popover = 'manual'
      root.showPopover()
    }
    return () => {
      root.removeAttribute('data-full')
      if (top) {
        root.hidePopover()
        root.removeAttribute('popover')
      }
    }
  }, [root, fullScreen, overlay, fill])
  useEffect(() => {
    if (!root || !fullScreen || fill) return
    root.setAttribute('data-mode', fullScreenMode)
    return () => root.removeAttribute('data-mode')
  }, [root, fullScreen, fullScreenMode, fill])
  // Esc leaves the overlay as it leaves the browser's full screen
  useEffect(() => {
    if (!overlay) return
    const f = (e: KeyboardEvent) => e.key === 'Escape' && setOverlay(false)
    document.addEventListener('keydown', f)
    return () => document.removeEventListener('keydown', f)
  }, [overlay])
  const toggleFullScreen = useCallback(() => {
    // nothing is drawn without a root to measure; a root that fills its container stays as it is
    if (!root || fill) return
    if (overlay) setOverlay(false)
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else if (root.requestFullscreen) root.requestFullscreen().catch(() => setOverlay(true))
    else setOverlay(true)
  }, [root, overlay, fill])

  return {
    model,
    view,
    values,
    setValues,
    scenario,
    setScenario,
    step,
    stepChanged,
    setStep,
    focus,
    storyPlaying,
    setStoryPlaying,
    cue: storyPlaying ? cue : null,
    fullScreen,
    fill,
    zoom: !!o.zoom,
    toggleFullScreen,
    fullScreenMode,
    setFullScreenMode,
    ev,
    scene,
    labels,
    direction,
    reducedMotion,
    engine,
    rootRef: setRoot,
    root,
  }
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

function canvasMeasure(fontFamily: string): TextMeasure {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return (t, size) => t.length * size * 0.6
  return (text, size, weight = 400) => {
    ctx.font = `${weight} ${size}px ${fontFamily}`
    return Math.ceil(ctx.measureText(text).width)
  }
}
