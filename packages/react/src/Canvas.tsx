import {
  Children,
  type CSSProperties,
  createContext,
  isValidElement,
  type ReactNode,
  use,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'
import { type CanvasSize, canvasSize, covered, reserved } from './canvasSize'
import { Diagram, type DiagramProps } from './Diagram'
import type { LoadmapController } from './useLoadmap'

/**
 * Injected with the code that uses it. The box has the height the page gives it (a default one otherwise), and nothing
 * in it changes that height: the diagram fills it, the bar and the console lie over its top and its bottom.
 */
const CANVAS_CSS = `
.lm-canvas { position: relative; box-sizing: border-box; height: clamp(420px, 70dvh, 760px); overflow: hidden; contain: layout; border: 1px solid var(--lm-line); border-radius: var(--lm-radius, 10px); background: var(--lm-surface); }
.lm.lm[data-full] > .lm-canvas { display: block; flex: 1 1 0; height: auto; min-height: 0; }
.lm-canvas > .lm-wrap[data-canvas] { position: absolute; inset: 0; }
.lm-canvas-bar, .lm-canvas-console { position: absolute; left: 0; right: var(--lm-canvas-right, 0px); z-index: 3; box-sizing: border-box; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 8px 12px; background: var(--lm-surface); }
.lm-canvas-bar { top: 0; border-bottom: 1px solid var(--lm-line); }
.lm-canvas-console { bottom: 0; border-top: 1px solid var(--lm-line); }
/* a slot that holds nothing takes no room */
.lm-canvas-bar:empty, .lm-canvas-console:empty { display: none; }
.lm-canvas[data-width="compact"] :is(.lm-canvas-bar, .lm-canvas-console) { padding: 6px 8px; }
.lm-canvas[data-short] .lm-canvas-bar { padding: 4px 8px; }
/* on a touch screen two fingers zoom a narrow canvas: Fit alone stays, clear of the boxes */
@media (pointer: coarse) { .lm-canvas[data-width="compact"] .lm-zoom .lm-btn:not(:last-child) { display: none; } }
/* until today's full screen goes: its rules for a phone (the load on two lines, no legend) are not the canvas's */
.lm.lm[data-full] .lm-canvas .lm-load { display: grid; }
.lm.lm[data-full] .lm-canvas .lm-load small { display: block; }
.lm.lm[data-full] .lm-canvas .lm-load > label { position: static; width: auto; height: auto; clip-path: none; }
.lm.lm[data-full] .lm-canvas .lm-load > output { margin-left: 0; }
.lm.lm[data-full] .lm-canvas .lm-headline { flex-basis: auto; }
.lm.lm[data-full] .lm-canvas .lm-legend { display: flex; }

/* the frame: what <Frame> puts in the two slots. Each is one row of a height nothing the reader does changes */
.lm-frame .lm-canvas-bar { flex-wrap: nowrap; overflow: hidden; }
.lm-frame .lm-canvas-bar > h2 { flex: 0 1 auto; min-width: 0; font-size: .95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
 * An element's size in pixels, read before the first paint and on every change; null until it is there. Not `useSize`
 * (scenarios.tsx): the diagram waits for these sizes, so they are read in the commit that mounts the element.
 */
function useBox(el: HTMLElement | null): { w: number; h: number } | null {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    if (!el) {
      setBox(null)
      return
    }
    const read = () => {
      const r = el.getBoundingClientRect()
      setBox((was) => (was && was.w === r.width && was.h === r.height ? was : { w: r.width, h: r.height }))
    }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return box
}

export interface CanvasProps extends Pick<DiagramProps, 'legend' | 'onNodeClick' | 'selected'> {
  lm: LoadmapController
  /** The region's name for a screen reader. Defaults to the model's title. */
  label?: string
  /**
   * How far the open panel reaches over the canvas, in pixels: its width beside the diagram, its height as a sheet.
   * The view moves into what is left; the diagram is not laid out again.
   */
  panel?: number
  className?: string
  /** The box's own style: its height, when the page's CSS does not give it. */
  style?: CSSProperties
  /** `Canvas.Bar` and `Canvas.Console`, each at most once and as direct children: the canvas places them by type. */
  children?: ReactNode
}

/**
 * Everything of a loadmap in one box the page sizes: the diagram fills it as a board the reader pans and zooms, a bar
 * lies over its top and a console over its bottom. The diagram is arranged for what the bars and the size class always
 * leave; what opens over it only moves the view.
 */
export function Canvas({
  lm,
  label,
  panel = 0,
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
  // before the box is measured: its height is the stylesheet's
  useLayoutEffect(() => {
    if (root) injectCanvasStyles(root.ownerDocument)
  }, [root])
  const now = useBox(root)
  // the last size it had while shown: a canvas hidden for a while (a tab) keeps its diagram and the reader's view
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  if (now && now.w > 0 && now.h > 0 && now !== box) setBox(now)
  const bar = useBox(barEl)
  const cons = useBox(consoleEl)
  // the bar first for the keyboard and a screen reader, then the diagram, then the console
  const all = Children.toArray(children)
  const isBar = (c: unknown) => isValidElement(c) && c.type === Bar
  const hasConsole = all.some((c) => isValidElement(c) && c.type === Console)
  const hasBar = all.some(isBar)
  const { width, short, pinned } = canvasSize(box?.w ?? 0, box?.h ?? 0, lm.fullScreen)
  // one object per class: a part that reads it draws again only when the class changes
  const size = useMemo<CanvasSize>(() => ({ width, short, pinned }), [width, short, pinned])
  const ctx = useMemo<Slots>(() => ({ size, bar: setBar, console: setConsole }), [size])
  // the bars come once the box has a size, so they are measured in its size class; the diagram once they are
  // measured: it is arranged once, for the room it keeps
  const measured = !!box && (!hasBar || !!bar) && (!hasConsole || !!cons)
  const bars = { top: Math.ceil(bar?.h ?? 0), bottom: Math.ceil(cons?.h ?? 0) }
  const reserve = reserved(size, bars)
  const inset = covered(size, bars, panel)
  return (
    // biome-ignore lint/a11y/useSemanticElements: a section's name would be a heading the bar may not have
    <div
      className={className ? `lm-canvas ${className}` : 'lm-canvas'}
      role="region"
      aria-label={label ?? lm.model.title ?? 'Capacity model'}
      data-width={size.width}
      data-short={size.short ? '' : undefined}
      data-pinned={size.pinned ? '' : undefined}
      style={{ ...style, '--lm-canvas-right': `${reserve.right}px` } as CSSProperties}
      ref={setRoot}
    >
      <Ctx value={ctx}>
        {box && all.filter(isBar)}
        {measured && (
          <Diagram
            lm={lm}
            legend={legend}
            onNodeClick={onNodeClick}
            selected={selected}
            canvas={{ ...inset, reserve }}
          />
        )}
        {box && all.filter((c) => !isBar(c))}
      </Ctx>
    </div>
  )
}

/** Over the canvas's top: what the reader chooses from (the scenarios, the story, the tools). */
function Bar({ children }: { children?: ReactNode }) {
  return (
    <div className="lm-canvas-bar" ref={slots('<Canvas.Bar>').bar}>
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

Canvas.Bar = Bar
Canvas.Console = Console
