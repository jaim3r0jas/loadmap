import type { Values } from '@loadmap/core'
import { multiple } from '@loadmap/core/format'
import type { Definition } from '@loadmap/dsl'
import { pageOptions } from '@loadmap/dsl/internal'
import {
  Assumptions,
  Compare,
  Controls,
  Diagram,
  HeadroomChart,
  handleOf,
  Limits,
  LoadBar,
  type LoadmapHandle,
  LoadmapRoot,
  Meters,
  Scenarios,
  Story,
  useLoadmap,
  Verdict,
} from '@loadmap/react'
import {
  lazy,
  type ReactNode,
  type Ref,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

// the phone's sheet comes with the first phone: a wide editor never loads it
const Sheet = lazy(() => import('./Sheet').then((m) => ({ default: m.Sheet })))

/** The side panel: pinned beside the canvas, or a rail it opens from over the canvas. */
export type PanelMode = 'pinned' | 'auto'

/** Pixels the side panel takes, pinned; its rail; and the least room the canvas keeps beside it to pin it. */
export const PANEL = { width: 340, rail: 44, pinFrom: 1024 } as const
/** The panel opens this long after the pointer comes onto its rail, and closes this long after it leaves. */
const HOVER = { open: 150, close: 400 } as const

export interface EditorCanvasProps {
  def: Definition
  look: 'auto' | 'light' | 'dark'
  initial: Partial<Values<any>>
  onNodeClick: (id: string) => void
  selected: string | null
  /** Pixels on the left the code floats over. */
  left: number
  /** A phone: the panels in a sheet over the canvas's bottom, rather than beside it. */
  phone?: boolean
  panel: PanelMode
  onPanel: (mode: PanelMode) => void
  /** The editor is wide enough to pin the panel. */
  canPin: boolean
  /** Shown first in the panel: the inspector, while the code is hidden. */
  inspector?: ReactNode
  /** What floats over the canvas's top left: that the diagram is the last version without errors. */
  note?: ReactNode
  ref?: Ref<LoadmapHandle>
}

/**
 * The editor's diagram as a canvas filling its box: the board the reader pans and zooms, the scenarios over its top and
 * the story over its bottom, and the side panel with the verdict and the rest. The code floats over its left.
 */
export function EditorCanvas({
  def,
  look,
  initial,
  onNodeClick,
  selected,
  left,
  phone = false,
  panel,
  onPanel,
  canPin,
  inspector,
  note,
  ref,
}: EditorCanvasProps) {
  const page = pageOptions(def.options)
  const lm = useLoadmap(def.model, def.view, { ...page, initial, zoom: true })
  useImperativeHandle(ref, () => handleOf(lm), [lm])
  const { model } = lm
  const pinned = panel === 'pinned'
  const [open, setOpen] = useState(false)
  // a box clicked while the code is hidden shows its fields in the panel: once for each box, so a panel the reader
  // closes stays closed
  const inspecting = !!inspector
  useEffect(() => {
    if (inspecting && selected) setOpen(true)
  }, [inspecting, selected])
  // on a phone: the sheet's height (it reports it once it settles), and the box it rests in
  const [sheet, setSheet] = useState(PEEK)
  const onSheet = useCallback((h: number) => setSheet(h), [])
  const stage = useHeight(lm.root, phone)
  const right = phone ? 0 : pinned ? PANEL.width : PANEL.rail
  // the scenarios and the load over the top, as tall as the room they get; on a phone the scenarios beside the zoom,
  // the load in the sheet's peek
  const [over, setOver] = useState<HTMLDivElement | null>(null)
  const bar = useHeight(over, !phone)
  const top = phone ? 68 : bar ? bar + 20 : 12
  // the legend and the zoom along the bottom, and the story above them; on a phone the sheet, and the story above it
  const bottom = phone ? sheet + (model.story.length ? 64 : 8) : model.story.length ? 140 : 56
  const free = {
    '--lme-l': `${left}px`,
    '--lme-r': `${right}px`,
    '--lme-t': `${top}px`,
    ...(phone ? { '--lme-sheet': `${sheet}px` } : {}),
  } as React.CSSProperties
  return (
    <LoadmapRoot lm={lm} theme={look}>
      <div className="lme-canvas" style={free}>
        <Diagram lm={lm} canvas={{ left, right, top, bottom }} onNodeClick={onNodeClick} selected={selected} />
        {note && <div className="lme-over lme-over-note">{note}</div>}
        {phone ? (
          model.scenarios.length > 0 && (
            <div className="lme-over lme-over-top">
              <Scenarios lm={lm} />
            </div>
          )
        ) : (
          <div className="lme-over lme-over-top" ref={setOver}>
            <LoadBar lm={lm} />
          </div>
        )}
        {model.story.length > 0 && (
          <div className="lme-over lme-over-bottom">
            <Story lm={lm} />
          </div>
        )}
      </div>
      {phone ? (
        <Suspense fallback={null}>
          <Sheet
            lm={lm}
            stage={stage}
            peek={PEEK}
            inspector={inspector}
            selected={selected}
            onHeight={onSheet}
            assumptions={page.assumptions}
          />
        </Suspense>
      ) : (
        <SidePanel
          lm={lm}
          pinned={pinned}
          canPin={canPin}
          open={open}
          setOpen={setOpen}
          onPanel={onPanel}
          title={model.title}
        >
          {inspector}
          <Section title="Verdict">
            <Verdict lm={lm} />
          </Section>
          <Section title="Design">
            <Controls lm={lm} load={false} />
          </Section>
          <Section title="Where it runs out">
            <Limits lm={lm} />
          </Section>
          <Section title="Headroom">
            <HeadroomChart lm={lm} />
          </Section>
          {model.scenarios.length > 1 && (
            <Section title="Scenarios compared" closed>
              <Compare lm={lm} />
            </Section>
          )}
          <Section title="Live" closed>
            <Meters lm={lm} />
          </Section>
          <Section title="Assumptions" closed>
            <Assumptions lm={lm} extra={page.assumptions} />
          </Section>
        </SidePanel>
      )}
    </LoadmapRoot>
  )
}

/** The phone's sheet at peek, in pixels: the verdict in two lines and the load slider with its marks. */
const PEEK = 176

/** An element's height as it changes, while `on`. */
function useHeight(el: HTMLElement | null, on: boolean): number {
  const [h, setH] = useState(0)
  useEffect(() => {
    if (!on || !el) return
    setH(el.clientHeight)
    const ro = new ResizeObserver(() => setH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el, on])
  return h
}

/** A part of the panel that folds; its own heading gives way to the section's. */
function Section({ title, closed = false, children }: { title: string; closed?: boolean; children: ReactNode }) {
  return (
    <details className="lme-sec" open={!closed}>
      <summary>{title}</summary>
      {children}
    </details>
  )
}

/**
 * Pinned, the panel takes its room beside the canvas. On auto it waits on a rail: a hover that stays, a click or a tap
 * opens it over the canvas, and it closes once the pointer has left it for a moment (unless the keyboard is in it), on
 * Escape, or on a press on the canvas. From the keyboard the focus goes into it and comes back to the rail; a hover
 * never moves the focus.
 */
function SidePanel({
  lm,
  pinned,
  canPin,
  open,
  setOpen,
  onPanel,
  title,
  children,
}: {
  lm: ReturnType<typeof useLoadmap>
  pinned: boolean
  canPin: boolean
  open: boolean
  setOpen: (open: boolean) => void
  onPanel: (mode: PanelMode) => void
  title?: string
  children: ReactNode
}) {
  const self = useRef<HTMLElement>(null)
  const rail = useRef<HTMLButtonElement>(null)
  const timer = useRef(0)
  // opened by a hover: a click that comes after it keeps it open rather than closing it again
  const hovered = useRef(false)
  // unpinned, the rail comes in under the pointer that pressed Unpin: it opens on a hover once the pointer has left it
  const quiet = useRef(false)
  const shown = pinned || open
  const later = (f: () => void, ms: number) => {
    clearTimeout(timer.current)
    timer.current = window.setTimeout(f, ms)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  // Escape, or a press anywhere outside the panel and its rail, closes it
  useEffect(() => {
    if (pinned || !open) return
    // Escape is the panel's while the keyboard is in it, on its rail, or nowhere in particular; not the text's
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const at = document.activeElement
      const inside = !!at && !!self.current?.contains(at)
      if (!inside && at !== rail.current && at !== document.body) return
      setOpen(false)
      if (inside) rail.current?.focus()
    }
    const press = (e: PointerEvent) => {
      const t = e.target as Node
      if (!self.current?.contains(t) && !rail.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('keydown', key)
    document.addEventListener('pointerdown', press, true)
    return () => {
      document.removeEventListener('keydown', key)
      document.removeEventListener('pointerdown', press, true)
    }
  }, [pinned, open, setOpen])
  const leave = (e: React.PointerEvent) => {
    if (pinned || e.pointerType !== 'mouse') return
    hovered.current = false
    later(() => {
      if (!self.current?.contains(document.activeElement)) setOpen(false)
    }, HOVER.close)
  }
  const stay = (e: React.PointerEvent) => e.pointerType === 'mouse' && clearTimeout(timer.current)
  const tier = lm.ev.verdict.tier
  const first = lm.ev.firstLimit
  return (
    <>
      {!pinned && (
        <button
          type="button"
          ref={rail}
          className="lme-rail"
          data-tier={tier}
          aria-expanded={open}
          aria-controls="lme-panel"
          aria-label={open ? 'Close the panel' : 'Open the panel'}
          onPointerEnter={(e) => {
            if (e.pointerType !== 'mouse' || quiet.current) return
            // back on the rail: a close on its way waits
            if (open) clearTimeout(timer.current)
            else
              later(() => {
                hovered.current = true
                setOpen(true)
              }, HOVER.open)
          }}
          onPointerLeave={(e) => {
            quiet.current = false
            leave(e)
          }}
          onClick={(e) => {
            clearTimeout(timer.current)
            const opening = !open || hovered.current
            hovered.current = false
            setOpen(opening)
            // from the keyboard the focus goes in; a click leaves it on the rail
            if (opening && e.detail === 0) requestAnimationFrame(() => self.current?.focus())
          }}
        >
          <i aria-hidden="true" />
          <span>{first?.target != null ? `${multiple(first.target, lm.model.searchMax)} · Panel` : 'Panel'}</span>
        </button>
      )}
      <aside
        id="lme-panel"
        className="lme-panel"
        ref={self}
        tabIndex={-1}
        aria-label="Panel"
        data-mode={pinned ? 'pinned' : 'auto'}
        hidden={!shown}
        onPointerEnter={stay}
        onPointerLeave={leave}
      >
        <div className="lme-panel-head">
          <h2>{title}</h2>
          {canPin && (
            <button
              type="button"
              className="lm-btn"
              aria-pressed={pinned}
              title={pinned ? 'Pinned: let it fold onto its rail' : 'Pin it beside the canvas'}
              onClick={() => {
                onPanel(pinned ? 'auto' : 'pinned')
                setOpen(false)
                quiet.current = pinned
                // unpinned, the panel folds away with the button: the keyboard goes to its rail
                if (pinned) requestAnimationFrame(() => rail.current?.focus())
              }}
            >
              {pinned ? 'Unpin' : 'Pin'}
            </button>
          )}
        </div>
        <div className="lme-panel-body">{children}</div>
      </aside>
    </>
  )
}
