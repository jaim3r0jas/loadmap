import {
  type Comparison,
  compare,
  fmt,
  type Headroom,
  type HeadroomLine,
  headroom,
  type Model,
  monthOf,
  multiple,
  pct,
  type Series,
} from '@loadmap/core'
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { LoadmapController } from './useLoadmap'

/** Scenario identity colours, in declaration order; a fifth and later scenario is drawn muted. */
const SERIES = ['var(--lm-s1)', 'var(--lm-s2)', 'var(--lm-s3)', 'var(--lm-s4)']

/** The colour of a scenario by label; values of the reader's own are drawn in the text colour. */
export function scenarioColor(model: Model, label: string | null): string {
  if (label == null) return 'var(--lm-fg)'
  const i = model.scenarios.findIndex((s) => s.label === label)
  return SERIES[i] ?? 'var(--lm-muted)'
}

const lineName = (l: HeadroomLine) => l.label ?? 'These values'

/** A month for a table cell or an axis: "Mar 2031"; "now" for a crossing already reached. */
function when(model: Model, x: number | null): string {
  if (x != null && x <= 1 && model.growth) return 'now'
  const d = model.dateAt(x)
  return d ? monthOf(d, true) : ''
}

/** The comparison at the shown load: crossings do not depend on it, the verdicts do. */
export function useComparison(lm: LoadmapController): Comparison {
  return useMemo(() => compare(lm.model, lm.values.load), [lm.model, lm.values.load])
}

/** One button per scenario: a reader switches designs without touching the controls. The load stays. */
export function Scenarios({ lm }: { lm: LoadmapController }) {
  const { model } = lm
  if (!model.scenarios.length) return null
  return (
    <fieldset className="lm-scenarios">
      <legend>Scenario</legend>
      {model.scenarios.map((s) => (
        <button
          type="button"
          key={s.label}
          aria-pressed={lm.scenario?.label === s.label}
          onClick={() => lm.setScenario(s.label)}
        >
          <i style={{ background: scenarioColor(model, s.label) }} />
          {s.label}
        </button>
      ))}
      {!lm.scenario && <span className="lm-own">your own values</span>}
    </fieldset>
  )
}

/** "+107 %" against the baseline; "same" within a rounding; nothing where either never runs out. */
function change(x: number | null): string {
  if (x == null || !Number.isFinite(x) || x === 0) return ''
  if (Math.abs(x - 1) < 0.005) return 'same'
  return `${x > 1 ? '+' : '−'}${pct(Math.abs(x - 1))}`
}

/** The scenarios side by side: which buys more headroom, where each first runs out, and per component. */
export function Compare({ lm, title = 'Scenarios compared' }: { lm: LoadmapController; title?: ReactNode }) {
  const { model } = lm
  const c = useComparison(lm)
  if (c.rows.length < 2) return null
  const target = `${pct(model.thresholds.target)} target`
  const at = (x: number | null) => (
    <>
      {multiple(x, model.searchMax)}
      {when(model, x) && <small>{when(model, x)}</small>}
    </>
  )
  return (
    <div className="lm-card lm-compare">
      <h3>{title}</h3>
      <p className="lm-compare-text">{c.text}</p>
      <div className="lm-table-wrap">
        <table className="lm-table">
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col">First limit</th>
              <th scope="col">{target}</th>
              <th scope="col">Runs out</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => (
              <tr key={r.label} data-scenario={r.label} aria-current={lm.scenario?.label === r.label || undefined}>
                <th scope="row">
                  <i style={{ background: scenarioColor(model, r.label) }} />
                  {r.label}
                </th>
                <td className="lm-text">{r.firstLimit?.name ?? '—'}</td>
                <td data-multiple={r.target ?? ''}>{at(r.target)}</td>
                <td data-multiple={r.full ?? ''}>{at(r.full)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>{target}, by component</h3>
      <div className="lm-table-wrap">
        <table className="lm-table">
          <thead>
            <tr>
              <th scope="col">Component</th>
              {c.rows.map((r) => (
                <th scope="col" key={r.label}>
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.componentIds.map((id, k) => (
              <tr key={id} data-component={id}>
                <th scope="row">{c.rows[0]!.components[k]!.name}</th>
                {c.rows.map((r, i) => {
                  const x = r.components[k]!
                  return (
                    <td key={r.label} data-multiple={x.target ?? ''}>
                      {x.target == null ? 'off' : multiple(x.target, model.searchMax)}
                      {i > 0 && change(x.change) && <small>{change(x.change)}</small>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** The width of an element in CSS pixels, kept current: the chart draws at its own size so text stays legible. */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const x = Math.round(e?.contentRect.width ?? el.clientWidth)
      if (x > 0) setW(x)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** 1, 2, 5, 10, 20, 50, … inside [from, to]; decades only when there is little room. */
function ticks(from: number, to: number, roomy: boolean): number[] {
  const out: number[] = []
  for (let d = Math.floor(Math.log10(from)); d <= Math.ceil(Math.log10(to)); d++)
    for (const k of roomy ? [1, 2, 5] : [1]) {
      const v = k * 10 ** d
      if (v >= from * 0.999 && v <= to * 1.001) out.push(Number(v.toPrecision(6)))
    }
  return out
}

/**
 * Utilization over the load multiple. Each scenario's line is its highest utilization, so it crosses the target and
 * 100 % exactly where its first limit does; the dots are those crossings, taken from the limits, not from the line.
 * The shown scenario's components are the thin lines under it. Hover or arrow keys read every line at one load.
 */
export function HeadroomChart({ lm, title = 'Headroom' }: { lm: LoadmapController; title?: ReactNode }) {
  const { model, values } = lm
  const rest = JSON.stringify({ ...values, load: null })
  // the lines depend on every value but the load; the load is only the marker
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rest` stands for the values without the load
  const h: Headroom = useMemo(() => headroom(model, { ...values, load: model.load.default }), [model, rest])
  const [wrap, width] = useWidth<HTMLDivElement>(640)
  const [hover, setHover] = useState<number | null>(null)
  const clip = useId().replace(/:/g, '')

  const dated = !!model.growth
  const m = { l: 44, r: 14, t: 14, b: dated ? 40 : 26 }
  const W = width
  const H = Math.round(Math.min(300, Math.max(200, W * 0.45)))
  const pw = W - m.l - m.r
  const ph = H - m.t - m.b
  const top = Math.max(1.5, model.thresholds.full * 1.5)
  const lx = (x: number) => m.l + (pw * Math.log(x / h.from)) / Math.log(h.to / h.from)
  const ly = (u: number) => m.t + ph * (1 - Math.min(u, top * 1.05) / top)
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
  const xs = h.lines[0]?.envelope.map(([x]) => x) ?? []
  const selected = h.lines.find((l) => l.selected)
  const roomy = W >= 480
  const tickList = ticks(h.from, h.to, roomy)
  const labelled = (x: number) => roomy || Number.isInteger(Math.log10(x))

  const near = (px: number) => {
    let best = 0
    for (let i = 1; i < xs.length; i++) if (Math.abs(lx(xs[i]!) - px) < Math.abs(lx(xs[best]!) - px)) best = i
    return best
  }
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
    setHover(near(e.clientX - r.left))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = hover ?? near(lx(Math.min(h.to, Math.max(h.from, values.load))))
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      setHover(Math.max(0, Math.min(xs.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1))))
    } else if (e.key === 'Escape') setHover(null)
  }

  const summary = h.lines
    .map(
      (l) =>
        `${lineName(l)} reaches the ${pct(model.thresholds.target)} target at ${multiple(l.target, model.searchMax)} and ${pct(model.thresholds.full)} at ${multiple(l.full, model.searchMax)}`,
    )
    .join('; ')
  const loadX = lx(Math.min(h.to, Math.max(h.from, values.load)))
  const hx = hover == null ? null : xs[hover]!

  return (
    <div className="lm-card lm-headroom">
      <h3>{title}</h3>
      {h.lines.length > 1 && (
        <div className="lm-legend">
          {h.lines.map((l) => (
            <span key={lineName(l)}>
              <b className="lm-key" style={{ background: scenarioColor(model, l.label) }} />
              {lineName(l)}
            </span>
          ))}
          {selected && <span>thin lines: each component of {lineName(selected)}</span>}
        </div>
      )}
      {/* the arrow keys move a reading along the load: the chart is a slider */}
      <div
        className="lm-chart"
        ref={wrap}
        role="slider"
        aria-label={`Utilization over the load multiple. ${summary}.`}
        aria-valuemin={h.from}
        aria-valuemax={h.to}
        aria-valuenow={hx ?? values.load}
        aria-valuetext={
          hx == null
            ? `${fmt(values.load)}×`
            : `${fmt(hx)}×: ${h.lines.map((l) => `${lineName(l)} ${l.envelope[hover!]![1] == null ? 'off' : pct(l.envelope[hover!]![1]!)}`).join(', ')}`
        }
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <defs>
            <clipPath id={clip}>
              <rect x={m.l} y={m.t - 4} width={pw} height={ph + 4} />
            </clipPath>
          </defs>
          {[0, model.thresholds.target, model.thresholds.full].map((u) => (
            <g key={u}>
              <line x1={m.l} x2={W - m.r} y1={ly(u)} y2={ly(u)} stroke="var(--lm-line)" />
              <text x={m.l - 6} y={ly(u) + 4} textAnchor="end" className="lm-axis">
                {pct(u)}
              </text>
            </g>
          ))}
          <text x={W - m.r} y={ly(model.thresholds.target) - 5} textAnchor="end" className="lm-axis">
            target
          </text>
          {tickList.map((x) => (
            <g key={x} className="lm-axis">
              <line x1={lx(x)} x2={lx(x)} y1={m.t + ph} y2={m.t + ph + 4} stroke="var(--lm-line)" />
              {labelled(x) && (
                <>
                  <text x={lx(x)} y={m.t + ph + 16} textAnchor="middle">
                    {fmt(x)}×
                  </text>
                  {dated && x > 1 && (
                    <text x={lx(x)} y={m.t + ph + 30} textAnchor="middle">
                      {when(model, x)}
                    </text>
                  )}
                </>
              )}
            </g>
          ))}
          <g clipPath={`url(#${clip})`}>
            {selected?.components.map((c) => (
              <path
                key={c.id}
                d={path(c.points)}
                fill="none"
                stroke="var(--lm-muted)"
                strokeOpacity=".55"
                strokeWidth="1"
              />
            ))}
            {/* the shown line last, on top */}
            {[...h.lines]
              .sort((a, b) => Number(a.selected) - Number(b.selected))
              .map((l) => (
                <path
                  key={lineName(l)}
                  data-line={lineName(l)}
                  d={path(l.envelope)}
                  fill="none"
                  stroke={scenarioColor(model, l.label)}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
          </g>
          <line x1={loadX} x2={loadX} y1={m.t} y2={m.t + ph} stroke="var(--lm-fg)" strokeOpacity=".45" />
          <text x={loadX + 4} y={m.t + 10} className="lm-axis">
            shown: {fmt(values.load)}×
          </text>
          {h.lines.flatMap((l) =>
            (
              [
                ['target', l.target, model.thresholds.target],
                ['full', l.full, model.thresholds.full],
              ] as const
            ).map(([kind, x, u]) =>
              x != null && Number.isFinite(x) && x >= h.from && x <= h.to ? (
                <g key={`${lineName(l)}/${kind}`}>
                  <circle
                    data-crossing={kind}
                    data-scenario={lineName(l)}
                    data-multiple={x}
                    cx={lx(x)}
                    cy={ly(u)}
                    r="4"
                    fill={scenarioColor(model, l.label)}
                    stroke="var(--lm-surface)"
                    strokeWidth="2"
                  />
                  {l.selected && (
                    <text x={lx(x) - 6} y={ly(u) - 8} textAnchor="end" className="lm-mark">
                      {multiple(x, model.searchMax)}
                    </text>
                  )}
                </g>
              ) : null,
            ),
          )}
          {hx != null && (
            <line x1={lx(hx)} x2={lx(hx)} y1={m.t} y2={m.t + ph} stroke="var(--lm-fg)" strokeOpacity=".8" />
          )}
          <rect
            x={m.l}
            y={m.t}
            width={pw}
            height={ph}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {hover != null && hx != null && (
          <div className="lm-tip" role="status" style={{ left: Math.min(lx(hx) + 10, W - 200), top: m.t }}>
            <b>
              {fmt(hx)}×{when(model, hx) && ` · ${when(model, hx)}`}
            </b>
            {h.lines.map((l) => (
              <span key={lineName(l)}>
                <b className="lm-key" style={{ background: scenarioColor(model, l.label) }} />
                <strong>{l.envelope[hover]![1] == null ? 'off' : pct(l.envelope[hover]![1]!)}</strong> {lineName(l)}
              </span>
            ))}
            {selected?.components.map((c) => (
              <span key={c.id} className="lm-sub">
                <strong>{c.points[hover]![1] == null ? 'off' : pct(c.points[hover]![1]!)}</strong> {c.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
