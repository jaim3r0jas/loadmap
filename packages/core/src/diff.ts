import type { CrossingRange } from './capacity'
import { fmt, monthOf, multiple, pct } from './format'
import type { ComponentResult, Model } from './model'
import type { Values } from './params'

/** How much headroom a change may lose before it fails: a share of the base's (0.1), or load multiples (0.5). */
export type Tolerance = { share: number } | { times: number }

/** One side of a change: where its first limit is, at the defaults, on the pessimistic edge. */
export interface DefinitionSide {
  firstLimit: { id: string; name: string } | null
  /** The load multiple at the target and at 100 %, at every capacity's low bound; Infinity when never. */
  target: number | null
  full: number | null
  targetDate: Date | null
  fullDate: Date | null
}

/** One component, before and after. Null on a side that does not have it (or has it switched off). */
export interface ComponentDiff {
  id: string
  name: string
  base: ComponentSide | null
  head: ComponentSide | null
  /** head ÷ base headroom to the target: 0.8 lost a fifth. Null when either side is missing. */
  change: number | null
}

export interface ComponentSide {
  /** Utilization at today’s load (1×). */
  util: number | null
  target: CrossingRange | null
  full: CrossingRange | null
}

/** What makes a change fail: lost headroom, a first limit that moved, a threshold crossed from below. */
export interface Trigger {
  kind: 'headroom' | 'first-limit' | 'crosses'
  /** The component it is about, to annotate its line. */
  component: string | null
  text: string
}

export interface DefinitionChange {
  base: DefinitionSide
  head: DefinitionSide
  components: readonly ComponentDiff[]
  triggers: readonly Trigger[]
  /** One sentence: where the first limit was and is, and when it runs out. */
  text: string
}

/**
 * A change of a definition against its base, both at their defaults and at today’s load: what moved, and what makes
 * it fail. It fails when the first limit's headroom drops by more than the tolerance (10 % by default), when the first
 * limit moves to another component without more headroom, or when a component crosses the target or 100 % from below
 * at today’s load: a design already over its limit does not block every later change again.
 */
export function compareDefinitions(base: Model, head: Model, o: { tolerance?: Tolerance } = {}): DefinitionChange {
  const tolerance = o.tolerance ?? { share: 0.1 }
  const b = base.evaluate()
  const h = head.evaluate()
  // today: the load the model calls 1×
  const today = (m: Model) => m.evaluate({ load: 1 } as Partial<Values<unknown>>)
  const bt = today(base)
  const ht = today(head)
  const side = (m: Model, ev: ReturnType<Model['evaluate']>): DefinitionSide => {
    const target = ev.target?.low ?? null
    const full = ev.full?.low ?? null
    return {
      firstLimit: ev.firstLimit ? { id: ev.firstLimit.id, name: ev.firstLimit.name } : null,
      target,
      full,
      targetDate: m.dateAt(target),
      fullDate: m.dateAt(full),
    }
  }
  const B = side(base, b)
  const H = side(head, h)
  const comp = (ev: ReturnType<Model['evaluate']>, now: ReturnType<Model['evaluate']>, id: string) => {
    const c = ev.components[id] as ComponentResult | undefined
    if (!c || c.util == null) return null
    return {
      util: (now.components[id] as ComponentResult | undefined)?.util ?? null,
      target: c.targetRange,
      full: c.fullRange,
    }
  }
  const ids = [...new Set([...head.componentIds, ...base.componentIds])]
  const components: ComponentDiff[] = ids.map((id) => {
    const bs = comp(b, bt, id)
    const hs = comp(h, ht, id)
    const name = ((h.components[id] ?? b.components[id]) as ComponentResult).name
    return { id, name, base: bs, head: hs, change: bs && hs ? ratio(hs.target?.low, bs.target?.low) : null }
  })

  const searchMax = head.searchMax
  const x = (v: number | null) => multiple(v, searchMax)
  const triggers: Trigger[] = []
  const lost = loss(B.target, H.target)
  if (lost && exceeds(lost, tolerance))
    triggers.push({
      kind: 'headroom',
      component: H.firstLimit?.id ?? null,
      text: `the ${pct(head.thresholds.target)} target holds up to ${x(H.target)} instead of ${x(B.target)}: ${describe(lost)}, more than the ${describeTolerance(tolerance)} allowed`,
    })
  // nothing reaches the target on either side: which component is "first" is only the order they are written in
  const reaches = (v: number | null) => v != null && Number.isFinite(v)
  const either = reaches(B.target) || reaches(H.target)
  if (either && B.firstLimit && H.firstLimit && B.firstLimit.id !== H.firstLimit.id && !gains(B.target, H.target))
    triggers.push({
      kind: 'first-limit',
      component: H.firstLimit.id,
      text: `the first limit moves from ${B.firstLimit.name} to ${H.firstLimit.name}`,
    })
  for (const c of components) {
    if (!c.base || !c.head || c.base.util == null || c.head.util == null) continue
    for (const [name, at] of [
      [`the ${pct(head.thresholds.target)} target`, head.thresholds.target],
      [pct(head.thresholds.full), head.thresholds.full],
    ] as const)
      if (c.base.util < at && c.head.util >= at)
        triggers.push({
          kind: 'crosses',
          component: c.id,
          text: `${c.name} crosses ${name} at today’s load: ${pct(c.base.util)} → ${pct(c.head.util)}`,
        })
  }

  const when = (d: Date | null) => (d ? monthOf(d) : null)
  const runsOut =
    when(B.fullDate) && when(H.fullDate) && when(B.fullDate) !== when(H.fullDate)
      ? `, and runs out in ${when(H.fullDate)} instead of ${when(B.fullDate)}`
      : ''
  const text =
    !B.firstLimit || !H.firstLimit || !either
      ? 'Nothing reaches the target at either side.'
      : B.firstLimit.id !== H.firstLimit.id
        ? `The first limit moves from ${B.firstLimit.name} at ${x(B.target)} to ${H.firstLimit.name} at ${x(H.target)}${runsOut}.`
        : B.target === H.target
          ? `${H.firstLimit.name} stays the first limit, at ${x(H.target)}.`
          : `${H.firstLimit.name} stays the first limit, now at ${x(H.target)} instead of ${x(B.target)}${runsOut}.`
  return { base: B, head: H, components, triggers, text }
}

/** Headroom lost from base to head, as a share of the base's and in multiples; null when nothing is lost. */
function loss(base: number | null, head: number | null): { share: number; times: number } | null {
  if (base == null || head == null || head >= base) return null
  // a crossing that never came and now does: everything is lost
  if (!Number.isFinite(base)) return { share: 1, times: Number.POSITIVE_INFINITY }
  return { share: base > 0 ? (base - head) / base : 1, times: base - head }
}

const gains = (base: number | null, head: number | null) => base != null && head != null && head > base

function exceeds(l: { share: number; times: number }, t: Tolerance): boolean {
  return 'share' in t ? l.share > t.share + 1e-9 : l.times > t.times + 1e-9
}

const describe = (l: { share: number; times: number }) =>
  Number.isFinite(l.times) ? `${pct(l.share)} less (${fmt(l.times)}× fewer)` : 'all of it lost'

const describeTolerance = (t: Tolerance) => ('share' in t ? pct(t.share) : `${fmt(t.times)}×`)

/** x ÷ base, where a crossing that never comes is larger than any that does. */
function ratio(x: number | null | undefined, base: number | null | undefined): number | null {
  if (x == null || base == null) return null
  if (!Number.isFinite(base)) return Number.isFinite(x) ? 0 : 1
  if (!Number.isFinite(x)) return Number.POSITIVE_INFINITY
  if (base === 0) return x === 0 ? 1 : Number.POSITIVE_INFINITY
  return x / base
}
