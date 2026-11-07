import type { Assumption, Capacity, Preset } from '@loadmap/core'
import { compact, fmt, multiple, multiples, pct, secs } from '@loadmap/core/format'
import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useId, useState } from 'react'
import { Scenarios, useSize, when } from './scenarios'
import { labelled, loadScale, marksOf, zones } from './track'
import type { LoadmapController } from './useLoadmap'

/** The model's one-sentence answer for the current values, and which capacity to measure when it is unsure. */
export function Verdict({ lm }: { lm: LoadmapController }) {
  const { measure } = lm.ev
  return (
    <>
      <p className="lm-verdict" data-tier={lm.ev.verdict.tier} aria-live="polite">
        {lm.ev.verdict.text}
      </p>
      {measure && (
        <p className="lm-measure" data-component={measure.component}>
          {measure.text}
        </p>
      )}
    </>
  )
}

/** "±30 %" for a capacity with a range. */
export const plusMinus = (c: Capacity | null) => (c?.within ? `±${pct(c.within)}` : '')

/** Each component's utilization in the order they reach the target, with where they cross it and 100 %. */
export function Limits({ lm, title = 'Where it runs out, in order' }: { lm: LoadmapController; title?: ReactNode }) {
  const { ev, model } = lm
  const top = Math.max(1.5, model.thresholds.full * 1.5)
  const at = (u: number) => `${(u / top) * 100}%`
  const span = (r: { low: number; high: number } | null, x: number | null) =>
    r ? multiples(r, model.searchMax, true) : multiple(x, model.searchMax)
  return (
    <>
      <h3>{title}</h3>
      <div className="lm-scale" aria-hidden="true">
        <span />
        <div>
          <span style={{ left: 0, transform: 'none' }}>0</span>
          <span style={{ left: at(model.thresholds.target) }}>{pct(model.thresholds.target)} target</span>
          <span style={{ left: at(model.thresholds.full) }}>{pct(model.thresholds.full)}</span>
          <span style={{ left: '100%', transform: 'translateX(-100%)' }}>{pct(top)}</span>
        </div>
        <span />
      </div>
      <div className="lm-limits">
        {ev.ranked.map((c) => (
          <div className="lm-lim" key={c.id} data-component={c.id}>
            <div>
              <b>
                {c.name}
                {c === ev.firstLimit && (
                  <span className="lm-tag" data-kind="first">
                    limit
                  </span>
                )}
                {c.capacity?.provenance === 'estimated' ? (
                  <span className="lm-tag" data-kind="estimated">
                    estimate{c.capacity.within ? ` ${plusMinus(c.capacity)}` : ''}
                  </span>
                ) : (
                  !!c.capacity?.within && (
                    <span className="lm-tag" data-kind="range">
                      {plusMinus(c.capacity)}
                    </span>
                  )
                )}
              </b>
              <span className="lm-sub">
                {c.describe ?? (c.capacity ? `${fmt(c.capacity.value)} ${c.capacity.unit}` : 'switched off')}
              </span>
            </div>
            <div className="lm-track" role="img" aria-label={`${c.name} at ${c.util == null ? 'off' : pct(c.util)}`}>
              <div
                className="lm-fill"
                data-state={c.state}
                style={{ width: `${Math.min(100, ((c.util ?? 0) / top) * 100)}%` }}
              />
              <div className="lm-tick" style={{ left: at(model.thresholds.target) }} />
              <div className="lm-tick" style={{ left: at(model.thresholds.full) }} />
            </div>
            <div className="lm-val">
              {c.util == null ? '—' : `${pct(c.util)} · ${num(c.demand ?? 0)} ${c.capacity?.unit ?? ''}`}
              <small>
                {c.util == null
                  ? 'switched off'
                  : `${pct(model.thresholds.target)} at ${span(c.targetRange, c.target)} · full at ${span(c.fullRange, c.full)}`}
              </small>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

/**
 * Live numbers: from the sim, lag and drops per queue, busy workers, rejected requests; from the model, pods running,
 * cache answers and retries.
 */
export function Meters({ lm }: { lm: LoadmapController }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 250)
    return () => clearInterval(t)
  }, [])
  const { ev, engine, model } = lm
  const sim = engine.sim
  const flowLabel = (f: string) => model.def.flows[f]?.label ?? f
  const items: { key: string; value: string; label: string; state: 'ok' | 'warn' | 'over' }[] = []
  for (const s of Object.values(ev.stages)) {
    if (s.kind === 'queue')
      for (const f of model.flowIds.filter((x) => ev.routes[x]?.includes(s.id))) {
        const q = sim.queue(s.id, f)
        const rules = ev.overload[f] ?? {}
        items.push({
          key: `${s.id}/${f}/lag`,
          value: secs(q.lag),
          label: `${flowLabel(f)} lag in ${s.label}`,
          state: q.lag > 60 ? 'over' : q.lag > 5 ? 'warn' : 'ok',
        })
        if (rules.merge)
          items.push({
            key: `${s.id}/${f}/merge`,
            value: compact(q.merged),
            label: `${flowLabel(f)} superseded /s (${rules.merge.reason ?? 'newest kept'})`,
            state: q.merged > 0.5 ? 'warn' : 'ok',
          })
        if (rules.drop)
          items.push({
            key: `${s.id}/${f}/drop`,
            value: compact(q.dropped),
            label: `${flowLabel(f)} dropped /s (${rules.drop.reason ?? 'too old'})`,
            state: q.dropped > 0.5 ? 'over' : 'ok',
          })
      }
    if (s.kind === 'workers') {
      const b = sim.busy(s.id)
      items.push({
        key: `${s.id}/busy`,
        value: pct(b),
        label: `${s.label} busy`,
        state: b > 0.95 ? 'over' : b > 0.5 ? 'warn' : 'ok',
      })
      if (s.autoscale)
        items.push({
          key: `${s.id}/pods`,
          value: `${s.running} of ${s.pods}`,
          label: `${s.label} pods running`,
          state:
            s.running < s.pods
              ? 'ok'
              : (ev.components[s.component]?.util ?? 0) > model.thresholds.full
                ? 'over'
                : 'warn',
        })
    }
    if (s.kind === 'cache') {
      items.push({
        key: `${s.id}/hits`,
        value: compact(sim.arriving(s.id) * (1 - sim.shed(s.id)) * s.hit),
        label: `answered at ${s.label} /s (${pct(s.hit)} hits)`,
        state: 'ok',
      })
    }
    if ((s.kind === 'pass' || s.kind === 'limit' || s.kind === 'cache') && sim.shed(s.id) > 0)
      items.push({ key: `${s.id}/shed`, value: pct(sim.shed(s.id)), label: `rejected at ${s.label}`, state: 'over' })
  }
  for (const f of model.flowIds) {
    const r = ev.retry[f]
    if (!r || !(r.rate > 0)) continue
    const per = r.attempts / r.rate
    items.push({
      key: `${f}/attempts`,
      value: `${fmt(per)}×`,
      label: `${flowLabel(f)} attempts per ${model.def.flows[f]?.unit ?? 'unit'}`,
      state: per > 1.05 ? 'warn' : 'ok',
    })
    items.push({
      key: `${f}/failed`,
      value: pct(r.failed),
      label: `${flowLabel(f)} failing after ${r.times} ${r.times === 1 ? 'retry' : 'retries'}`,
      state: r.failed > 0.005 ? 'over' : 'ok',
    })
  }
  return (
    <>
      <h3>Live</h3>
      <div className="lm-meters">
        {items.map((m) => (
          <div className="lm-meter" data-state={m.state} key={m.key}>
            <b>{m.value}</b>
            <span title={m.label}>{m.label}</span>
          </div>
        ))}
      </div>
    </>
  )
}

/** A preset's values are the shown ones. */
const isOn = (lm: LoadmapController, p: Preset<any>) =>
  Object.entries(p.values).every(([k, x]) => (lm.values as Record<string, unknown>)[k] === x)

/**
 * The load slider: its label, the load with its date, and a track coloured by what the load does (under the target,
 * past it, past capacity). Under it, a mark for each preset that sets the load, which a click takes; ← → move a
 * step, Page Up and Page Down to the next mark. A load that spans ten times or more is on a log scale.
 */
export function LoadRange({ lm }: { lm: LoadmapController }) {
  const { model, ev } = lm
  const load = model.load
  const x = lm.values.load
  const id = useId()
  const [box, { width }] = useSize<HTMLDivElement>(240)
  const { at, of } = loadScale(load)
  const marks = marksOf(ev.presets, ev.full, load, fmt)
  const shown = labelled(marks, at, width)
  // through the track and back: on the step's grid, without a float's dust, inside the range
  const set = (to: number) => lm.setValues({ load: of(at(to)) } as any)
  const key = (e: KeyboardEvent) => {
    const by = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]
    const loads = marks.map((m) => m.load).sort((a, b) => a - b)
    const to = by
      ? x + by * load.step
      : e.key === 'PageUp'
        ? (loads.find((l) => l > x) ?? load.max)
        : e.key === 'PageDown'
          ? (loads.findLast((l) => l < x) ?? load.min)
          : e.key === 'Home'
            ? load.min
            : e.key === 'End'
              ? load.max
              : null
    if (to == null) return
    e.preventDefault()
    set(to)
  }
  const date = when(model, x)
  // the widest the load is anywhere on its range, so dragging never moves what is beside it
  const wide = Math.max(...[load.min, load.max, load.min + load.step].map((n) => fmt(n).length)) + 1
  return (
    <div className="lm-range lm-load">
      <label htmlFor={id} title={load.label}>
        {load.label}
      </label>
      <output htmlFor={id} style={{ minWidth: `${Math.max(wide, date ? 6 : 0)}ch` }}>
        {fmt(x)}×{date && <small>{date}</small>}
      </output>
      <div className="lm-load-track" style={{ '--lm-at': at(x) } as CSSProperties}>
        <input
          id={id}
          type="range"
          min={0}
          max={1}
          step="any"
          value={at(x)}
          aria-valuetext={`${fmt(x)}×${date ? `, ${date}` : ''}`}
          onChange={(e) => set(of(Number(e.target.value)))}
          onKeyDown={key}
        />
        <i className="lm-zones" style={{ background: zones(ev.target, ev.full, at) }} />
        <div className="lm-marks" ref={box}>
          {marks.map((m, i) => (
            <button
              type="button"
              key={m.preset.label}
              data-kind={m.kind}
              data-label={shown[i] || undefined}
              style={{ left: `${at(m.load) * 100}%` }}
              title={m.preset.label}
              aria-label={m.preset.label}
              aria-pressed={isOn(lm, m.preset)}
              onClick={() => lm.setValues(m.preset.values)}
            >
              <span>{m.text}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The scenarios and the load in one bar, above the diagram: the reader moves the load and watches what it does. It
 * stays in view while the page scrolls (under `--lm-sticky-top`, for a page's own fixed header); on a phone it sits
 * under the diagram, in thumb reach.
 */
export function LoadBar({ lm }: { lm: LoadmapController }) {
  return (
    <div className="lm-loadbar">
      <Scenarios lm={lm} />
      <LoadRange lm={lm} />
    </div>
  )
}

/**
 * The load slider (unless `load` is false: the page shows a `LoadBar`), the presets that set no load, and every
 * parameter, greyed out where it does not apply.
 */
export function Controls({ lm, load = true }: { lm: LoadmapController; load?: boolean }) {
  const { model, values, setValues, ev } = lm
  const v = values as Record<string, any>
  // a preset that sets the load is a mark on the slider
  const presets = ev.presets.filter((p) => !('load' in p.values))
  return (
    <div className="lm-card lm-controls">
      {load && <h3>Load</h3>}
      {load && <LoadRange lm={lm} />}
      {presets.length > 0 && (
        <div className="lm-presets">
          {presets.map((p) => (
            <button type="button" key={p.label} aria-pressed={isOn(lm, p)} onClick={() => setValues(p.values)}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      {model.params.length > 1 && <h3>Design</h3>}
      {model.params.map(({ id, def }) => {
        if (def.kind === 'load') return null
        const enabled = model.isEnabled(id, v)
        const tag = def.tag && (
          <span className="lm-tag" data-kind="estimated">
            {def.tag}
          </span>
        )
        if (def.kind === 'switch')
          return (
            <label className={`lm-switch${enabled ? '' : ' lm-off'}`} key={id}>
              <input
                type="checkbox"
                checked={Boolean(v[id])}
                disabled={!enabled}
                onChange={(e) => setValues({ [id]: e.target.checked } as any)}
              />
              <span>
                {def.label}
                {tag}
              </span>
              {def.hint && <small>{def.hint}</small>}
            </label>
          )
        if (def.kind === 'select')
          return (
            <label className={`lm-select${enabled ? '' : ' lm-off'}`} key={id}>
              <span>
                {def.label}
                {tag}
              </span>
              <select
                value={String(v[id])}
                disabled={!enabled}
                onChange={(e) => {
                  const opt = def.options.find((o: number | string) => String(o) === e.target.value)
                  setValues({ [id]: opt } as any)
                }}
              >
                {def.options.map((o: number | string) => (
                  <option key={String(o)} value={String(o)}>
                    {def.format ? def.format(o) : String(o)}
                  </option>
                ))}
              </select>
              {def.hint && <small>{def.hint}</small>}
            </label>
          )
        return (
          <label className={`lm-range${enabled ? '' : ' lm-off'}`} key={id}>
            <span>
              {def.label}
              {tag} <output>{def.format ? def.format(v[id]) : fmt(v[id])}</output>
            </span>
            <input
              type="range"
              min={def.min}
              max={def.max}
              step={def.step}
              value={v[id]}
              disabled={!enabled}
              onChange={(e) => setValues({ [id]: Number(e.target.value) } as any)}
            />
            {def.hint && <small>{def.hint}</small>}
          </label>
        )
      })}
    </div>
  )
}

/** What the model assumes: every capacity with its provenance, every fit, and anything the page adds. */
export function Assumptions({ lm, extra = [] }: { lm: LoadmapController; extra?: readonly ReactNode[] }) {
  return (
    <div className="lm-card">
      <h3>What this assumes</h3>
      <ul className="lm-facts">
        {extra.map((x, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the page's own list, in its order
          <li key={i}>{x}</li>
        ))}
        {lm.ev.assumptions.map((a) => (
          <li key={a.kind === 'capacity' ? `c:${a.component}` : `f:${a.name}`}>{describe(a)}</li>
        ))}
      </ul>
    </div>
  )
}

function describe(a: Assumption): ReactNode {
  if (a.kind === 'capacity') {
    const c = a.capacity
    return (
      <>
        <b>{a.name}:</b> {fmt(c.value)} {c.unit}
        {c.within ? ` ${plusMinus(c)}` : ''},{' '}
        <span className="lm-prov" data-kind={c.provenance}>
          {c.provenance}
        </span>
        {c.source ? ` (${c.source})` : ''}.
      </>
    )
  }
  const f = a.fit
  return (
    <>
      <b>{a.name}:</b> {f.y} = {sig(f.a)} + {sig(f.b)} × {f.x}, r² {f.r2.toFixed(3)} over {f.n} points,{' '}
      <span className="lm-prov" data-kind="measured">
        measured
      </span>
      {f.source ? ` (${f.source})` : ''}.
    </>
  )
}

/** Exact below 1,000 (3.9 cores), compact above (12k req/s). */
const num = (x: number) => (Math.abs(x) >= 1000 ? compact(x) : fmt(x))

const sig = (x: number) => Number(x.toPrecision(3)).toString()
