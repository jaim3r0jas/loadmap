import type { Evaluation, Model } from './model'
import type { LooseValues } from './params'

/** What a peak leaves in one queue. */
export interface Backlog<S extends string = string> {
  stage: S
  /** Units waiting when the peak ends, each flow's. */
  flows: Readonly<Record<string, number>>
  /** Units waiting, every flow's. */
  units: number
  /** Seconds its reader then needs to clear them at the default load; Infinity when it never does. */
  empties: number
  /** A queue with a size that the peak fills: the units it holds, and the seconds into the peak when it is full. */
  full?: { holds: number; after: number }
}

/**
 * What `lasts` seconds at these values leave in each queue whose reader cannot keep up, and how long the reader then
 * needs to clear it at the default load (the same design). The sim's own rules: a reader drains what reaches it at its
 * component's `full`, shared by every queue that feeds it; priority 1 first; a drop keeps none older than its limit,
 * and a merge clears more than the reader handles. A module of its own: only a panel reads it, never a first load.
 */
export function backlog<S extends string>(
  model: Model<any, string, string, S>,
  values: LooseValues,
  lasts: number,
): Backlog<S>[] {
  const evaluate = (v: LooseValues) => model.evaluate(v as never) as Evaluation
  const all = { ...model.defaults(), ...values }
  const priority = (f: string) => model.def.flows[f]?.priority ?? 1
  return backlogOf(
    evaluate,
    all,
    model.defaults().load as number,
    lasts,
    model.thresholds.full,
    priority,
  ) as Backlog<S>[]
}

/** A stage's drain a second, as the sim takes it: what reaches it at the load where its component runs out. */
function drainOf(
  evaluate: (v: LooseValues) => Evaluation,
  ev: Evaluation,
  d: string,
  full: number,
  atFull: Map<number, Evaluation>,
): number {
  const c = (ev.stages[d] as { component?: string } | undefined)?.component
  const r = c == null ? undefined : ev.components[c]
  if (!r || r.util == null || r.full == null || !Number.isFinite(r.full)) return Number.POSITIVE_INFINITY
  const sum = (e: Evaluation) => Object.values(e.at[d] ?? {}).reduce((a, x) => a + x, 0)
  if (!(r.full > 0)) return r.util > 0 ? (sum(ev) * full) / r.util : 0
  // one evaluation per load where something runs out, as the sim keeps them
  let at = atFull.get(r.full)
  if (!at) {
    at = evaluate({ ...ev.values, load: r.full })
    atFull.set(r.full, at)
  }
  return sum(at)
}

function backlogOf(
  evaluate: (v: LooseValues) => Evaluation,
  values: LooseValues,
  rest: number,
  lasts: number,
  full: number,
  priority: (f: string) => number,
): Backlog[] {
  if (!(lasts > 0 && Number.isFinite(lasts))) throw new Error(`loadmap: a peak lasts a time above 0, not ${lasts}`)
  const peak = evaluate(values)
  const after = evaluate({ ...values, load: rest })
  const fulls = new Map<Evaluation, Map<number, Evaluation>>([
    [peak, new Map()],
    [after, new Map()],
  ])
  // each flow's way through each queue, and the stage after it that drains it
  const entries: { q: string; f: string; d: string }[] = []
  for (const [q, st] of Object.entries(peak.stages))
    if (st.kind === 'queue')
      for (const f of Object.keys(peak.flows)) {
        const way = (peak.paths[f] ?? []).find((w) => w.stages.includes(q))
        if (way) entries.push({ q, f, d: way.stages[way.stages.indexOf(q) + 1] ?? '' })
      }
  const waiting = new Map<string, Record<string, number>>()
  const empties = new Map<string, number>()
  const fills = new Map<string, { holds: number; after: number }>()
  for (const d of new Set(entries.map((e) => e.d))) {
    const feeding = entries.filter((e) => e.d === d)
    // in the reader's own units: a merging flow takes 1 − share of its arrivals, the rest superseded by the newest
    const pass = (ev: Evaluation) => {
      const inflow = feeding.map((e) => ev.at[e.q]?.[e.f] ?? 0)
      const keep = feeding.map((e) => 1 - Math.min(0.95, Math.max(0, ev.overload[e.f]?.merge?.share ?? 0)))
      const need = inflow.map((x, i) => x * keep[i]!)
      const drain = d === '' ? Number.POSITIVE_INFINITY : drainOf(evaluate, ev, d, full, fulls.get(ev)!)
      return { inflow, keep, need, drain }
    }
    const p = pass(peak)
    // the reader serves priority 1 first; within a priority what it cannot take is shared as the arrivals are
    const over = new Array<number>(feeding.length).fill(0)
    let avail = p.drain
    const prio = (i: number) => priority(feeding[i]!.f)
    for (const pr of [...new Set(feeding.map((_, i) => prio(i)))].sort((x, y) => x - y)) {
      const group = feeding.map((_, i) => i).filter((i) => prio(i) === pr)
      const want = group.reduce((a, i) => a + p.need[i]!, 0)
      if (want > avail) for (const i of group) over[i] = ((want - avail) * p.need[i]!) / want / p.keep[i]!
      avail = Math.max(0, avail - want)
    }
    let left = 0
    let oldest = 0
    let dropsAll = true
    // a drop rule keeps none older than its limit
    const kept = feeding.map((e, i) => {
      const drop = peak.overload[e.f]?.drop
      return drop ? Math.min(over[i]! * lasts, p.inflow[i]! * drop.olderThan) : over[i]! * lasts
    })
    // and a queue with a size no more than it holds: what arrives once it is full is turned away
    const room = feeding.map((e) => {
      const holds = (peak.stages[e.q] as { holds?: number }).holds
      const all = feeding.reduce((a, x, i) => a + (x.q === e.q ? kept[i]! : 0), 0)
      if (holds == null || !(all > holds)) return 1
      const grows = feeding.reduce((a, x, i) => a + (x.q === e.q ? over[i]! : 0), 0)
      fills.set(e.q, { holds, after: holds / grows })
      return holds / all
    })
    feeding.forEach((e, i) => {
      const n = kept[i]! * room[i]!
      const drop = peak.overload[e.f]?.drop
      if (drop) oldest = Math.max(oldest, drop.olderThan)
      else if (n > 0) dropsAll = false
      const row = waiting.get(e.q) ?? {}
      row[e.f] = (row[e.f] ?? 0) + n
      waiting.set(e.q, row)
      left += n * p.keep[i]!
    })
    const a = pass(after)
    const clears = a.drain - a.need.reduce((x, y) => x + y, 0)
    let time = left === 0 ? 0 : clears > 0 ? left / clears : Number.POSITIVE_INFINITY
    // what waits longer than a drop rule allows is dropped, not cleared
    if (dropsAll && left > 0) time = Math.min(time, oldest)
    for (const e of feeding) empties.set(e.q, Math.max(empties.get(e.q) ?? 0, time))
  }
  return [...waiting]
    .map(([stage, flows]) => ({
      stage,
      flows,
      units: Object.values(flows).reduce((a, x) => a + x, 0),
      empties: empties.get(stage) ?? 0,
      ...(fills.has(stage) ? { full: fills.get(stage)! } : {}),
    }))
    .filter((b) => b.units > 0)
}
