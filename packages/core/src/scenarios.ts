import { around, joinAnd, multiple, pct } from './format'
import type { ComponentResult, Model, Scenario, Verdict } from './model'
import type { LooseValues, Values } from './params'

/** One component in one scenario, against the baseline. */
export interface ComponentChange<C extends string = string> {
  id: C
  name: string
  /** The load multiple at the target; null when switched off. */
  target: number | null
  full: number | null
  /** This scenario's target multiple ÷ the baseline's: 2 is twice the headroom. Null when either is off. */
  change: number | null
}

export interface ScenarioRow<P = any, C extends string = string> {
  label: string
  /** The scenario's values at the compared load. */
  values: Values<P>
  firstLimit: ComponentResult<C> | null
  firstFull: ComponentResult<C> | null
  /** Where the first limit reaches the target, and when, with growth. */
  target: number | null
  targetDate: Date | null
  /** Where the first component reaches 100 %, and when. */
  full: number | null
  fullDate: Date | null
  verdict: Verdict
  /** Every component, in the model's order. */
  components: readonly ComponentChange<C>[]
}

export interface Comparison<P = any, C extends string = string> {
  /** The scenarios in declaration order; the first is the baseline. */
  rows: readonly ScenarioRow<P, C>[]
  /** The scenario whose target holds the longest (then: runs out last); null with fewer than two or a tie. */
  best: ScenarioRow<P, C> | null
  /** One sentence: which buys more headroom. Empty with fewer than two scenarios. */
  text: string
}

/** Every declared scenario at this load, side by side: first limit, multiples, dates and the change per component. */
export function compare<P, C extends string>(model: Model<P, string, C>, load = model.load.default): Comparison<P, C> {
  const evs = model.scenarios.map((s) => ({ s, ev: model.evaluate({ ...s.values, load } as Partial<Values<P>>) }))
  const base = evs[0]?.ev
  const rows = evs.map(({ s, ev }): ScenarioRow<P, C> => {
    const target = ev.firstLimit?.target ?? null
    const full = ev.firstFull?.full ?? null
    return {
      label: s.label,
      values: ev.values,
      firstLimit: ev.firstLimit,
      firstFull: ev.firstFull,
      target,
      targetDate: model.dateAt(target),
      full,
      fullDate: model.dateAt(full),
      verdict: ev.verdict,
      components: model.componentIds.map((c) => {
        const r = ev.components[c]
        return {
          id: c,
          name: r.name,
          target: r.target,
          full: r.full,
          change: ratio(r.target, base!.components[c].target),
        }
      }),
    }
  })
  if (rows.length < 2) return { rows, best: null, text: '' }

  const th = pct(model.thresholds.target)
  const at = (x: number | null, d: Date | null) => `${multiple(x, model.searchMax)}${d ? ` (${around(d)})` : ''}`
  const upTo = (r: ScenarioRow<P, C>) => at(r.target, r.targetDate)
  // the target first; between equal targets, the one that runs out later
  const order = (x: number | null) => (x == null ? Number.NEGATIVE_INFINITY : x)
  const sameTarget = (a: ScenarioRow<P, C>, b: ScenarioRow<P, C>) => order(a.target) === order(b.target)
  const better = (a: ScenarioRow<P, C>, b: ScenarioRow<P, C>) =>
    order(a.target) > order(b.target) || (sameTarget(a, b) && order(a.full) > order(b.full))
  const top = rows.reduce((a, b) => (better(b, a) ? b : a))
  const leaders = rows.filter((r) => !better(top, r))
  if (leaders.length === rows.length)
    return { rows, best: null, text: `Every scenario holds the ${th} target up to ${upTo(top)}.` }
  const more = rows.length > 2 ? 'the most' : 'more'
  const against = joinAnd(
    rows
      .filter((r) => !leaders.includes(r))
      .map((r) =>
        sameTarget(r, top)
          ? `${upTo(r)} in ${r.label} (runs out at ${at(r.full, r.fullDate)})`
          : `${upTo(r)} in ${r.label}`,
      ),
  )
  if (leaders.length > 1)
    return {
      rows,
      best: null,
      text: `${joinAnd(leaders.map((r) => r.label))} buy the most headroom: the ${th} target holds up to ${upTo(top)}, against ${against}.`,
    }
  const by = top.firstLimit ? `, limited by ${top.firstLimit.short}` : ''
  const later = rows.some((r) => r !== top && sameTarget(r, top))
    ? `${by ? ',' : ''} and runs out at ${at(top.full, top.fullDate)}`
    : ''
  return {
    rows,
    best: top,
    text: `${top.label} buys ${more} headroom: the ${th} target holds up to ${upTo(top)}${by}${later}, against ${against}.`,
  }
}

/** x ÷ base, where a crossing that never comes is larger than any that does. */
function ratio(x: number | null, base: number | null | undefined): number | null {
  if (x == null || base == null) return null
  if (!Number.isFinite(base)) return Number.isFinite(x) ? 0 : 1
  if (!Number.isFinite(x)) return Number.POSITIVE_INFINITY
  if (base === 0) return x === 0 ? 1 : Number.POSITIVE_INFINITY
  return x / base
}

/** A line of the headroom chart: [load multiple, utilization] pairs; null where the component is off. */
export type Series = readonly (readonly [number, number | null])[]

export interface HeadroomLine<C extends string = string> {
  /** The scenario's label; null for values that match no scenario. */
  label: string | null
  /** Whether these are the values the page shows. */
  selected: boolean
  /** The highest utilization of any component at each load: the line that crosses where the first limit does. */
  envelope: Series
  /** Exactly where the envelope reaches the target and 100 %: the first limit's crossings, not read off the line. */
  target: number | null
  full: number | null
  /** Each component's own line. */
  components: readonly { id: C; name: string; points: Series; target: number | null; full: number | null }[]
}

export interface Headroom<C extends string = string> {
  /** The load range of the x axis. */
  from: number
  to: number
  /** The shown values' load: a marker on the chart. */
  load: number
  /** Every scenario, plus the shown values when they match none (first, so the selected line is always there). */
  lines: readonly HeadroomLine<C>[]
}

/**
 * Utilization over the load multiple, for each scenario and the shown values: what the headroom chart draws. The
 * axis runs from 1× (or the load's minimum, if lower) to a quarter past the last scenario runs out, within the load
 * slider's range at least and the search at most. Samples are geometric, as the axis is.
 */
export function headroom<P, C extends string>(
  model: Model<P, string, C>,
  values: Partial<Values<P>> = {},
  o: { samples?: number } = {},
): Headroom<C> {
  const shown = { ...model.defaults(), ...values } as Values<P>
  const sets: { label: string | null; values: LooseValues }[] = model.scenarios.map((s: Scenario<P>) => ({
    label: s.label,
    values: { ...s.values, load: shown.load },
  }))
  const match = model.scenarioOf(shown)
  if (!match) sets.unshift({ label: null, values: shown })
  const evs = sets.map((s) => ({ ...s, ev: model.evaluate(s.values as Partial<Values<P>>) }))

  const from = Math.max(0.1, Math.min(1, model.load.min))
  const ends = evs.map((e) => e.ev.firstFull?.full).filter((x): x is number => x != null && Number.isFinite(x))
  const to = Math.min(model.searchMax, Math.max(model.load.max, ...ends.map((x) => x * 1.25)))
  const n = Math.max(2, o.samples ?? 120)
  const xs = Array.from({ length: n }, (_, i) => from * (to / from) ** (i / (n - 1)))

  const lines = evs.map(({ label, values: v, ev }): HeadroomLine<C> => {
    const at = xs.map((x) => model.utilization({ ...v, load: x } as Partial<Values<P>>))
    const components = model.componentIds.map((c) => ({
      id: c,
      name: ev.components[c].name,
      points: xs.map((x, i) => [x, at[i]![c]] as const),
      target: ev.components[c].target,
      full: ev.components[c].full,
    }))
    const envelope = xs.map((x, i) => {
      const live = Object.values(at[i]!).filter((u): u is number => u != null)
      return [x, live.length ? Math.max(...live) : null] as const
    })
    return {
      label,
      selected: label == null || label === match?.label,
      envelope,
      target: ev.firstLimit?.target ?? null,
      full: ev.firstFull?.full ?? null,
      components,
    }
  })
  return { from, to, load: shown.load, lines }
}
