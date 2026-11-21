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
import { type Arrangement, arrange, closing, shapesOf } from '@loadmap/layout/internal'
import type { SimOptions } from '@loadmap/sim'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { loadFrames } from './Diagram'
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
   * Which way the diagram runs. Default `auto`: the way that fits the room it is given larger (a board that fills its
   * container, a canvas between its insets; on a page, the board's width by most of the window's height), and where
   * both fit about as well, the way its shape suggests (`directionOf`: right unless its widest layer has more boxes
   * than its longest chain). Neither the load nor a scenario, step or control turns it: only the room and the
   * structure do. `RIGHT` or `DOWN` holds it. Below `narrowBelow` it is always DOWN, whichever is set.
   */
  direction?: Direction | 'auto'
  /**
   * The rows a long diagram is folded into (columns, running down). Default `auto`: one row where its titles read
   * with ease in the room it is given, else the fewest rows, three at most, that draw it clearly larger. A number
   * holds it: 1 never folds. A narrow screen (`narrowBelow`) never folds.
   */
  rows?: number | 'auto'
  /**
   * How much stands around the diagram in full screen, and in a root that fills its frame: `all`, with the panels'
   * tabs, or `least`, the diagram, the load and the verdict alone. In full screen the reader switches it (the Panels
   * button, F); a root that fills shows what the page picked. Default `all`.
   */
  chrome?: Chrome
  /** @deprecated `chrome` now: `panels` is `all`, `focus` is `least`. */
  fullScreenMode?: FullScreenMode
  /**
   * The root fills its container, laid out as full screen is (with its `chrome`), and stays so: no full screen
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
   * The subsystems drawn closed at first, each as one box that stands for everything inside it, by the ids the view
   * gives them. The reader opens one with a click on it and closes one with a click on its name; a story step says
   * its own (`closed` in the step). Default none.
   */
  closed?: readonly string[]
  /**
   * Seconds the diagram takes to move to a new structure (a scenario, a story step or a control that adds pods): what
   * stays moves, what is new fades in. 0 cuts. Default 0.8; with reduced motion it always cuts. The load never moves it.
   */
  transition?: number
}

/** What stands around the diagram in full screen, as the controller holds it: `panels` is `chrome` `all`, `focus` is `least`. */
export type FullScreenMode = 'panels' | 'focus'
/** What stands around the diagram in full screen: everything, or the least. */
export type Chrome = 'all' | 'least'

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
  /** The subsystems drawn closed now. */
  closed: readonly string[]
  /** Draws these subsystems closed, and every other one open. */
  setClosed: (ids: readonly string[]) => void
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

/** The rows `auto` may fold a diagram into. */
const FOLDS = [1, 2, 3]
/** A page that closes no subsystem. */
const NONE: readonly string[] = []
/** Stands for a room that is still to come. */
const DUE = { w: 0, h: 0 }

/** The state behind a loadmap: values, the model's evaluation, the layout and the engine. */
export function useLoadmap<P>(model: Model<P>, whole: View, o: LoadmapOptions<P> = {}): LoadmapController<P> {
  // the subsystems drawn closed: the page's, but those the reader or a story step opened, and with those they closed.
  // Held by id, not by view: a new view (the text edited, a file of it opened) keeps every one as it stands, so
  // nothing closes or opens but by its own control; an id the new view lacks closes nothing. What closes them and
  // draws their frames comes with the first view that has a subsystem, before it is laid out
  const [turned, setTurned] = useState<{ open: readonly string[]; shut: readonly string[] } | null>(null)
  const own = o.closed ?? NONE
  const ownRef = useRef(own)
  ownRef.current = own
  const closed = turned
    ? [...own.filter((id) => !turned.open.includes(id)), ...turned.shut.filter((id) => !own.includes(id))]
    : own
  /** These drawn closed and every other one open, as what it changes of the page's own; null is the page's own. */
  const turn = useCallback((ids: readonly string[] | null) => {
    const page = ownRef.current
    setTurned(ids && { open: page.filter((id) => !ids.includes(id)), shut: ids.filter((id) => !page.includes(id)) })
  }, [])
  // one function for every view: once it is there it stays
  const [close, setClose] = useState<((view: View, closed: readonly string[]) => View) | null>(null)
  useEffect(() => {
    let live = true
    const loading = closing(whole)
    if (loading)
      Promise.all([loading, loadFrames()]).then(
        ([f]) => live && setClose(() => f),
        (err) => console.error('loadmap: layout failed', err),
      )
    return () => {
      live = false
    }
  }, [whole])
  const unready = !close && Object.keys(whole.def.subsystems ?? {}).length > 0
  // closed, the diagram is another view: it moves there as it moves to an edited one
  const view = close && closed.length ? close(whole, closed) : whole
  const setClosed = useCallback((ids: readonly string[]) => turn(ids), [turn])
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
  engineRef.current ??= new Engine(model, view, ev, o)
  const engine = engineRef.current
  // a new model (the text edited) keeps the engine: what is drawn moves to the new structure, the view stays.
  // Once committed, with the newest numbers: it tells the board, which must not hear of it while this renders.
  // Another view of the same model (a subsystem closed or opened) is only drawn another way: the story plays on and
  // the dots keep running, every stage still has its box
  useLayoutEffect(() => {
    if (engine.model !== model) engine.setModel(model, view, evaluated.current?.ev ?? ev, o)
    else engine.view = view
  })
  engine.transition = o.transition ?? 0.8

  const [root, setRoot] = useState<HTMLElement | null>(null)
  const auto = o.direction == null || o.direction === 'auto'
  const shape = directionOf(view)
  // only the width is state: a view of another shape lays out its own way on the render it arrives in
  const [narrow, setNarrow] = useState(false)
  const [measure, setMeasure] = useState<TextMeasure | null>(null)
  const [laid, setLaid] = useState<{ view: View; scene: Scene } | null>(null)
  const scene = laid?.view === view ? laid.scene : null
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  engine.reducedMotion = reducedMotion
  const narrowBelow = o.narrowBelow ?? 640
  const elk = o.elk

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

  // how the diagram is arranged in the board's room: the way it runs (`auto`) and the rows it is folded into, worked
  // out per room and structure, never per phase. It stays as it stands unless another arrangement fits clearly larger,
  // so neither a drag of the window's edge nor an edit that barely changes the sizes turns or folds it
  // `DUE`: a board will tell its room but has not yet (a canvas before its zoom is there)
  const told = useSyncExternalStore(
    engine.subscribe,
    () => engine.room ?? (engine.roomDue ? DUE : null),
    () => null,
  )
  const due = told === DUE
  const room = due ? null : told
  const [picked, setPicked] = useState<({ view: View; among: string } & Arrangement) | null>(null)
  const stands = useRef<Arrangement | null>(null)
  // the ways it may run and the rows it may take: a narrow screen and the page's own direction leave one way
  const held: Direction | null = narrow ? 'DOWN' : auto ? null : (o.direction as Direction)
  // a narrow screen runs down in one column: columns side by side would each be narrower still
  // (a count that is no number, or under 1, holds nothing)
  const fixed = narrow ? 1 : typeof o.rows === 'number' && o.rows >= 1 ? Math.floor(o.rows) : null
  const chooses = !!room && !(held && fixed)
  const among = `${held} ${fixed}`
  useEffect(() => {
    if (!chooses || !room || !measure) return
    let live = true
    const at = { measure, elk: elk ?? pageElk() }
    const ways = (held ? [held] : (['RIGHT', 'DOWN'] as const)).flatMap((direction) =>
      (fixed ? [fixed] : FOLDS).map((rows) => ({ direction, rows })),
    )
    const keep = stands.current ?? { direction: directionOf(view), rows: 1 }
    const take = (a: Arrangement) => {
      if (!live) return
      stands.current = a
      setPicked((p) =>
        p?.view === view && p.among === among && p.direction === a.direction && p.rows === a.rows
          ? p
          : { view, among, ...a },
      )
    }
    arrange(view, ways, room, keep, at).then(take, (err) => {
      console.error('loadmap: layout failed', err)
      // the sizes are not to be had: as it stands, or as its shape runs, so the diagram is still drawn
      take({ direction: held ?? keep.direction, rows: fixed ?? 1 })
    })
    return () => {
      live = false
    }
  }, [chooses, held, fixed, among, room, measure, view, elk])
  // a new view is arranged as the last was until its own sizes are known, so an edit is drawn at once; it is not ready
  // until then (`pending`), so nothing records it a moment before it changes. A board that told its room is not laid
  // out before its first pick, so it never shows one arrangement and then another; without a board the shape decides
  // The same after its room narrows past `narrowBelow` or the page holds another direction or row count
  const pending = due || (chooses && (picked?.view !== view || picked.among !== among))
  const waits = due || unready || (chooses && !picked)
  // a board that has no room to tell (a small screen it fills) runs as its shape says, in one row
  const chosen = chooses ? picked : null
  const direction: Direction = held ?? chosen?.direction ?? shape
  const rows = fixed ?? (chosen && chosen.direction === direction ? chosen.rows : 1)

  const key = useMemo(
    () => (measure ? structureKey(view, ev, { direction, rows, measure }) : ''),
    [view, ev, direction, rows, measure],
  )
  if (fresh) engine.wantKey = pending ? '' : key
  useEffect(() => {
    if (!measure || !key || waits) return
    let live = true
    layout(view, engine.ev, { direction, rows, measure, elk: elk ?? pageElk() }).then(
      (s) => {
        // the engine takes the scene when the diagram has drawn it, so dots never run ahead of the SVG
        if (live) setLaid({ view, scene: s })
      },
      (err) => console.error('loadmap: layout failed', err),
    )
    return () => {
      live = false
    }
  }, [key, view, engine, direction, rows, measure, elk, waits])

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

  // the player's state is its engine's; a new model stops the story (`setModel`)
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
      // a step says what it shows closed; without it, and outside the story, the page's own
      turn(st?.closed ?? null)
    },
    [model, apply, engine, turn],
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
  const start: FullScreenMode = o.chrome ? (o.chrome === 'least' ? 'focus' : 'panels') : (o.fullScreenMode ?? 'panels')
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
    closed,
    setClosed,
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
