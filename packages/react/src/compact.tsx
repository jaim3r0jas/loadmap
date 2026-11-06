import type { Series } from '@loadmap/core'
import { fmt, multiple, multiples, pct } from '@loadmap/core/format'
import { type RefObject, useEffect, useRef, useState } from 'react'
import type { LoadmapPanel } from './Loadmap'
import { Controls, Meters, plusMinus } from './panels'
import { Compare, scenarioColor, useHeadroom, useSize, whenRange } from './scenarios'
import type { LoadmapController } from './useLoadmap'

/** Opens a panel whole, over the diagram; `from` gets the keyboard back when it closes. */
export type OpenPanel = (panel: LoadmapPanel, from: HTMLElement) => void

/** The names a reader sees for the panels, on the tabs and the buttons that open them. */
const NAMES: Record<LoadmapPanel, string> = {
  verdict: 'Verdict',
  live: 'Live',
  limits: 'Limits',
  controls: 'Load',
  headroom: 'Headroom',
  compare: 'Compare',
  assumptions: 'Assumptions',
}

/**
 * The verdict in one line, from the same evaluation as the sentence: the load, how far the target holds, the first
 * limit and how sure its capacity is, what is past capacity. The sentence is its tooltip and opens under "Why".
 */
export function VerdictLine({
  lm,
  verdict = true,
  extra = 0,
  open,
  assumptions,
}: {
  lm: LoadmapController
  verdict?: boolean
  /** The page's own assumption lines, counted with the model's. */
  extra?: number
  open?: OpenPanel
  /** Shows the count of assumptions that opens them. */
  assumptions?: boolean
}) {
  const { ev, model, values } = lm
  const first = ev.firstLimit
  const range = ev.target
  const target = `${pct(model.thresholds.target)} target`
  const c = first?.capacity
  const sure = !c ? '' : c.provenance === 'estimated' ? `est${c.within ? ` ${plusMinus(c)}` : ''}` : plusMinus(c)
  const over = ev.ranked.filter((x) => (x.util ?? 0) > model.thresholds.full)
  const when = range ? whenRange(model, range) : ''
  const estimated = ev.assumptions.filter((a) => a.kind === 'capacity' && a.capacity.provenance === 'estimated').length
  return (
    <>
      {verdict && (
        <p className="lm-headline" title={ev.verdict.text} aria-live="polite">
          {!first || !range ? (
            ev.verdict.text
          ) : (
            <>
              <b className="lm-num">{fmt(values.load)}×</b> ·{' '}
              {values.load < range.low ? (
                <>
                  the {target} holds to <b className="lm-num">{multiples(range, model.searchMax, true)}</b>
                  {when && ` (${when})`}
                </>
              ) : (
                <>
                  past the {target} from <b className="lm-num">{multiple(range.low, model.searchMax)}</b>
                </>
              )}{' '}
              · limited by <b>{first.name}</b>
              {sure && (
                <span className="lm-tag" data-kind={c?.provenance === 'estimated' ? 'estimated' : 'range'}>
                  {sure}
                </span>
              )}
              {over.length > 0 && (
                <>
                  {' '}
                  · <b>{over.map((x) => x.name).join(', ')}</b> past capacity
                </>
              )}
            </>
          )}
        </p>
      )}
      {open && verdict && (
        <button type="button" className="lm-link" onClick={(e) => open('verdict', e.currentTarget)}>
          Why ›
        </button>
      )}
      {open && assumptions && (
        <button type="button" className="lm-link" onClick={(e) => open('assumptions', e.currentTarget)}>
          What this assumes · {ev.assumptions.length + extra}
          {estimated > 0 && ` (${estimated} estimated)`} ›
        </button>
      )}
    </>
  )
}

/** The order of the cards in the dock: what the reader changes first, what it changes next to it. */
const DOCK: readonly LoadmapPanel[] = ['controls', 'live', 'limits', 'headroom', 'compare']

/**
 * Full screen's panels, compact, side by side in a box the screen sizes: what does not fit is left out whole, and
 * each card opens its panel whole. A phone shows one at a time, under tabs.
 */
export function Dock({
  lm,
  panels,
  open,
}: {
  lm: LoadmapController
  panels: readonly LoadmapPanel[]
  open: OpenPanel
}) {
  const shown = DOCK.filter((p) => panels.includes(p))
  const [tab, setTab] = useState<LoadmapPanel | null>(null)
  if (!shown.length) return null
  const active = tab && shown.includes(tab) ? tab : shown[0]
  return (
    <div className="lm-dock">
      <fieldset className="lm-tabs" aria-label="Panels">
        {shown.map((p) => (
          <button type="button" key={p} aria-pressed={p === active} onClick={() => setTab(p)}>
            {NAMES[p]}
          </button>
        ))}
      </fieldset>
      {shown.map((p) => (
        <Card key={p} lm={lm} panel={p} open={open} active={p === active} />
      ))}
    </div>
  )
}

function Card({
  lm,
  panel,
  open,
  active,
}: {
  lm: LoadmapController
  panel: LoadmapPanel
  open: OpenPanel
  active: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const more = useRef<HTMLButtonElement>(null)
  useClip(box, more)
  return (
    <div className="lm-mini" data-mini={panel} data-active={active || undefined} ref={box}>
      {panel === 'controls' ? (
        <Controls lm={lm} />
      ) : panel === 'compare' ? (
        <Compare lm={lm} />
      ) : (
        <div className="lm-card">
          {panel === 'live' ? (
            <Meters lm={lm} />
          ) : panel === 'limits' ? (
            <MiniLimits lm={lm} />
          ) : (
            <>
              <h3>Headroom</h3>
              <Sparkline lm={lm} />
            </>
          )}
        </div>
      )}
      <button
        type="button"
        className="lm-more"
        ref={more}
        aria-label={`${NAMES[panel]}, all of it`}
        onClick={(e) => open(panel, e.currentTarget)}
      >
        ›
      </button>
    </div>
  )
}

/** The rows a card leaves out whole when they do not fit. */
const ROWS = '.lm-meter, .lm-mini-lim, .lm-controls > *, .lm-table tbody tr'

/**
 * Hides the rows that cross the bottom of the card, and counts them on its button. Runs again when the card's size
 * or its rows change: the meters come and go with the load, and the order of the limits with it.
 */
function useClip(box: RefObject<HTMLDivElement | null>, more: RefObject<HTMLButtonElement | null>) {
  useEffect(() => {
    const card = box.current?.querySelector<HTMLElement>('.lm-card')
    if (!card) return
    const clip = () => {
      const r = card.getBoundingClientRect()
      const bottom = r.bottom - Number.parseFloat(getComputedStyle(card).paddingBottom || '0')
      let n = 0
      for (const row of card.querySelectorAll<HTMLElement>(ROWS)) {
        const out = r.height > 0 && row.getBoundingClientRect().bottom > bottom + 0.5
        row.toggleAttribute('data-clip', out)
        if (out && !row.matches('h3')) n++
      }
      if (more.current) more.current.dataset.more = n ? `+${n}` : ''
    }
    const ro = new ResizeObserver(clip)
    ro.observe(card)
    const mo = new MutationObserver(clip)
    mo.observe(card, { childList: true, subtree: true })
    clip()
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [box, more])
}

/**
 * The limits in their order, a line each: the name and how sure its capacity is, the bar, the utilization, where it
 * is full. The first is the first limit: the verdict line names it.
 */
function MiniLimits({ lm }: { lm: LoadmapController }) {
  const { ev, model } = lm
  const top = Math.max(1.5, model.thresholds.full * 1.5)
  const at = (u: number) => `${(u / top) * 100}%`
  return (
    <>
      <h3>Where it runs out</h3>
      <div className="lm-mini-limits">
        {ev.ranked.map((c) => (
          <div className="lm-mini-lim" key={c.id} data-component={c.id}>
            <span className="lm-name" title={c.name}>
              {c.name}
              {c.capacity?.provenance === 'estimated' ? (
                <span className="lm-tag" data-kind="estimated">
                  est
                </span>
              ) : (
                !!c.capacity?.within && (
                  <span className="lm-tag" data-kind="range">
                    ±
                  </span>
                )
              )}
            </span>
            <span className="lm-track" role="img" aria-label={`${c.name} at ${c.util == null ? 'off' : pct(c.util)}`}>
              <span
                className="lm-fill"
                data-state={c.state}
                style={{ width: `${Math.min(100, ((c.util ?? 0) / top) * 100)}%` }}
              />
              <span className="lm-tick" style={{ left: at(model.thresholds.target) }} />
              <span className="lm-tick" style={{ left: at(model.thresholds.full) }} />
            </span>
            <span className="lm-val">{c.util == null ? '—' : pct(c.util)}</span>
            <span className="lm-val lm-sub">
              {c.util == null
                ? 'off'
                : c.full != null && !Number.isFinite(c.full)
                  ? `full > ${fmt(model.searchMax)}×`
                  : `full ${c.fullRange ? multiples(c.fullRange, model.searchMax, true) : multiple(c.full, model.searchMax)}`}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

/** The headroom chart as a sparkline: each scenario's line, the target, the load; where the shown one crosses it. */
function Sparkline({ lm }: { lm: LoadmapController }) {
  const { model, values } = lm
  const h = useHeadroom(lm)
  const [box, { width: W, height: H }] = useSize<HTMLDivElement>(240)
  const top = Math.max(1.5, model.thresholds.full * 1.5)
  const lx = (x: number) => (W * Math.log(x / h.from)) / Math.log(h.to / h.from)
  // room under the heading; past the top a line leaves through the edge (the svg clips), not along it
  const ly = (u: number) => 8 + (H - 10) * (1 - Math.min(u, top * 1.2) / top)
  const path = (s: Series) => {
    let d = ''
    let pen = false
    for (const [x, u] of s) {
      if (u == null) {
        pen = false
        continue
      }
      d += `${pen ? 'L' : 'M'}${lx(x).toFixed(1)} ${ly(u).toFixed(1)}`
      pen = true
    }
    return d
  }
  const line = h.lines.find((l) => l.selected) ?? h.lines[0]
  const target = pct(model.thresholds.target)
  const reaches = line
    ? `${line.targetRange ? multiples(line.targetRange, model.searchMax, true) : multiple(line.target, model.searchMax)}`
    : ''
  const when = line ? whenRange(model, line.targetRange) : ''
  const loadX = lx(Math.min(h.to, Math.max(h.from, values.load)))
  return (
    <>
      <div className="lm-spark" ref={box}>
        {H > 0 && (
          <svg width={W} height={H} aria-hidden="true">
            <line
              className="lm-spark-th"
              x1={0}
              x2={W}
              y1={ly(model.thresholds.target)}
              y2={ly(model.thresholds.target)}
            />
            {h.lines.map((l) => (
              <path
                key={l.label ?? ''}
                d={path(l.envelope)}
                fill="none"
                stroke={scenarioColor(model, l.label)}
                strokeWidth={l.selected ? 2 : 1.25}
              />
            ))}
            <line className="lm-spark-load" x1={loadX} x2={loadX} y1={0} y2={H} />
          </svg>
        )}
      </div>
      {line && (
        <p className="lm-spark-text" title={`${line.label ?? 'It'} reaches the ${target} target at ${reaches}`}>
          {line.label ?? 'It'} reaches the {target} target at {reaches}
          {when && ` (${when})`}.
        </p>
      )}
    </>
  )
}
