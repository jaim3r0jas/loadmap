import { backlog } from './backlog'
import type { Bound, CrossingRange } from './capacity'
import { duration, fmt, multiple, multiples, pct, period } from './format'
import { PERCENTILES } from './latency'
import {
  type ComponentResult,
  crossing,
  expectationNamed,
  type Lost,
  type Model,
  multipleAfter,
  reach,
  sureness,
} from './model'
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
  /** A failure domain with one part out (the `down` control): N−1, on top of the scenario's values. */
  down?: string
  /** One component; the first limit without one. */
  component?: C
  /** Every component (or this one) stays under the target utilization up to at least this multiple. */
  underTarget?: number
  /** Nothing runs out (or this component does not) before this multiple. */
  notFull?: number
  /**
   * Nothing runs out (or this component does not) for this many seconds from `growth.asOf`: the load the growth
   * reaches then is its `notFull`. It needs growth.
   */
  lasts?: number
  /** @deprecated `underTarget`: a target is a utilization everywhere else. */
  target?: number
  /** @deprecated `notFull`. */
  full?: number
  /**
   * One flow's latency: its p50, p95 or p99 (one of them, in seconds) stays under this up to `underTarget`, or at the
   * scenario's values without one.
   */
  flow?: string
  p50?: number
  p95?: number
  p99?: number
  /**
   * What is lost for good, as a share of what a flow sends: it stays at or under this up to `underTarget`, or at the
   * scenario's values without one. One flow with `flow`, every flow without.
   */
  lost?: number
  /**
   * With `flow`, and `lost` or a percentile: a stage on one of the flow's fan-out branches. The expectation then holds
   * that branch up to the stage, the copies it loses or the time they take from the fan-out, not the flow itself.
   */
  to?: string
  /**
   * A moment: a preset that `lasts`. With `lag` or `clears`, what that long at the preset's values (on top of the
   * scenario's) leaves in the queues.
   */
  preset?: string
  /** With `preset`: one queue; every queue without. */
  queue?: string
  /** When the moment ends, the oldest unit waiting has waited at most this many seconds. */
  lag?: number
  /** After the moment, at the default load, the queues are empty again within this many seconds. */
  clears?: number
  /**
   * A budget: what the components with a cost cost a month stays at or under this, at the scenario's values, or at
   * `underTarget` with one (an autoscaled pool costs what it runs at that load).
   */
  cost?: number
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
  return expectations.map((written) => {
    const named = expectationNamed(written)
    // a time to last is the load growth reaches then, as defineModel reads it for the model's own
    const moment = named.preset != null || named.queue != null || named.lag != null || named.clears != null
    if (!moment && named.lasts != null && named.notFull == null && !model.growth)
      throw new Error('loadmap: an expectation holds a time (lasts): the model needs growth')
    const e =
      !moment && named.lasts != null && named.notFull == null && model.growth
        ? { ...named, notFull: multipleAfter(model.growth, named.lasts) }
        : named
    const scenario = e.scenario == null ? null : model.scenarios.find((s) => s.label === e.scenario)
    if (e.scenario != null && !scenario) throw new Error(`loadmap: no scenario "${e.scenario}"`)
    // a domain with named parts: any one of them out, so the worst of them speaks
    const parts =
      e.down == null
        ? undefined
        : (model.def.domains as Record<string, { parts?: object }> | undefined)?.[e.down]?.parts
    if (e.down != null && parts && Object.hasOwn(model.def.domains ?? {}, e.down)) {
      // a model that declares its own Outage control may leave a part out of it: that one cannot be taken out
      const options = (model.params.find((x) => x.id === 'down')?.def as { options?: readonly unknown[] } | undefined)
        ?.options
      const each = Object.keys(parts)
        .filter((part) => options?.includes(part) ?? true)
        .map((part) => check(model, [{ ...written, down: part }])[0]!)
      if (!each.length) throw new Error(`loadmap: no part of "${e.down}" to take out`)
      const rank = { fail: 0, inconclusive: 1, pass: 2 } as const
      const low = (r: CheckResult<C>) => r.target?.low ?? r.full?.low ?? Number.POSITIVE_INFINITY
      const worst = each.reduce((a, b) =>
        rank[b.outcome] < rank[a.outcome] || (rank[b.outcome] === rank[a.outcome] && low(b) < low(a)) ? b : a,
      )
      return { ...worst, expectation: named }
    }
    const outage = e.down == null ? undefined : model.params.find((x) => x.id === 'down')?.def
    if (e.down != null && !(outage?.kind === 'select' && e.down !== 'none' && outage.options.includes(e.down)))
      throw new Error(`loadmap: no domain "${e.down}" to take a part of out`)
    const values = e.down == null ? scenario?.values : { ...scenario?.values, down: e.down }
    const ev = model.evaluate(values as Partial<Values<P>> | undefined)
    const c = e.component == null ? null : ev.components[e.component]
    if (e.component != null && !c) throw new Error(`loadmap: no component "${e.component}"`)
    const down =
      outage?.kind === 'select' && e.down != null ? ` with ${outage.format?.(e.down) ?? `${e.down} down`}` : ''
    const where = (scenario ? ` in ${scenario.label}` : '') + down
    if (e.cost != null) return costCheck(model, e, values ?? {}, where)
    if (moment) return momentCheck(model, e, values ?? {}, where, gaps)
    if (e.lost != null) return lostCheck(model, e, values ?? {}, ev, where, gaps)
    if (e.flow != null || PERCENTILES.some((q) => e[q] != null))
      return latencyCheck(model, e, values ?? {}, ev, where, gaps)
    const range = (k: 'target' | 'full') => (c ? c[`${k}Range`] : ev[k])
    const found = { target: range('target'), full: range('full') }

    const all = Object.values<ComponentResult<C>>(ev.components)
    const scope = c ? [c] : all
    // a component without a published figure is not ranked: it may only run out sooner, so a failure stays one
    // and a stock that grows with no growth to date it is not ranked either
    const unknown = scope.filter((x) => x.missing != null || x.stock?.undated)
    const why = (x: ComponentResult<C>) =>
      x.missing != null ? `no published benchmark ${x.missing}` : 'no growth to say when it fills'
    const none = unknown.map((x) => `${x.short} ${x.plural ? 'have' : 'has'} ${why(x)}${where}`).join('; ')
    // measured data that is missing may move the answer either way: a capacity counts for its component, any other
    // measurement (a rate, a share) for everything
    const read = new Set(all.flatMap((x) => (x.capacity?.measure ? [x.capacity.measure] : [])))
    const unread = new Set<string>()
    for (const x of scope) if (x.capacity?.unread) unread.add(`${x.short}: ${x.capacity.unread}`)
    for (const [name, m] of gaps) if (!read.has(name)) unread.add(`${name}: ${m.missing}`)
    const data = [...unread]
    const benchmarks = unknown.map((x) => `${x.short}: ${why(x)}`)
    if (c && unknown.length) return result(e, 'inconclusive', [...benchmarks, ...data], found, none)
    if (c && c.util == null)
      return result(e, data.length ? 'inconclusive' : 'pass', data, found, `${c.short} is switched off${where}`)
    const claims: { at: 'pass' | 'edge' | 'fail'; text: string; min: number; wants?: string }[] = []
    const r = (x: CrossingRange | null) => (x ? multiples(x, model.searchMax) : 'never')
    const target = `the ${pct(model.thresholds.target)} target`
    // holds at the low edge, only at the high edge of a ±, or at neither
    const at = (x: CrossingRange | null, min: number) => {
      const low = x?.low ?? Number.POSITIVE_INFINITY
      const high = x?.high ?? Number.POSITIVE_INFINITY
      return low >= min ? 'pass' : high >= min ? 'edge' : 'fail'
    }
    if (e.underTarget != null) {
      const by = c ?? ev.firstLimit
      claims.push({
        at: at(found.target, e.underTarget),
        min: e.underTarget,
        text: c
          ? `${c.short} reaches ${target} at ${r(found.target)}${where}${sureness(c.capacity)}`
          : `${target} holds up to ${r(found.target)}${where}${by ? `, limited by ${by.short}${sureness(by.capacity)}` : ''}`,
      })
    }
    if (e.notFull != null) {
      const by = c ?? ev.firstFull
      // a time to last is a load through growth: the date says it again
      const dated = e.lasts != null ? reach(found.full, model.searchMax, model.dateAt) : r(found.full)
      claims.push({
        at: at(found.full, e.notFull),
        min: e.notFull,
        text: by
          ? `${by.short} ${by.plural ? 'run' : 'runs'} out at ${dated}${where}${sureness(by.capacity)}`
          : `nothing runs out${where}`,
        ...(e.lasts != null ? { wants: `to last ${period(e.lasts)} (${fmt(e.notFull)}×)` } : {}),
      })
    }
    const failed = claims.filter((x) => x.at !== 'pass')
    const message = failed.length
      ? failed.map((x) => `expected ${x.wants ?? `at least ${fmt(x.min)}×`}, but ${x.text}`).join('; ')
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

/** A flow's percentile against a time: at the values, or up to `underTarget` on every capacity's range. */
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
  if (e.component != null || e.notFull != null)
    throw new Error(`loadmap: an expectation on the latency of "${f}" takes no component and no notFull`)
  if (!model.flowIds.includes(f)) throw new Error(`loadmap: no flow "${f}"`)
  const q = qs[0]!
  const under = e[q]!
  const name = `the ${q} of ${model.def.flows[f]?.label ?? f}${e.to == null ? '' : ` to ${e.to}`}`
  // a branch's time, from its fan-out through the stage, or the flow's
  const timeAt = (v: Partial<Values<P>>, bound?: 'low' | 'high') =>
    e.to == null ? model.latency(v, bound, [f])[f] : model.branch(f, e.to, v, bound).latency
  // the branch at the values shown: its stages, and its time, read once
  const shown = e.to == null ? undefined : model.branch(f, e.to, ev.values as Partial<Values<P>>)
  const none = () =>
    result(
      e,
      'fail',
      [],
      { target: null, full: null },
      e.to == null
        ? `"${f}" has no latency: no stage on its way has a service time`
        : `the branch of "${f}" to "${e.to}" has no latency: no stage on it has a service time, and no edge a delay`,
    )
  const load = ev.values.load
  const now = shown ? shown.latency : ev.latency[f]
  if (!now) return none()
  const at = (bound: 'low' | 'high', l: number) =>
    timeAt({ ...values, load: l } as Partial<Values<P>>, bound)?.[q] ?? Number.NaN
  // measured data that is missing may move the answer either way: a capacity on its way, or any other reading
  const all = Object.values<ComponentResult<C>>(ev.components)
  const through = shown ? shown.stages : (ev.paths[f] ?? []).flatMap((w) => w.stages)
  const onWay = new Set(through.map((s) => (ev.stages[s] as { component?: string }).component))
  const read = new Set(all.flatMap((x) => (x.capacity?.measure ? [x.capacity.measure] : [])))
  const data = [
    ...all.filter((x) => onWay.has(x.id) && x.capacity?.unread).map((x) => `${x.short}: ${x.capacity!.unread}`),
    ...gaps.filter(([n]) => !read.has(n)).map(([n, m]) => `${n}: ${m.missing}`),
    ...(now.unknown ?? []).map((c) => `${c}: its time is not known, so it counts as none`),
  ]
  const verdict = (low: boolean, high: boolean): Outcome =>
    !high && !data.length ? 'fail' : data.length || !low ? 'inconclusive' : 'pass'
  const reasons = (outcome: Outcome, edge: string[]) => (outcome === 'fail' ? [] : [...data, ...edge])
  if (e.underTarget == null) {
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
  const outcome = verdict(range.low >= e.underTarget, range.high >= e.underTarget)
  const found = Number.isFinite(range.low) ? multiples(range, max) : `past ${fmt(max)}×`
  const message =
    range.low >= e.underTarget
      ? `${name} stays under ${duration(under)} ${Number.isFinite(range.low) ? 'up to ' : ''}${found}${where}`
      : `expected at least ${fmt(e.underTarget)}×, but ${name} passes ${duration(under)} at ${found}${where}`
  const edge =
    range.low < e.underTarget && range.high >= e.underTarget
      ? [`holds at ${fmt(e.underTarget)}× only at the high edge of a ±`]
      : []
  return result(e, outcome, reasons(outcome, edge), { target: range, full: null }, message)
}

const share = (x: number) => pct(x, true)
const LOSS_WORDS = { rejected: 'turned away', dropped: 'dropped', timedOut: 'too slow', failed: 'failed' } as const

/** What a flow (or the flow that loses most) loses for good against a share: at the values, or up to `underTarget`. */
function lostCheck<P, C extends string>(
  model: Model<P, string, C>,
  e: Expectation<C>,
  values: object,
  ev: ReturnType<Model<P, string, C>['evaluate']>,
  where: string,
  gaps: readonly [string, { missing?: string }][],
): CheckResult<C> {
  if (e.component != null || e.notFull != null || PERCENTILES.some((q) => e[q] != null))
    throw new Error('loadmap: an expectation on what is lost takes no component, no notFull and no latency')
  if (e.to != null && e.flow == null)
    throw new Error('loadmap: an expectation on a branch (to) names the flow whose fan-out it is')
  const under = e.lost!
  const flows = e.flow == null ? model.flowIds : [e.flow]
  if (!flows.every((f) => model.flowIds.includes(f))) throw new Error(`loadmap: no flow "${e.flow}"`)
  // the flow that loses the largest share speaks for all of them; a branch speaks for itself
  const worst = (bound: 'low' | 'high', l: number) => {
    const at = { ...values, load: l } as Partial<Values<P>>
    if (e.to != null) return { f: flows[0]!, ...model.branch(flows[0]!, e.to, at, bound).lost }
    const all = model.lost(at, bound, flows)
    const f = flows.reduce((a, x) => (all[x]!.share > all[a]!.share ? x : a), flows[0]!)
    return { f, ...all[f]! }
  }
  const at = (bound: 'low' | 'high', l: number) => worst(bound, l).share
  // a share is held to a millionth of a percent: the sums behind it are not exact
  const past = (x: number) => x > under + 1e-8
  // a branch is named by where it goes: "orders to mailers"
  const name = (f: string) => `${model.def.flows[f]?.label ?? f}${e.to == null ? '' : ` to ${e.to}`}`
  // any measured data that is missing may move what a flow loses: a capacity once, for its component
  const data = unread(ev, gaps)
  const verdict = (low: boolean, high: boolean): Outcome =>
    !high && !data.length ? 'fail' : data.length || !low ? 'inconclusive' : 'pass'
  const reasons = (outcome: Outcome, edge: string[]) => (outcome === 'fail' ? [] : [...data, ...edge])
  const most = share(under)
  const every = e.flow == null
  // a share just past the limit reads as the limit at two digits: then with four
  const more = (x: number) => (share(x) === most ? `${Number((x * 100).toPrecision(4))} %` : share(x))
  // a flow's label is often a plural ("orders"): the share is the subject, so the verb fits either
  const kept = (who: string) => (under > 0 ? `at most ${most} of ${who}` : every ? 'nothing' : `nothing of ${who}`)
  if (e.underTarget == null) {
    const load = ev.values.load
    // the wording says what the pessimistic edge shows, its cause too
    const { f, share: low, causes } = worst('low', load)
    const high = at('high', load)
    const outcome = verdict(!past(low), !past(high))
    const cause = causes.reduce<Lost['causes'][number] | undefined>(
      (a, c) => (a && a.rate >= c.rate ? a : c),
      undefined,
    )
    const stage = cause?.stage == null ? undefined : (ev.stages[cause.stage] as { component?: C } | undefined)
    const place = stage?.component ? ev.components[stage.component]?.short : cause?.stage
    const by = !cause
      ? ''
      : cause.stage == null
        ? ', most of it failed fast by its breaker'
        : `, most of it ${LOSS_WORDS[cause.loss]} at ${place}`
    const message = !past(low)
      ? low > 1e-8
        ? `${share(low)} of ${name(f)} is lost at ${fmt(load)}×${where}, within ${most}`
        : `nothing${every ? '' : ` of ${name(f)}`} is lost at ${fmt(load)}×${where}`
      : `expected ${kept(every ? 'every flow' : name(f))} lost, but ${more(low)}${every ? ` of ${name(f)}` : ''} is lost at ${fmt(load)}×${where}${by}`
    const edge = past(low) && !past(high) ? ['holds only at the high edge of a ±'] : []
    return result(e, outcome, reasons(outcome, edge), { target: null, full: null }, message)
  }
  const max = model.searchMax
  const cross = (bound: 'low' | 'high') =>
    crossing((l) => (past(at(bound, l)) ? 1 : 0), 1, max) ?? Number.POSITIVE_INFINITY
  const range = { low: cross('low'), high: cross('high') }
  const outcome = verdict(range.low >= e.underTarget, range.high >= e.underTarget)
  const found = Number.isFinite(range.low) ? multiples(range, max) : `past ${fmt(max)}×`
  // the flow that loses first, just past where the first one does
  const first = name(Number.isFinite(range.low) ? worst('low', Math.min(max, range.low * 1.001)).f : flows[0]!)
  const message =
    range.low >= e.underTarget
      ? `${kept(every ? 'every flow' : first)} is lost ${Number.isFinite(range.low) ? 'up to ' : ''}${found}${where}`
      : `expected at least ${fmt(e.underTarget)}×, but ${under > 0 ? `more than ${most}` : 'some'} of ${first} is lost from ${found}${where}`
  const edge =
    range.low < e.underTarget && range.high >= e.underTarget
      ? [`holds at ${fmt(e.underTarget)}× only at the high edge of a ±`]
      : []
  return result(e, outcome, reasons(outcome, edge), { target: range, full: null }, message)
}

/** What a preset's moment leaves in the queues: the oldest unit's wait when it ends, and the time to clear after it. */
function momentCheck<P, C extends string>(
  model: Model<P, string, C>,
  e: Expectation<C>,
  values: object,
  where: string,
  gaps: readonly [string, { missing?: string }][],
): CheckResult<C> {
  const others = ['component', 'flow', 'to', 'lost', 'underTarget', 'notFull', 'lasts', ...PERCENTILES] as const
  if (others.some((k) => e[k] != null) || (e.lag == null && e.clears == null))
    throw new Error(
      'loadmap: an expectation on a moment takes a preset, lag or clears (or both) and a queue, nothing else',
    )
  const own = <T>(o: Readonly<Record<string, T>> | undefined, k: string) =>
    o && Object.hasOwn(o, k) ? o[k] : undefined
  const lasts = e.preset == null ? undefined : own(model.def.peaks, e.preset)
  if (e.preset == null) throw new Error('loadmap: an expectation on a lag or a time to clear names its preset')
  if (lasts == null) throw new Error(`loadmap: no preset "${e.preset}" that lasts: lag and clears need a moment`)
  if (e.queue != null && model.def.stages[e.queue]?.kind !== 'queue') throw new Error(`loadmap: no queue "${e.queue}"`)
  const at = { ...values, ...own(model.def.presets as Record<string, object> | undefined, e.preset) } as Partial<
    Values<P>
  >
  const ev = model.evaluate(at)
  const label = (s: string) => ev.stages[s]?.label ?? s
  // the queue that is worst off speaks for all of them
  const found = (bound: Bound) => {
    const left = backlog(model, at, lasts, bound).filter((b) => e.queue == null || b.stage === e.queue)
    const worst = (k: 'lag' | 'empties') =>
      left.reduce<(typeof left)[number] | undefined>((a, b) => (a && a[k] >= b[k] ? a : b), undefined)
    return { lag: worst('lag'), clears: worst('empties') }
  }
  const low = found('low')
  // the high edge is read only where the low one misses
  let other: ReturnType<typeof found> | undefined
  const high = () => {
    other ??= found('high')
    return other
  }
  // a reader with no published benchmark is not ranked: the model lets it drain anything, so nothing here is known
  const data = [
    ...Object.values<ComponentResult<C>>(ev.components)
      .filter((x) => x.missing != null)
      .map((x) => `${x.short}: no published benchmark ${x.missing}`),
    ...unread(ev, gaps),
  ]
  const moment = `after ${period(lasts)} of ${e.preset}${where}`
  const rest = multiple(model.defaults().load as number, model.searchMax)
  const claims: { at: 'pass' | 'edge' | 'fail'; text: string; wants: string }[] = []
  // a time is held to a millionth: the drain behind it comes from a crossing that is searched for
  const within = (x: number, max: number) => x <= max * (1 + 1e-6)
  const held = (l: number, h: () => number, max: number) =>
    within(l, max) ? 'pass' : within(h(), max) ? 'edge' : 'fail'
  // a time just past the limit reads as the limit: then in seconds, with more digits
  const clash = (x: number, max: number) => !within(x, max) && Number.isFinite(x) && period(x) === period(max)
  const exact = (x: number) => `${Number(x.toPrecision(6))} s`
  const took = (x: number, max: number) => (clash(x, max) ? exact(x) : period(x))
  const limit = (x: number, max: number) => (clash(x, max) ? exact(max) : period(max))
  if (e.lag != null)
    claims.push({
      at: held(low.lag?.lag ?? 0, () => high().lag?.lag ?? 0, e.lag),
      wants: `a lag of at most ${limit(low.lag?.lag ?? 0, e.lag)} ${moment}`,
      text: low.lag
        ? `the oldest unit in ${label(low.lag.stage)} waited ${took(low.lag.lag, e.lag)}`
        : e.queue != null
          ? `${label(e.queue)} keeps up`
          : 'no queue falls behind',
    })
  if (e.clears != null) {
    const b = low.clears
    claims.push({
      at: held(b?.empties ?? 0, () => high().clears?.empties ?? 0, e.clears),
      wants: `${e.queue != null ? label(e.queue) : 'every queue'} to clear within ${limit(b?.empties ?? 0, e.clears)} ${moment}`,
      text: !b
        ? e.queue != null
          ? `${label(e.queue)} keeps up`
          : 'no queue falls behind'
        : Number.isFinite(b.empties)
          ? `${label(b.stage)} clears in ${took(b.empties, e.clears)} at ${rest}`
          : `${label(b.stage)} never clears at ${rest}`,
    })
  }
  const failed = claims.filter((x) => x.at !== 'pass')
  const message = failed.length
    ? failed.map((x) => `expected ${x.wants}, but ${x.text}`).join('; ')
    : `${moment}, ${[...new Set(claims.map((x) => x.text))].join('; ')}`
  const edges = claims.some((x) => x.at === 'edge') ? ['holds only at the high edge of a ±'] : []
  const outcome: Outcome =
    claims.some((x) => x.at === 'fail') && !data.length ? 'fail' : data.length || edges.length ? 'inconclusive' : 'pass'
  return result(e, outcome, outcome === 'fail' ? [] : [...data, ...edges], { target: null, full: null }, message)
}

/** A budget: what the components with a cost cost a month, at the values or at `underTarget`. */
function costCheck<P, C extends string>(
  model: Model<P, string, C>,
  e: Expectation<C>,
  values: object,
  where: string,
): CheckResult<C> {
  const load = e.underTarget ?? (values as { load?: number }).load ?? (model.defaults() as { load: number }).load
  const ev = model.evaluate({ ...values, load } as Partial<Values<P>>)
  if (!ev.cost) throw new Error('loadmap: an expectation on cost needs a component with a cost')
  const unit = ev.cost.currency ? ` ${ev.cost.currency}` : ''
  const money = (x: number) => `${fmt(x)}${unit}`
  const at = `at ${fmt(load)}×${where}`
  const within = ev.cost.total <= e.cost! + 1e-9
  return result(
    e,
    within ? 'pass' : 'fail',
    [],
    { target: null, full: null },
    within
      ? `it costs ${money(ev.cost.total)} a month ${at}, within ${money(e.cost!)}`
      : `expected at most ${money(e.cost!)} a month, but it costs ${money(ev.cost.total)} ${at}`,
  )
}

/** The measured data that is missing and may move an answer: a capacity once, for its component, then every other. */
function unread<C extends string>(
  ev: { components: Readonly<Record<string, ComponentResult<C>>> },
  gaps: readonly [string, { missing?: string }][],
): string[] {
  const all = Object.values<ComponentResult<C>>(ev.components)
  const read = new Set(all.flatMap((x) => (x.capacity?.measure ? [x.capacity.measure] : [])))
  return [
    ...all.filter((x) => x.capacity?.unread).map((x) => `${x.short}: ${x.capacity!.unread}`),
    ...gaps.filter(([n]) => !read.has(n)).map(([n, m]) => `${n}: ${m.missing}`),
  ]
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
