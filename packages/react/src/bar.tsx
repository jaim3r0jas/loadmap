import type { Capacity, CrossingRange, Model, Preset } from '@loadmap/core'
import { fmt, monthOf, pct } from '@loadmap/core/format'
import { type CSSProperties, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { labelled, loadScale, marksOf, zones } from './track'
import type { LoadmapController } from './useLoadmap'

// What a page draws first: the scenarios, the load, and the small things they and the verdict's line share. The
// panels (panels.tsx, scenarios.tsx) are a module apart, so a page that opens none never loads them.

/** Scenario identity colours, in declaration order; a fifth and later scenario is drawn muted. */
const SERIES = ['var(--lm-s1)', 'var(--lm-s2)', 'var(--lm-s3)', 'var(--lm-s4)']

/** The colour of a scenario by label; values of the reader's own are drawn in the text colour. */
export function scenarioColor(model: Model, label: string | null): string {
  if (label == null) return 'var(--lm-fg)'
  const i = model.scenarios.findIndex((s) => s.label === label)
  return SERIES[i] ?? 'var(--lm-muted)'
}

/** A month for a table cell or an axis: "Mar 2031"; "now" for a crossing already reached. */
export function when(model: Model, x: number | null): string {
  const d = model.dateAt(x)
  return d ? monthOf(d, true) : x != null && x <= 1 && model.growth ? 'now' : ''
}

/** The months of both edges: "Sep 2029–Feb 2030", or one month when they agree. */
export function whenRange(model: Model, r: CrossingRange | null): string {
  if (!r) return ''
  const [lo, hi] = [when(model, r.low), when(model, r.high)]
  return !hi || lo === hi ? lo : `${lo}–${hi}`
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

/** The size of an element in CSS pixels, kept current: a chart draws at its own size so text stays legible. */
export function useSize<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: fallback, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const width = Math.round(e?.contentRect.width ?? el.clientWidth)
      const height = Math.round(e?.contentRect.height ?? el.clientHeight)
      if (width > 0) setSize((s) => (s.width === width && s.height === height ? s : { width, height }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

/** "±30 %" for a capacity with a range; "−30 %" for a best case, which a range only lowers. */
export const plusMinus = (c: Capacity | null) => (c?.within ? `${c.ceiling ? '−' : '±'}${pct(c.within)}` : '')

/** A preset's values are the shown ones. */
export const isOn = (lm: LoadmapController, p: Preset<any>) =>
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

/** A model has a design to change: a parameter beside the load, or a preset that sets no load. */
export const hasDesign = (lm: LoadmapController) =>
  lm.model.params.length > 1 || lm.ev.presets.some((p) => !('load' in p.values))
