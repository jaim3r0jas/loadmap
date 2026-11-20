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
.lm-canvas[data-short] :is(.lm-canvas-bar, .lm-canvas-console) { flex-wrap: nowrap; padding: 4px 8px; overflow: hidden; }
.lm-canvas[data-width="compact"] :is(.lm-canvas-bar, .lm-canvas-console) { padding: 6px 8px; }
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

/** An element's size in pixels, read before the first paint and on every change; null until it is there. */
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
  /** `Canvas.Bar` and `Canvas.Console`, each at most once. */
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
  const box = useBox(root)
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
  // the diagram comes once the box and its bars are measured: it is arranged once, for the room it keeps
  const measured = !!box && box.w > 0 && box.h > 0 && (!hasBar || !!bar) && (!hasConsole || !!cons)
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
        {all.filter(isBar)}
        {measured && (
          <Diagram
            lm={lm}
            legend={legend}
            onNodeClick={onNodeClick}
            selected={selected}
            canvas={{ ...inset, reserve }}
          />
        )}
        {all.filter((c) => !isBar(c))}
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
