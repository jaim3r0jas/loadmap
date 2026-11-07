import {
  Assumptions,
  Compare,
  Controls,
  HeadroomChart,
  Limits,
  type LoadmapController,
  LoadRange,
  Meters,
  Verdict,
} from '@loadmap/react'
import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react'

/** Where the sheet rests: the verdict and the load in thumb reach, half the screen, or nearly all of it. */
export type Detent = 'peek' | 'half' | 'full'
const DETENTS: readonly Detent[] = ['peek', 'half', 'full']

/** What full leaves above the sheet, in pixels. */
const FULL_GAP = 48
/** A flick this fast (pixels a millisecond) goes on to the next detent, whatever the distance. */
const FLICK = 0.5

type Tab = 'box' | 'verdict' | 'controls' | 'limits' | 'headroom' | 'more'

/** Each detent's height on a stage this tall, with a peek this tall. */
export function heights(stage: number, peek: number): Record<Detent, number> {
  const full = Math.max(peek, stage - FULL_GAP)
  return { peek: Math.min(peek, full), half: Math.min(full, Math.max(peek, Math.round(stage / 2))), full }
}

/** The detent a release lands on: the nearest one, or the next one the flick heads for. */
export function snap(h: number, velocity: number, hs: Record<Detent, number>): Detent {
  if (Math.abs(velocity) >= FLICK) {
    const up = velocity > 0
    const by = DETENTS.filter((d) => (up ? hs[d] > h : hs[d] < h))
    if (by.length) return up ? by[0]! : by[by.length - 1]!
  }
  return DETENTS.reduce((a, b) => (Math.abs(hs[b] - h) < Math.abs(hs[a] - h) ? b : a))
}

/**
 * The phone's panels: a sheet over the bottom of the canvas. At peek it shows the verdict and the load slider; dragged
 * or tapped up, tabs (the inspector first, when the code is hidden), one panel at a time. The handle drags it, a tap
 * moves it between peek and half, the arrow keys step it; at peek and half the canvas above it stays live.
 */
export function Sheet({
  lm,
  stage,
  peek,
  inspector,
  selected,
  onHeight,
  assumptions,
}: {
  lm: LoadmapController
  /** The height of the box it rests in, and of its peek. */
  stage: number
  peek: number
  inspector?: ReactNode
  /** The box selected: with the inspector, its fields come up. */
  selected?: string | null
  /** Its height now: the canvas fits the diagram above it. */
  onHeight: (h: number) => void
  /** The definition's own assumptions, before the generated ones. */
  assumptions?: readonly ReactNode[]
}) {
  const [detent, setDetent] = useState<Detent>('peek')
  const [drag, setDrag] = useState<number | null>(null)
  const hs = heights(stage, peek)
  const height = drag ?? hs[detent]
  const [tab, setTab] = useState<Tab>(inspector ? 'box' : 'verdict')
  // a box tapped while the code is hidden: its fields, half up, each time; the code back, the verdict
  const inspecting = !!inspector
  useEffect(() => {
    if (inspecting && selected) {
      setTab('box')
      setDetent((d) => (d === 'peek' ? 'half' : d))
    } else if (!inspecting) setTab((t) => (t === 'box' ? 'verdict' : t))
  }, [inspecting, selected])
  const settled = drag == null ? hs[detent] : null
  useEffect(() => {
    if (settled != null) onHeight(settled)
  }, [settled, onHeight])

  // the drag as it goes, read on release: a move's render may not have happened yet
  const start = useRef<{ y: number; h: number; t: number; moved: boolean; now: number } | null>(null)
  const last = useRef({ y: 0, t: 0, v: 0 })
  // the click a drag ends with is no tap
  const dragged = useRef(false)
  const down = (e: PointerEvent<HTMLButtonElement>) => {
    // the drag keeps its finger off the handle; a pointer the browser no longer knows is let go
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
    start.current = { y: e.clientY, h: height, t: e.timeStamp, moved: false, now: height }
    last.current = { y: e.clientY, t: e.timeStamp, v: 0 }
  }
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const s = start.current
    if (!s) return
    if (!s.moved && Math.abs(e.clientY - s.y) < 6) return
    s.moved = true
    const dt = e.timeStamp - last.current.t
    // upwards is positive: the sheet grows
    if (dt > 0) last.current = { y: e.clientY, t: e.timeStamp, v: (last.current.y - e.clientY) / dt }
    s.now = Math.max(hs.peek, Math.min(hs.full, s.h + s.y - e.clientY))
    setDrag(s.now)
  }
  const up = (e: PointerEvent<HTMLButtonElement>) => {
    const s = start.current
    start.current = null
    if (!s) return
    // a tap is the click that follows, as Enter, Space or a screen reader's activation are
    if (!s.moved) return
    dragged.current = true
    const fresh = e.timeStamp - last.current.t < 100 ? last.current.v : 0
    setDetent(snap(s.now, fresh, hs))
    setDrag(null)
  }
  /** A cancelled pointer (an edge swipe, a palm) is no tap: a drag under way goes back where it was. */
  const cancel = () => {
    start.current = null
    setDrag(null)
  }
  /** A tap: between peek and half, and from full back to half. */
  const tap = () => {
    if (dragged.current) {
      dragged.current = false
      return
    }
    setDetent(detent === 'peek' ? 'half' : detent === 'half' ? 'peek' : 'half')
  }
  const key = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = DETENTS.indexOf(detent)
    const to = e.key === 'ArrowUp' ? i + 1 : e.key === 'ArrowDown' ? i - 1 : null
    if (to == null || to < 0 || to >= DETENTS.length) return
    e.preventDefault()
    setDetent(DETENTS[to]!)
  }

  const scenarios = lm.model.scenarios.length > 1
  const tabs: [Tab, string][] = [
    ...(inspector ? ([['box', 'Box']] as [Tab, string][]) : []),
    ['verdict', 'Verdict'],
    ['controls', 'Controls'],
    ['limits', 'Limits'],
    ['headroom', 'Headroom'],
    ['more', 'More'],
  ]
  return (
    <section className="lme-sheet" aria-label="Panels" data-detent={drag == null ? detent : 'drag'} style={{ height }}>
      <button
        type="button"
        className="lme-grab"
        aria-label={detent === 'peek' ? 'Show the panels' : 'Lower the panels'}
        aria-expanded={detent !== 'peek'}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onClick={tap}
        onKeyDown={key}
      >
        <i aria-hidden="true" />
      </button>
      {detent === 'peek' && drag == null ? (
        <div className="lme-peek">
          <p className="lme-peek-verdict" data-tier={lm.ev.verdict.tier}>
            {lm.ev.verdict.text}
          </p>
          <LoadRange lm={lm} />
        </div>
      ) : (
        <>
          <div className="lme-sheet-tabs" role="tablist" aria-label="Panel">
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                aria-controls="lme-sheet-body"
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="lme-sheet-body" id="lme-sheet-body" role="tabpanel">
            {tab === 'box' && inspector}
            {tab === 'verdict' && <Verdict lm={lm} />}
            {tab === 'controls' && <Controls lm={lm} />}
            {tab === 'limits' && <Limits lm={lm} />}
            {tab === 'headroom' && <HeadroomChart lm={lm} />}
            {tab === 'more' && (
              <>
                {scenarios && <Compare lm={lm} />}
                <Meters lm={lm} />
                <Assumptions lm={lm} extra={assumptions} />
              </>
            )}
          </div>
        </>
      )}
    </section>
  )
}
