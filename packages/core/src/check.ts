import type { CrossingRange } from './capacity'
import { duration, fmt, multiples, pct } from './format'
import { PERCENTILES } from './latency'
import { type ComponentResult, crossing, type Model, sureness } from './model'
import type { Values } from './params'

/**
 * Something that must keep holding, as minimum load multiples on the pessimistic edge (every capacity at its low
 * bound): a change that loses headroom fails it.
 */
export interface Expectation<C extends string = string> {
  /** Names it in a failure: "Today keeps 7×". */
  label?: string
  /** The scenario whose values it checks; the defaults without one. */
  scenario?: string
  /** One component; the first limit without one. */
  component?: C
  /** The target holds up to at least this multiple. */
  target?: number
  /** Nothing runs out (or this component does not) before this multiple. */
  full?: number
  /**
   * One flow's latency: its p50, p95 or p99 (one of them, in seconds) stays under this up to `target`, or at the
   * scenario's values without one.
   */
  flow?: string
  p50?: number
  p95?: number
  p99?: number
  /** A warning is reported but never fails a check run (`loadmap check`); default fail. */
  severity?: 'warn' | 'fail'
}

/**
 * pass: it holds. fail: it does not, on every capacity's range. inconclusive: the answer rests on data that is not
 * there (a measurement missing or too thin, no published benchmark), or it holds at the high edge of a ± but not at
 * the low one.
 */
export type Outcome = 'pass' | 'fail' | 'inconclusive'

export interface CheckResult<C extends string = string> {
  expectation: Expectation<C>
  /** It holds on the pessimistic edge: `outcome` is pass. */
  ok: boolean
  outcome: Outcome
  /** Why it is inconclusive: each missing piece of data, or the ± that decides it. Empty otherwise. */
  reasons: string[]
  /** What was found: where the target and 100 % are reached, at the low and the high bounds; null when off. */
  target: CrossingRange | null
  full: CrossingRange | null
  /** One sentence: what holds, or what was expected and what was found. */
  message: string
}

/** Tests a model's expectations (or these) on the pessimistic edge. */
export function check<P, C extends string>(
  model: Model<P, string, C>,
  expectations: readonly Expectation<C>[] = model.expectations,
): CheckResult<C>[] {
  // measurements the snapshot has no value for: each counts once, for what reads it
  const gaps = Object.entries(model.def.snapshot?.measurements ?? {}).filter(([, m]) => m.missing != null)
  return expectations.map((e) => {
    const scenario = e.scenario == null ? null : model.scenarios.find((s) => s.label === e.scenario)
    if (e.scenario != null && !scenario) throw new Error(`loadmap: no scenario "${e.scenario}"`)
    const ev = model.evaluate(scenario?.values as Partial<Values<P>> | undefined)
    const c = e.component == null ? null : ev.components[e.component]
    if (e.component != null && !c) throw new Error(`loadmap: no component "${e.component}"`)
    const where = scenario ? ` in ${scenario.label}` : ''
    if (e.flow != null || PERCENTILES.some((q) => e[q] != null))
      return latencyCheck(model, e, scenario?.values ?? {}, ev, where, gaps)
    const range = (k: 'target' | 'full') => (c ? c[`${k}Range`] : ev[k])
    const found = { target: range('target'), full: range('full') }

    const all = Object.values<ComponentResult<C>>(ev.components)
    const scope = c ? [c] : all
    // a component without a published figure is not ranked: it may only run out sooner, so a failure stays one
    const unknown = scope.filter((x) => x.missing != null)
    const none = unknown
      .map((x) => `${x.short} ${x.plural ? 'have' : 'has'} no published benchmark ${x.missing}${where}`)
      .join('; ')
    // measured data that is missing may move the answer either way: a capacity counts for its component, any other
    // measurement (a rate, a share) for everything
    const read = new Set(all.flatMap((x) => (x.capacity?.measure ? [x.capacity.measure] : [])))
    const unread = new Set<string>()
    for (const x of scope) if (x.capacity?.unread) unread.add(`${x.short}: ${x.capacity.unread}`)
    for (const [name, m] of gaps) if (!read.has(name)) unread.add(`${name}: ${m.missing}`)
    const data = [...unread]
    const benchmarks = unknown.map((x) => `${x.short}: no published benchmark ${x.missing}`)
    if (c && unknown.length) return result(e, 'inconclusive', [...benchmarks, ...data], found, none)
    if (c && c.util == null)
      return result(e, data.length ? 'inconclusive' : 'pass', data, found, `${c.short} is switched off${where}`)
    const claims: { at: 'pass' | 'edge' | 'fail'; text: string; min: number }[] = []
    const r = (x: CrossingRange | null) => (x ? multiples(x, model.searchMax) : 'never')
    const target = `the ${pct(model.thresholds.target)} target`
    // holds at the low edge, only at the high edge of a ±, or at neither
    const at = (x: CrossingRange | null, min: number) => {
      const low = x?.low ?? Number.POSITIVE_INFINITY
      const high = x?.high ?? Number.POSITIVE_INFINITY
      return low >= min ? 'pass' : high >= min ? 'edge' : 'fail'
    }
    if (e.target != null) {
      const by = c ?? ev.firstLimit
      claims.push({
        at: at(found.target, e.target),
        min: e.target,
        text: c
          ? `${c.short} reaches ${target} at ${r(found.target)}${where}${sureness(c.capacity)}`
          : `${target} holds up to ${r(found.target)}${where}${by ? `, limited by ${by.short}${sureness(by.capacity)}` : ''}`,
      })
    }
    if (e.full != null) {
      const by = c ?? ev.firstFull
      claims.push({
        at: at(found.full, e.full),
        min: e.full,
        text: by
          ? `${by.short} ${by.plural ? 'run' : 'runs'} out at ${r(found.full)}${where}${sureness(by.capacity)}`
          : `nothing runs out${where}`,
      })
    }
    const failed = claims.filter((x) => x.at !== 'pass')
    const message = failed.length
      ? failed.map((x) => `expected at least ${fmt(x.min)}×, but ${x.text}`).join('; ')
      : claims.map((x) => x.text).join('; ')
    const edges = claims
      .filter((x) => x.at === 'edge')
      .map((x) => `holds at ${fmt(x.min)}× only at the high edge of a ±`)
    const outcome: Outcome =
      claims.some((x) => x.at === 'fail') && !data.length
        ? 'fail'
        : data.length || edges.length || benchmarks.length
          ? 'inconclusive'
          : 'pass'
    // what the ranked components show still says how much headroom is left
    return result(
      e,
      outcome,
      outcome === 'fail' ? [] : [...benchmarks, ...data, ...edges],
      found,
      unknown.length ? `${none}; among the rest, ${message}` : message,
    )
  })
}

/** A flow's percentile against a time: at the values, or up to `target` on every capacity's range. */
function latencyCheck<P, C extends string>(
  model: Model<P, string, C>,
  e: Expectation<C>,
  values: object,
  ev: ReturnType<Model<P, string, C>['evaluate']>,
  where: string,
  gaps: readonly [string, { missing?: string }][],
): CheckResult<C> {
  const qs = PERCENTILES.filter((q) => e[q] != null)
  const f = e.flow
  if (f == null || qs.length !== 1)
    throw new Error('loadmap: a latency expectation names a flow and one of p50, p95 or p99')
  if (e.component != null || e.full != null)
    throw new Error(`loadmap: an expectation on the latency of "${f}" takes no component and no full`)
  if (!model.flowIds.includes(f)) throw new Error(`loadmap: no flow "${f}"`)
  const q = qs[0]!
  const under = e[q]!
  const name = `the ${q} of ${model.def.flows[f]?.label ?? f}`
  const none = () =>
    result(e, 'fail', [], { target: null, full: null }, `"${f}" has no latency: no stage on its way has a service time`)
  const load = ev.values.load
  const now = ev.latency[f]
  if (!now) return none()
  const at = (bound: 'low' | 'high', l: number) =>
    model.latency({ ...values, load: l } as Partial<Values<P>>, bound, [f])[f]?.[q] ?? Number.NaN
  // measured data that is missing may move the answer either way: a capacity on its way, or any other reading
  const all = Object.values<ComponentResult<C>>(ev.components)
  const onWay = new Set(
    (ev.paths[f] ?? []).flatMap((w) => w.stages.map((s) => (ev.stages[s] as { component?: string }).component)),
  )
  const read = new Set(all.flatMap((x) => (x.capacity?.measure ? [x.capacity.measure] : [])))
  const data = [
    ...all.filter((x) => onWay.has(x.id) && x.capacity?.unread).map((x) => `${x.short}: ${x.capacity!.unread}`),
    ...gaps.filter(([n]) => !read.has(n)).map(([n, m]) => `${n}: ${m.missing}`),
    ...(now.unknown ?? []).map((c) => `${c}: its time is not known, so it counts as none`),
  ]
  const verdict = (low: boolean, high: boolean): Outcome =>
    !high && !data.length ? 'fail' : data.length || !low ? 'inconclusive' : 'pass'
  const reasons = (outcome: Outcome, edge: string[]) => (outcome === 'fail' ? [] : [...data, ...edge])
  if (e.target == null) {
    const [low, high] = [at('low', load), at('high', load)]
    const outcome = verdict(low <= under, high <= under)
    // the wording says what the pessimistic edge shows; the outcome says how sure it is
    const message =
      low <= under
        ? `${name} is ${duration(low)} at ${fmt(load)}×${where}, under ${duration(under)}`
        : `expected ${name} under ${duration(under)}, but it is ${duration(low)} at ${fmt(load)}×${where}`
    const edge = low > under && high <= under ? ['holds only at the high edge of a ±'] : []
    return result(e, outcome, reasons(outcome, edge), { target: null, full: null }, message)
  }
  const max = model.searchMax
  const cross = (bound: 'low' | 'high') => crossing((l) => at(bound, l) / under, 1, max) ?? Number.POSITIVE_INFINITY
  const range = { low: cross('low'), high: cross('high') }
  const outcome = verdict(range.low >= e.target, range.high >= e.target)
  const found = Number.isFinite(range.low) ? multiples(range, max) : `past ${fmt(max)}×`
  const message =
    range.low >= e.target
      ? `${name} stays under ${duration(under)} ${Number.isFinite(range.low) ? 'up to ' : ''}${found}${where}`
      : `expected at least ${fmt(e.target)}×, but ${name} passes ${duration(under)} at ${found}${where}`
  const edge =
    range.low < e.target && range.high >= e.target ? [`holds at ${fmt(e.target)}× only at the high edge of a ±`] : []
  return result(e, outcome, reasons(outcome, edge), { target: range, full: null }, message)
}

function result<C extends string>(
  expectation: Expectation<C>,
  outcome: Outcome,
  reasons: string[],
  found: { target: CrossingRange | null; full: CrossingRange | null },
  message: string,
): CheckResult<C> {
  return { expectation, ok: outcome === 'pass', outcome, reasons, ...found, message }
}

/**
 * Throws when an expectation fails, listing every failure: one line in a Vitest (or any) test.
 *
 *     it('keeps its headroom', () => assertHolds(checkout))
 */
export function assertHolds<P, C extends string>(
  model: Model<P, string, C>,
  expectations: readonly Expectation<C>[] = model.expectations,
): void {
  const results = check(model, expectations)
  const failed = results.filter((r) => !r.ok)
  if (!failed.length) return
  const name = (r: CheckResult<C>) => (r.expectation.label ? `${r.expectation.label}: ` : '')
  throw new Error(
    `${failed.length} of ${results.length} expectations failed:\n${failed.map((r) => `- ${name(r)}${r.message}`).join('\n')}`,
  )
}
