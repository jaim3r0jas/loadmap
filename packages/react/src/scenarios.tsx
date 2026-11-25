import {
  type Comparison,
  type CrossingRange,
  compare,
  type Headroom,
  type HeadroomLine,
  headroom,
  type Model,
  type Series,
} from '@loadmap/core'
import { fmt, multiple, multiples, pct } from '@loadmap/core/format'
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { scenarioColor, useSize, when, whenRange } from './bar'
import type { LoadmapController } from './useLoadmap'

export { Scenarios, scenarioColor, useSize, when, whenRange } from './bar'

const lineName = (l: HeadroomLine) => l.label ?? 'These values'
/** A line's colour: an N−1 line has the colour of the line it is the outage of, and is dashed. */
const lineColor = (model: Model, l: HeadroomLine) => scenarioColor(model, l.outage ? l.outage.of : l.label)
/** An N−1 line may carry a scenario's label: its key says it is the outage. */
const lineKey = (l: HeadroomLine) => (l.outage ? `${lineName(l)}#${l.outage.domain}` : lineName(l))
/** The legend's swatch, dashed for an N−1 line as its line is. */
const keyStyle = (model: Model, l: HeadroomLine) => {
  const c = lineColor(model, l)
  return { background: l.outage ? `repeating-linear-gradient(90deg, ${c} 0 4px, transparent 4px 7px)` : c }
}

/** The comparison at the shown load: crossings do not depend on it, the verdicts do. */
export function useComparison(lm: LoadmapController): Comparison {
  return useMemo(() => compare(lm.model, lm.values.load), [lm.model, lm.values.load])
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
  // the pessimistic edge first: data-multiple is where it may already happen
  const at = (r: CrossingRange | null) => (
    <>
      {r ? multiples(r, model.searchMax, true) : multiple(null)}
      {whenRange(model, r) && <small>{whenRange(model, r)}</small>}
    </>
  )
  // what each scenario costs a month, and the change from the first, where a box has a cost
  const costs = c.rows.some((r) => r.cost != null)
  const unit = model.def.currency ? ` ${model.def.currency}` : ''
  const first = c.rows[0]!.cost
  const money = (r: (typeof c.rows)[number]) => {
    if (r.cost == null) return '—'
    const d = r === c.rows[0] || first == null ? 0 : r.cost - first
    return `${fmt(r.cost)}${unit}${Math.abs(d) >= 0.5 ? ` (${d > 0 ? '+' : '−'}${fmt(Math.abs(d))})` : ''}`
  }
  return (
    <div className="lm-card lm-compare">
      <h3>{title}</h3>
      <p className="lm-compare-text">{c.text}</p>
      <div className="lm-table-wrap">
        <table className="lm-table">
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col">Limited by</th>
              <th scope="col">{target}</th>
              <th scope="col">Runs out</th>
              {costs && <th scope="col">Cost a month</th>}
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
                <td data-multiple={r.target ?? ''} data-high={r.targetRange?.high ?? ''}>
                  {at(r.targetRange)}
                </td>
                <td data-multiple={r.full ?? ''} data-high={r.fullRange?.high ?? ''}>
                  {at(r.fullRange)}
                </td>
                {costs && <td data-cost={r.cost ?? ''}>{money(r)}</td>}
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
                      {x.targetRange == null ? 'off' : multiples(x.targetRange, model.searchMax, true)}
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

/** Every scenario's line over the load: it depends on every value but the load, which is only the marker. */
export function useHeadroom(lm: LoadmapController): Headroom {
  const { model, values } = lm
  const rest = JSON.stringify({ ...values, load: null })
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rest` stands for the values without the load
  return useMemo(() => headroom(model, { ...values, load: model.load.default }), [model, rest])
}

/**
 * The width of a label in the chart's 11 px monospace (`--lm-mono`), measured once the chart is on the page, so its
 * labels are kept inside it whatever the theme's font.
 */
function useAxisMeasure(el: RefObject<HTMLElement | null>): (text: string, weight?: number) => number {
  const [measure, setMeasure] = useState(() => (text: string, _weight?: number) => text.length * 6.7)
  useLayoutEffect(() => {
    const ctx = el.current && document.createElement('canvas').getContext('2d')
    if (!ctx) return
    const font = getComputedStyle(el.current!).getPropertyValue('--lm-mono').trim() || 'monospace'
    setMeasure(() => (text: string, weight = 400) => {
      ctx.font = `${weight} 11px ${font}`
      return ctx.measureText(text).width
    })
  }, [el])
  return measure
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
 * With a ± on a capacity, a band shows the line at every capacity's low and high bound, and a bracket on the target
 * and 100 % lines spans where the band crosses them. The shown scenario's components are the thin lines under it.
 * Hover or arrow keys read every line at one load.
 */
export function HeadroomChart({ lm, title = 'Headroom' }: { lm: LoadmapController; title?: ReactNode }) {
  const { model, values } = lm
  const h = useHeadroom(lm)
  const [wrap, { width }] = useSize<HTMLDivElement>(640)
  const [hover, setHover] = useState<number | null>(null)
  const clip = useId().replace(/:/g, '')
  const measure = useAxisMeasure(wrap)
  // the reading beside the hovered load, kept inside the chart by its own width
  const tip = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = tip.current
    if (el && hover != null) el.style.left = `${Math.max(0, Math.min(lx(xs[hover]!) + 10, W - el.offsetWidth))}px`
  })

  const dated = !!model.growth
  const m = { l: 44, r: 14, t: 14, b: dated ? 40 : 26 }
  const W = width
  const H = Math.round(Math.min(300, Math.max(200, W * 0.45)))
  const pw = W - m.l - m.r
  const ph = H - m.t - m.b
  const top = Math.max(1.5, model.thresholds.full * 1.5)
  const lx = (x: number) => m.l + (pw * Math.log(x / h.from)) / Math.log(h.to / h.from)
  // past the top a line leaves the plot through its edge (the clip), not along it
  const ly = (u: number) => m.t + ph * (1 - Math.min(u, top * 1.2) / top)
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
    } else if (e.key === 'Escape' && hover != null) {
      // the reading's own: a panel the chart is in stays open
      e.preventDefault()
      setHover(null)
    }
  }

  const area = (b: NonNullable<HeadroomLine['band']>) => {
    const both = b.upper.flatMap(([x, u], i) => {
      const v = b.lower[i]![1]
      return u == null || v == null ? [] : [[x, u, v] as const]
    })
    if (both.length < 2) return ''
    const up = both.map(([x, u]) => `${lx(x).toFixed(1)} ${ly(u).toFixed(1)}`)
    const down = both.map(([x, , v]) => `${lx(x).toFixed(1)} ${ly(v).toFixed(1)}`).reverse()
    return `M${up.join('L')}L${down.join('L')}Z`
  }
  const reaches = (r: CrossingRange | null, x: number | null) =>
    r && l0(r) ? multiples(r, model.searchMax) : multiple(x, model.searchMax)
  const l0 = (r: CrossingRange) => multiple(r.low, model.searchMax) !== multiple(r.high, model.searchMax)
  const summary = h.lines
    .map(
      (l) =>
        `${lineName(l)} reaches the ${pct(model.thresholds.target)} target at ${reaches(l.targetRange, l.target)} and ${pct(model.thresholds.full)} at ${reaches(l.fullRange, l.full)}`,
    )
    .join('; ')
  const loadX = lx(Math.min(h.to, Math.max(h.from, values.load)))
  const hx = hover == null ? null : xs[hover]!
  // The measured width only picks where a label is anchored, never moves it by itself: the same chart draws the same
  // numbers on any machine
  type At = { x: number; textAnchor: 'start' | 'middle' | 'end' }
  const fromLeft = { x: 0, textAnchor: 'start' } as const
  const fromRight = { x: W, textAnchor: 'end' } as const
  /** A label beside a line at x: on the side it prefers if it fits, else the other, else against the nearer edge. */
  const beside = (x: number, w: number, prefer: 'left' | 'right', gap = 4): At => {
    const right: At = { x: x + gap, textAnchor: 'start' }
    const left: At = { x: x - gap, textAnchor: 'end' }
    const fitsRight = x + gap + w <= W
    const fitsLeft = x - gap - w >= 0
    if (prefer === 'right' ? fitsRight : !fitsLeft && fitsRight) return right
    if (fitsLeft) return left
    return x < W / 2 ? fromLeft : fromRight
  }
  /** A label centred on x, unless that passes an edge. */
  const centred = (x: number, w: number): At =>
    x - w / 2 < 0 ? fromLeft : x + w / 2 > W ? fromRight : { x, textAnchor: 'middle' }
  const shown = `shown: ${fmt(values.load)}×`
  /** A crossing's multiple, left of its dot where it fits. */
  const mark = (t: string, x: number, y: number) => (
    <text {...beside(x, measure(t, 600), 'left', 6)} y={y} className="lm-mark">
      {t}
    </text>
  )

  return (
    <div className="lm-card lm-headroom">
      <h3>{title}</h3>
      {h.lines.length > 1 && (
        <div className="lm-legend">
          {h.lines.map((l) => (
            <span key={lineKey(l)}>
              <b className="lm-key" style={keyStyle(model, l)} />
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
              <rect x={m.l} y={m.t} width={pw} height={ph + 2} />
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
          {tickList.map((x) => {
            // centred on its tick, unless that would pass an edge of the chart
            const label = `${fmt(x)}×`
            const date = dated && x > 1 ? when(model, x) : ''
            return (
              <g key={x} className="lm-axis">
                <line x1={lx(x)} x2={lx(x)} y1={m.t + ph} y2={m.t + ph + 4} stroke="var(--lm-line)" />
                {labelled(x) && (
                  <>
                    <text {...centred(lx(x), measure(label))} y={m.t + ph + 16}>
                      {label}
                    </text>
                    {date && (
                      <text {...centred(lx(x), measure(date))} y={m.t + ph + 30}>
                        {date}
                      </text>
                    )}
                  </>
                )}
              </g>
            )
          })}
          <g clipPath={`url(#${clip})`}>
            {/* the bands under everything: the shown one stronger */}
            {[...h.lines]
              .sort((a, b) => Number(a.selected) - Number(b.selected))
              .map((l) =>
                l.band ? (
                  <path
                    key={lineKey(l)}
                    data-band={lineName(l)}
                    d={area(l.band)}
                    fill={lineColor(model, l)}
                    fillOpacity={l.selected ? 0.2 : 0.08}
                  />
                ) : null,
              )}
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
                  key={lineKey(l)}
                  data-line={lineName(l)}
                  d={path(l.envelope)}
                  fill="none"
                  stroke={lineColor(model, l)}
                  strokeDasharray={l.outage ? '6 4' : undefined}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
          </g>
          <line x1={loadX} x2={loadX} y1={m.t} y2={m.t + ph} stroke="var(--lm-fg)" strokeOpacity=".45" />
          <text {...beside(loadX, measure(shown), 'right')} y={m.t + 10} className="lm-axis">
            {shown}
          </text>
          {h.lines.flatMap((l) =>
            (
              [
                ['target', l.targetRange, model.thresholds.target],
                ['full', l.fullRange, model.thresholds.full],
              ] as const
            ).map(([kind, r, u]) => {
              if (!l.band || !r || !Number.isFinite(r.low) || r.low > h.to) return null
              const [x1, x2] = [lx(Math.max(h.from, r.low)), lx(Math.min(h.to, r.high))]
              const y = ly(u)
              return (
                <g
                  key={`${lineKey(l)}/${kind}/range`}
                  data-range={kind}
                  data-scenario={lineName(l)}
                  data-low={r.low}
                  data-high={r.high}
                  stroke={lineColor(model, l)}
                  strokeWidth={l.selected ? 3 : 2}
                  strokeOpacity={l.selected ? 1 : 0.6}
                >
                  <line x1={x1} x2={x2} y1={y} y2={y} />
                  <line x1={x1} x2={x1} y1={y - 5} y2={y + 5} />
                  {Number.isFinite(r.high) && r.high <= h.to && <line x1={x2} x2={x2} y1={y - 5} y2={y + 5} />}
                </g>
              )
            }),
          )}
          {h.lines.flatMap((l) =>
            (
              [
                ['target', l.target, l.targetRange, model.thresholds.target],
                ['full', l.full, l.fullRange, model.thresholds.full],
              ] as const
            ).map(([kind, x, r, u]) =>
              x != null && Number.isFinite(x) && x >= h.from && x <= h.to ? (
                <g key={`${lineKey(l)}/${kind}`}>
                  <circle
                    data-crossing={kind}
                    data-scenario={lineName(l)}
                    data-multiple={x}
                    cx={lx(x)}
                    cy={ly(u)}
                    r="4"
                    fill={lineColor(model, l)}
                    stroke="var(--lm-surface)"
                    strokeWidth="2"
                  />
                  {/* a range is labelled at its pessimistic end */}
                  {l.selected &&
                    mark(
                      r && l0(r) ? multiples(r, model.searchMax, true) : multiple(x, model.searchMax),
                      lx(r && l0(r) ? Math.max(h.from, r.low) : x),
                      ly(u) - 8,
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
          <div className="lm-tip" role="status" ref={tip} style={{ left: lx(hx) + 10, top: m.t }}>
            <b>
              {fmt(hx)}×{when(model, hx) && ` · ${when(model, hx)}`}
            </b>
            {h.lines.map((l) => (
              <span key={lineKey(l)}>
                <b className="lm-key" style={keyStyle(model, l)} />
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
