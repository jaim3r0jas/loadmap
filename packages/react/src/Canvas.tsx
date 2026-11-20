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
import type { LoadmapController } from './useLoadmap'

/**
 * Injected with the code that uses it. The box has the height the page gives it (a default one otherwise), and nothing
 * in it changes that height: the diagram fills it, the bar and the console lie over its top and its bottom.
 */
const CANVAS_CSS = `
.lm-canvas { position: relative; box-sizing: border-box; height: clamp(420px, 70dvh, 760px); overflow: hidden; contain: layout; border: 1px solid var(--lm-line); border-radius: var(--lm-radius, 10px); background: var(--lm-surface); }
.lm.lm[data-full] > .lm-canvas { display: block; flex: 1 1 0; height: auto; min-height: 0; }
/* the spacer that centres a page of parts with the least around it would take a gap under the canvas */
.lm.lm[data-full]:has(> .lm-canvas)::after { content: none; }
.lm-canvas > .lm-wrap[data-canvas] { position: absolute; inset: 0; }
.lm-canvas-bar, .lm-canvas-console { position: absolute; left: 0; right: var(--lm-canvas-right, 0px); z-index: 3; box-sizing: border-box; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 8px 12px; background: var(--lm-surface); }
.lm-canvas-bar { top: 0; border-bottom: 1px solid var(--lm-line); }
.lm-canvas-console { bottom: 0; border-top: 1px solid var(--lm-line); }
/* over the bar for a while, across the whole top: as tall as it needs */
.lm-canvas-panel[hidden] { display: none; }
/* never more than the diagram can give: a long step scrolls in its strip */
.lm-canvas-over { position: absolute; z-index: 5; top: 0; left: 0; right: 0; box-sizing: border-box; display: flex; align-items: center; max-height: 45%; overflow: auto; overscroll-behavior: contain; background: var(--lm-surface); border-bottom: 1px solid var(--lm-line); box-shadow: 0 8px 18px -14px rgb(0 0 0 / .45); }
.lm-canvas-over > .lm-story { flex: 1 1 auto; border: 0; border-radius: 0; background: none; }
.lm-canvas-over > .lm-canvas-leave { flex: none; margin-right: 12px; }
/* the bar's own buttons, at its end */
.lm-canvas-tools { display: flex; flex: none; gap: 6px; margin-left: auto; }
.lm-canvas-tools .lm-btn { padding: 4px 9px; }
.lm-canvas-tools .lm-btn[aria-pressed="true"].lm-canvas-chrome { border-color: var(--lm-fg); box-shadow: inset 0 0 0 1px var(--lm-fg); }
.lm-frame .lm-canvas-bar > .lm-legend + .lm-canvas-tools { margin-left: 0; }
/* a slot that holds nothing takes no room */
.lm-canvas-bar:empty, .lm-canvas-console:empty { display: none; }
.lm-canvas[data-width="compact"] :is(.lm-canvas-bar, .lm-canvas-console) { padding: 6px 8px; }
.lm-canvas[data-short] .lm-canvas-bar { padding: 4px 8px; }
/* on a touch screen two fingers zoom a narrow canvas: Fit alone stays, clear of the boxes */
@media (pointer: coarse) { .lm-canvas[data-width="compact"] .lm-zoom .lm-btn:not(:last-child) { display: none; } }
/* a page of its own parts has full-screen rules for a phone (the load on two lines, no legend): not the canvas's */
.lm.lm[data-full] .lm-canvas .lm-load { display: grid; }
.lm.lm[data-full] .lm-canvas .lm-load small { display: block; }
.lm.lm[data-full] .lm-canvas .lm-load > label { position: static; width: auto; height: auto; clip-path: none; }
.lm.lm[data-full] .lm-canvas .lm-load > output { margin-left: 0; }
.lm.lm[data-full] .lm-canvas .lm-headline { flex-basis: auto; }
.lm.lm[data-full] .lm-canvas .lm-legend { display: flex; }

/* the panels: their tabs, and the one that is open. Nothing but the open panel scrolls in a canvas */
.lm-canvas-tabs { position: absolute; z-index: 3; display: flex; box-sizing: border-box; background: var(--lm-surface); }
.lm-canvas-tabs button { flex: none; font: 500 .8rem var(--lm-font); color: var(--lm-muted); background: none; border: 0; padding: 0 12px; cursor: pointer; white-space: nowrap; }
.lm-canvas-tabs button:hover { color: var(--lm-fg); }
.lm-canvas-tabs button[aria-expanded="true"] { color: var(--lm-fg); font-weight: 600; box-shadow: inset 0 -2px 0 var(--lm-fg); }
.lm-canvas-tabs button:focus-visible, .lm-canvas-menu:focus-visible { outline: 2px solid var(--lm-accent); outline-offset: -2px; }
.lm-canvas[data-tabs="row"] .lm-canvas-tabs { left: 0; right: 0; bottom: var(--lm-canvas-bottom); height: 36px; border-top: 1px solid var(--lm-line); overflow-x: auto; scrollbar-width: none; }
.lm-canvas[data-tabs="row"] .lm-canvas-tabs::-webkit-scrollbar { display: none; }
/* the five share a narrow row */
.lm-canvas[data-tabs="row"][data-width="compact"] .lm-canvas-tabs button { flex: 1 1 auto; padding: 0 4px; }
.lm-canvas[data-tabs="rail"] .lm-canvas-tabs { top: 0; right: 0; bottom: 0; width: 44px; flex-direction: column; align-items: stretch; padding-top: 6px; border-left: 1px solid var(--lm-line); overflow: hidden; }
.lm-canvas[data-tabs="rail"] .lm-canvas-tabs button { padding: 12px 0; display: flex; justify-content: center; }
.lm-canvas[data-tabs="rail"] .lm-canvas-tabs button span { writing-mode: vertical-rl; }
.lm-canvas[data-tabs="rail"] .lm-canvas-tabs button[aria-expanded="true"] { box-shadow: inset 2px 0 0 var(--lm-fg); }
.lm-canvas[data-tabs="head"] .lm-canvas-tabs { top: 0; right: 0; width: var(--lm-canvas-right); height: 40px; border-left: 1px solid var(--lm-line); border-bottom: 1px solid var(--lm-line); overflow-x: auto; scrollbar-width: none; }
.lm-canvas[data-tabs="head"] .lm-canvas-tabs::-webkit-scrollbar { display: none; }
.lm-canvas-menu { position: absolute; z-index: 4; top: 5px; right: 8px; width: 116px; font: 500 .8rem var(--lm-font); color: var(--lm-fg); background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 6px; padding: 4px 6px; }
.lm-canvas[data-tabs="menu"] .lm-canvas-bar, .lm-canvas[data-tabs="menu"] .lm-canvas-bar:empty { display: flex; min-height: 40px; padding-right: 132px; }
.lm-canvas-panel { position: absolute; z-index: 4; box-sizing: border-box; display: grid; grid-template-rows: auto minmax(0, 1fr); background: var(--lm-surface); outline: 0; }
.lm-canvas-panel[data-place="side"] { top: var(--lm-canvas-top); bottom: var(--lm-canvas-under); right: var(--lm-canvas-right); width: calc(var(--lm-canvas-reach) - var(--lm-canvas-right)); border-left: 1px solid var(--lm-line); box-shadow: -8px 0 18px -14px rgb(0 0 0 / .45); }
.lm-canvas[data-pinned] .lm-canvas-panel { top: 40px; right: 0; bottom: 0; width: var(--lm-canvas-right); box-shadow: none; }
.lm-canvas[data-pinned] .lm-canvas-panel-head { display: none; }
.lm-canvas-panel[data-place="sheet"] { left: 0; right: 0; bottom: var(--lm-canvas-under); height: var(--lm-canvas-reach); border-top: 1px solid var(--lm-line); border-radius: 10px 10px 0 0; box-shadow: 0 -8px 18px -14px rgb(0 0 0 / .45); }
.lm-canvas-panel-head { display: flex; align-items: center; gap: 6px; padding: 6px 8px 6px 12px; border-bottom: 1px solid var(--lm-line); }
.lm-canvas-panel-head h3 { flex: 1 1 auto; min-width: 0; margin: 0; font-size: .86rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lm-canvas-panel-head .lm-btn { padding: 3px 8px; }
.lm-canvas-panel-body { display: grid; gap: 14px; align-content: start; min-height: 0; padding: 12px; overflow: auto; overscroll-behavior: contain; container-type: inline-size; }
@media (prefers-reduced-motion: no-preference) {
  .lm-canvas-panel[data-place="side"] { animation: lm-canvas-side .16s ease-out; }
  .lm-canvas[data-pinned] .lm-canvas-panel { animation: none; }
  .lm-canvas-panel[data-place="sheet"] { animation: lm-canvas-sheet .16s ease-out; }
}
@keyframes lm-canvas-side { from { transform: translateX(16px); opacity: 0; } }
@keyframes lm-canvas-sheet { from { transform: translateY(16px); opacity: 0; } }

/* the frame: what <Frame> puts in the two slots. Each is one row of a height nothing the reader does changes */
.lm-frame .lm-canvas-bar { flex-wrap: nowrap; overflow: hidden; }
.lm-frame .lm-canvas-bar > h2 { flex: 0 5 auto; min-width: 0; font-size: .95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lm-frame .lm-canvas-bar > .lm-scenarios { flex: 0 2 auto; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; padding: 2px; }
.lm-frame .lm-canvas-bar > .lm-scenarios::-webkit-scrollbar { display: none; }
.lm-frame .lm-canvas-bar > .lm-scenarios > * { flex: none; white-space: nowrap; }
.lm-frame .lm-canvas-bar > .lm-scenarios button { padding: 4px 10px; }
/* named for a screen reader, unseen: the buttons say what they are */
.lm-frame .lm-canvas-bar > .lm-scenarios legend, .lm.lm .lm-frame[data-short] .lm-load > label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
/* one row whatever is on: an entry that does not fit wraps under it, out of view, whole */
.lm-frame .lm-canvas-bar > .lm-legend { flex: 1 1 0; justify-content: flex-end; min-width: 0; height: 1.5em; line-height: 1.5; overflow: hidden; white-space: nowrap; }
.lm-canvas-pick { flex: 0 1 auto; min-width: 0; max-width: 100%; font: 500 .84rem var(--lm-font); color: var(--lm-fg); background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 6px; padding: 5px 8px; }
.lm-frame .lm-canvas-console { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; padding: 6px 12px 8px; }
.lm-frame .lm-canvas-console > .lm-load { grid-template: "label track value" / minmax(0, max-content) minmax(120px, 1fr) auto; align-items: start; }
.lm-frame .lm-canvas-console > .lm-load > label { max-width: 14em; padding-top: 6px; }
.lm-frame .lm-canvas-console > .lm-load > output { padding-top: 5px; }
.lm-canvas-verdict { display: flex; align-items: center; gap: 6px 14px; min-width: 0; padding-left: 8px; border-left: 4px solid var(--lm-ok); }
.lm-canvas-verdict[data-tier="warn"] { border-color: var(--lm-warn); }
.lm-canvas-verdict[data-tier="over"] { border-color: var(--lm-drop); }
.lm-frame[data-width="compact"] .lm-canvas-console { padding: 6px 8px; }
.lm-frame[data-width="compact"] .lm-canvas-console > .lm-load { grid-template: "label value" "track track" / minmax(0, 1fr) auto; align-items: center; }
.lm-frame[data-width="compact"] .lm-canvas-console > .lm-load > :is(label, output) { padding-top: 0; }
/* room for the date under the load, with one or not */
.lm-frame[data-width="compact"] .lm-canvas-console > .lm-load > output { min-height: 2.1rem; }
/* two lines kept whatever the verdict says: the load never changes the console's height */
.lm-frame[data-width="compact"]:not([data-short]) .lm-headline { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; height: 2.6em; line-height: 1.3; white-space: normal; }
.lm-frame[data-short] .lm-canvas-console { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: center; gap: 12px; padding: 2px 8px; }
.lm-frame[data-short] .lm-canvas-console > .lm-load { grid-template: "track value" / minmax(0, 1fr) auto; align-items: start; }
.lm-frame[data-short][data-width="compact"] .lm-canvas-console { grid-template-columns: minmax(0, 1fr); gap: 0; }
`

function injectCanvasStyles(doc: Document): void {
  if (doc.getElementById('loadmap-canvas-css')) return
  const el = doc.createElement('style')
  el.id = 'loadmap-canvas-css'
  el.textContent = CANVAS_CSS
  doc.head.appendChild(el)
}

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
    if (root) injectCanvasStyles(root.ownerDocument)
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
          : (root?.ownerDocument.getElementById(tabId(uid, open ?? '')) ??
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
