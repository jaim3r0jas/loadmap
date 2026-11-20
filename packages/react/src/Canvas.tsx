import {
  Children,
  type CSSProperties,
  createContext,
  isValidElement,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  use,
  useCallback,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { CANVAS, type CanvasSize, canvasSize, covered, placement, reach, reserved, tabsAt } from './canvasSize'
import { Diagram, type DiagramProps } from './Diagram'
import { injectStyles } from './styles'
import type { LoadmapController } from './useLoadmap'

interface Slots {
  size: CanvasSize
  bar: (el: HTMLElement | null) => void
  console: (el: HTMLElement | null) => void
  /** The ids of the canvas's panels, in their order. */
  panels: readonly string[]
  /** The panel that is open, by its id. */
  open: string | null
  /** Opens a panel, or closes the open one (null). `from` gets the keyboard back when it closes. */
  show: (id: string | null, from?: HTMLElement | null) => void
  /** Something lies over the bar for a while (`over`): the bar is out of reach under it. */
  under: boolean
}

const Ctx = createContext<Slots | null>(null)

function slots(what: string): Slots {
  const c = use(Ctx)
  if (!c) throw new Error(`loadmap: ${what} belongs inside <Canvas>`)
  return c
}

/** The size class of the canvas this is drawn in: a part folds by it, never by the window. */
export function useCanvasSize(): CanvasSize {
  return slots('useCanvasSize()').size
}

/**
 * The panels of the canvas this is drawn in: their ids, the one that is open, `show` to open or close one, and
 * whether they are away for a while (`under`: something lies over the bar).
 */
export function useCanvasPanels(): Pick<Slots, 'panels' | 'open' | 'show' | 'under'> {
  const { panels, open, show, under } = slots('useCanvasPanels()')
  return { panels, open, show, under }
}

/**
 * An element's size in pixels, read before the first paint and on every change; null until it is there. Not `useSize`
 * (scenarios.tsx): the diagram waits for these sizes, so they are read in the commit that mounts the element.
 */
function useBox(el: HTMLElement | null, inner = false): { w: number; h: number } | null {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    if (!el) {
      setBox(null)
      return
    }
    const read = () => {
      // inside its border (`inner`): what is placed in it is placed from there
      const r = inner ? { width: el.clientWidth, height: el.clientHeight } : el.getBoundingClientRect()
      setBox((was) => (was && was.w === r.width && was.h === r.height ? was : { w: r.width, h: r.height }))
    }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el, inner])
  return box
}

export interface CanvasProps extends Pick<DiagramProps, 'legend' | 'onNodeClick' | 'selected'> {
  lm: LoadmapController
  /** The region's name for a screen reader. Defaults to the model's title. */
  label?: string
  /** The panel that is open, by its id; null for none. Leave it out and the canvas keeps it itself. */
  open?: string | null
  /** The panel open at first, when the canvas keeps it itself. */
  defaultOpen?: string | null
  /** A panel opened or closed (null). */
  onOpen?: (id: string | null) => void
  /**
   * What takes the canvas's top for a while (a story's text): it lies over the bar, as tall as it needs, the view
   * moves under it, and the tabs and the open panel are away until it goes. The diagram is not laid out again.
   */
  over?: ReactNode
  /**
   * The page around the canvas scrolls: the plain wheel and one finger are the page's, and Ctrl or ⌘ with the wheel,
   * or two fingers, the diagram's. Default: true in a page, false in a root that fills its container. Never in full
   * screen, which has no page under it.
   */
  scrolls?: boolean
  /** The canvas's own element. */
  ref?: Ref<HTMLDivElement>
  className?: string
  /** The box's own style: its height, when the page's CSS does not give it. */
  style?: CSSProperties
  /**
   * `Canvas.Bar` and `Canvas.Console`, each at most once, and a `Canvas.Panel` for each panel: as direct children,
   * since the canvas places them by type.
   */
  children?: ReactNode
}

interface PanelProps {
  /** Its name among the canvas's panels. */
  id: string
  /** What its tab says. */
  title: string
  /** Drawn only while the panel is open. */
  children?: ReactNode
}

/**
 * Everything of a loadmap in one box the page sizes: the diagram fills it as a board the reader pans and zooms, a bar
 * lies over its top and a console over its bottom, and one panel at a time opens from its tabs. The diagram is arranged
 * for what the bars and the size class always leave; a panel that opens only moves the view.
 */
export function Canvas({
  lm,
  label,
  open: given,
  defaultOpen = null,
  onOpen,
  over,
  scrolls,
  ref,
  className,
  style,
  children,
  legend,
  onNodeClick,
  selected,
}: CanvasProps) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [barEl, setBar] = useState<HTMLElement | null>(null)
  const [consoleEl, setConsole] = useState<HTMLElement | null>(null)
  const [overEl, setOver] = useState<HTMLElement | null>(null)
  useImperativeHandle(ref, () => root as HTMLDivElement, [root])
  // before the box is measured: its height is the stylesheet's
  useLayoutEffect(() => {
    if (root) injectStyles(root.ownerDocument)
  }, [root])
  const now = useBox(root, true)
  // the last size it had while shown: a canvas hidden for a while (a tab) keeps its diagram and the reader's view
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  if (now && now.w > 0 && now.h > 0 && now !== box) setBox(now)
  const bar = useBox(barEl)
  const cons = useBox(consoleEl)
  const lid = useBox(overEl)
  const under = over != null && over !== false
  // the bar first for the keyboard and a screen reader, then the diagram, the console, the tabs and the panel
  const all = Children.toArray(children)
  const of = (type: unknown) => (c: unknown) => isValidElement(c) && c.type === type
  const bars = all.filter(of(Bar))
  const consoles = all.filter(of(Console))
  const panels = all.filter(of(Panel)) as ReactElement<PanelProps>[]
  // anything else of the page's own lies over the canvas, after the console
  const rest = all.filter((c) => ![Bar, Console, Panel].some((t) => of(t)(c)))
  const uid = useId()
  const ids = panels.map((p) => p.props.id)
  const idsKey = ids.join('\n')
  const { width, short, pinned } = canvasSize(box?.w ?? 0, box?.h ?? 0, lm.fullScreen)
  // one object per class: a part that reads it draws again only when the class changes
  const size = useMemo<CanvasSize>(() => ({ width, short, pinned }), [width, short, pinned])

  const [own, setOwn] = useState<string | null>(defaultOpen)
  const asked = given === undefined ? own : given
  // a pinned panel is always there: the first one, until the reader picks another
  const open = asked != null && ids.includes(asked) ? asked : size.pinned ? (ids[0] ?? null) : null
  const [whole, setWhole] = useState(false)
  // a sheet opens half again, however the last one closed
  if (!open && whole) setWhole(false)
  const back = useRef<HTMLElement | null>(null)
  const at = useRef({ root, open, uid })
  at.current = { root, open, uid }
  const change = useRef(onOpen)
  change.current = onOpen
  const show = useCallback((id: string | null, from?: HTMLElement | null) => {
    if (id) back.current = from ?? null
    else {
      // closed from inside the panel, the keyboard goes back to what opened it, or else to its tab (the menu on a
      // low canvas); closed from a control of its own (`from`: its tab), it stays there
      const { root, open, uid } = at.current
      const opener = back.current
      back.current = null
      if (!from) {
        const to = opener?.isConnected
          ? opener
          : ((root?.getRootNode() as Document | ShadowRoot | undefined)?.getElementById(tabId(uid, open ?? '')) ??
            root?.querySelector<HTMLElement>('.lm-canvas-menu'))
        to?.focus()
      }
    }
    setOwn(id)
    change.current?.(id)
  }, [])
  const ctx = useMemo<Slots>(
    () => ({ size, bar: setBar, console: setConsole, panels: idsKey ? idsKey.split('\n') : [], open, show, under }),
    [size, idsKey, open, show, under],
  )

  // the bars come once the box has a size, so they are measured in its size class; the diagram once they are
  // measured: it is arranged once, for the room it keeps
  const measured = !!box && (!bars.length || !!bar) && (!consoles.length || !!cons)
  // a canvas hidden from the start (a tab, a phone's other view) has no size to wait for: its diagram is drawn by its
  // shape, so what drives it from outside (a page's handle) finds it, and takes the canvas's room when it shows. Once
  // drawn it stays
  const unseen = !box && !!now
  const [started, setStarted] = useState(false)
  if (!started && (measured || unseen)) setStarted(true)
  const has = ids.length > 0
  const tabs = has ? tabsAt(size) : null
  // the menu of a low canvas lies in the bar's row: without a bar, or with an empty one, that row is still kept
  const heights = {
    top: Math.max(Math.ceil(bar?.h ?? 0), tabs === 'menu' ? CANVAS.menu : 0),
    bottom: Math.ceil(cons?.h ?? 0),
  }
  const reserve = reserved(size, heights, has)
  const far = has && open && box && !under ? reach(size, heights, box.w, box.h, whole) : 0
  const base = covered(size, heights, far, has)
  // what lies over the bar covers more of the top: the view moves, the room stays
  const inset = under ? { ...base, top: Math.max(base.top, Math.ceil(lid?.h ?? 0)) } : base
  const place = placement(size)
  const shown = panels.find((p) => p.props.id === open)
  const vars = {
    ...style,
    '--lm-canvas-right': `${reserve.right}px`,
    '--lm-canvas-top': `${heights.top}px`,
    '--lm-canvas-bottom': `${heights.bottom}px`,
    '--lm-canvas-under': `${reserve.bottom}px`,
    '--lm-canvas-reach': `${far}px`,
  } as CSSProperties
  return (
    // biome-ignore lint/a11y/useSemanticElements: a section's name would be a heading the bar may not have
    <div
      className={className ? `lm-canvas ${className}` : 'lm-canvas'}
      role="region"
      aria-label={label ?? lm.model.title ?? 'Capacity model'}
      data-width={size.width}
      data-short={size.short ? '' : undefined}
      data-pinned={size.pinned ? '' : undefined}
      data-tabs={tabs ?? undefined}
      data-over={under ? '' : undefined}
      style={vars}
      ref={setRoot}
    >
      <Ctx value={ctx}>
        {box && bars}
        {box && under && (
          <div className="lm-canvas-over" ref={setOver}>
            {over}
          </div>
        )}
        {started && (
          <Diagram
            lm={lm}
            legend={legend}
            onNodeClick={onNodeClick}
            selected={selected}
            canvas={{ ...inset, reserve, scrolls: lm.fullScreen && !lm.fill ? false : (scrolls ?? !lm.fill) }}
          />
        )}
        {box && consoles}
        {box && rest}
        {box && tabs && !under && (
          <Tabs uid={uid} panels={panels} open={open} show={show} at={tabs} canClose={!size.pinned} />
        )}
        {box && shown && (
          <PanelBox
            uid={uid}
            // kept while something lies over the bar, unseen: it comes back as the reader left it
            away={under}
            panel={shown}
            place={place}
            pinned={size.pinned}
            whole={whole}
            setWhole={setWhole}
            close={() => show(null)}
          />
        )}
      </Ctx>
    </div>
  )
}

// with the canvas's own id: two canvases on a page never share one
const tabId = (uid: string, id: string) => `${uid}tab-${id}`
const panelId = (uid: string) => `${uid}panel`

/**
 * The panels' tabs: a button each, which opens its panel and closes it again (a pinned panel stays). The arrows move
 * between them. A low canvas has one menu in their place.
 */
function Tabs({
  uid,
  panels,
  open,
  show,
  at,
  canClose,
}: {
  uid: string
  panels: readonly ReactElement<PanelProps>[]
  open: string | null
  show: Slots['show']
  at: 'head' | 'rail' | 'row' | 'menu'
  canClose: boolean
}) {
  if (at === 'menu')
    return (
      <select
        className="lm-canvas-menu"
        aria-label="Open a panel"
        value={open ?? ''}
        onChange={(e) => show(e.target.value || null, e.currentTarget)}
      >
        <option value="">Panels</option>
        {panels.map((p) => (
          <option key={p.props.id} value={p.props.id}>
            {p.props.title}
          </option>
        ))}
      </select>
    )
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && open && canClose) {
      // the panel's alone: a full screen over it stays
      e.stopPropagation()
      return show(null, e.target as HTMLElement)
    }
    const by = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    if (!by) return
    const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
    const i = all.indexOf(e.target as HTMLButtonElement)
    if (i < 0) return
    e.preventDefault()
    all[(i + by + all.length) % all.length]?.focus()
  }
  return (
    <div
      className="lm-canvas-tabs"
      role="toolbar"
      aria-label="Panels"
      aria-orientation={at === 'rail' ? 'vertical' : 'horizontal'}
      onKeyDown={move}
    >
      {panels.map((p) => {
        const on = p.props.id === open
        return (
          <button
            type="button"
            key={p.props.id}
            id={tabId(uid, p.props.id)}
            aria-expanded={on}
            aria-controls={on ? panelId(uid) : undefined}
            onClick={(e) => (on ? canClose && show(null, e.currentTarget) : show(p.props.id, e.currentTarget))}
          >
            <span>{p.props.title}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * The open panel: beside the diagram, or a sheet on the console that stands half or whole. Escape closes it and gives
 * the keyboard back to its tab; nothing but the panel scrolls in a canvas.
 */
function PanelBox({
  uid,
  away,
  panel,
  place,
  pinned,
  whole,
  setWhole,
  close,
}: {
  uid: string
  away: boolean
  panel: ReactElement<PanelProps>
  place: 'side' | 'sheet'
  pinned: boolean
  whole: boolean
  setWhole: (whole: boolean) => void
  close: () => void
}) {
  const { id, title, children } = panel.props
  return (
    <section
      id={panelId(uid)}
      hidden={away}
      className="lm-canvas-panel"
      data-place={place}
      data-panel={id}
      aria-labelledby={`${panelId(uid)}-title`}
      tabIndex={-1}
      onKeyDown={(e) => {
        // not an Escape something in the panel took for itself (a chart's reading, a list of choices)
        if (e.key !== 'Escape' || pinned || e.defaultPrevented) return
        if ((e.target as HTMLElement).closest('select, input, textarea')) return
        e.stopPropagation()
        close()
      }}
    >
      <div className="lm-canvas-panel-head">
        <h3 id={`${panelId(uid)}-title`}>{title}</h3>
        {place === 'sheet' && (
          <button type="button" className="lm-btn" aria-pressed={whole} onClick={() => setWhole(!whole)}>
            {whole ? 'Half' : 'Whole'}
          </button>
        )}
        {!pinned && (
          <button type="button" className="lm-btn" aria-label={`Close ${title}`} onClick={close}>
            ✕
          </button>
        )}
      </div>
      <div className="lm-canvas-panel-body">{children}</div>
    </section>
  )
}

/** Over the canvas's top: what the reader chooses from (the scenarios, the story, the tools). */
function Bar({ children }: { children?: ReactNode }) {
  const s = slots('<Canvas.Bar>')
  return (
    <div className="lm-canvas-bar" ref={s.bar} inert={s.under}>
      {children}
    </div>
  )
}

/** Over the canvas's bottom: the load and the answer, always in view. */
function Console({ children }: { children?: ReactNode }) {
  return (
    <div className="lm-canvas-console" ref={slots('<Canvas.Console>').console}>
      {children}
    </div>
  )
}

/** One of the canvas's panels: a tab that opens it, one at a time. The canvas draws it; by itself it draws nothing. */
function Panel(_: PanelProps) {
  return null
}

Canvas.Bar = Bar
Canvas.Console = Console
Canvas.Panel = Panel
