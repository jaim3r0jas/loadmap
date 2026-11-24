import { blame, flowError } from './blame'
import type { Fit } from './calibrate'
import { type Bound, boundOf, type Capacity, type CrossingRange } from './capacity'
import type { Expectation } from './check'
import {
  type ConnectionDef,
  memberShape,
  opener,
  poolShape,
  type Shape,
  type Spread,
  spreadOver,
  spreadText,
  type Work,
} from './connections'
import { capital, fmt, joinAnd, months, multiple, multiples, pct } from './format'
import { growth as checkGrowth, dateAt, type Growth } from './growth'
import { beyond, type Latency, latencyOf, PERCENTILES, type WayTime } from './latency'
import { checkLost, waysOf } from './losses'
import type { Measurement, Snapshot } from './measure'
import { type AnyParamDef, isEnabled, type LoadParam, type LooseValues, type ParamDef, type Values } from './params'
import {
  type Branch,
  dyn,
  hitOf,
  type LimitStage,
  LOSSES,
  type Loss,
  podsOf,
  QUOTA_SECONDS,
  type QuotaWindow,
  type ResolvedStage,
  rejectShare,
  resolveStage,
  type SplitBranch,
  type StageDef,
  splitOf,
  type WorkersAssignment,
} from './stages'

/** What every model function receives: the parameter values plus the model's own derived numbers. */
export type Ctx<P, F extends string, C extends string, D extends string, S extends string = string> = Values<P> & {
  /** Units per second of each flow where it enters; with retries, its attempts. */
  readonly flows: Readonly<Record<F, number>>
  /**
   * Units per second of each flow reaching each stage: cache hits and what a rate limiter turns away are gone from
   * the stages after them; a fan-out's copies reach its branches.
   */
  readonly at: Readonly<Record<S, Readonly<Record<F, number>>>>
  /** Each component's demand, in its capacity's unit. */
  readonly demand: Readonly<Record<C, number>>
  /** Each component's demand ÷ capacity; null when the component is switched off. */
  readonly util: Readonly<Record<C, number | null>>
  readonly derived: Readonly<Record<D, number>>
}

export interface FlowDef<X> {
  label?: string
  /** One unit of the flow, singular: "order". */
  unit?: string
  /** Units per second: a number, or computed from the values. */
  rate: number | ((ctx: X) => number)
  /** 1 is served first. Flows of the same priority share capacity. */
  priority?: number
  /** What happens to this flow's backlog in a queue; may depend on the values. Without a rule it waits. */
  overload?: Overload | ((ctx: X) => Overload)
  /**
   * Units turned away on the route are sent again. It reads only the load and the parameters: retries change every
   * number the model computes, so they cannot depend on one.
   */
  retry?: RetryRule | ((values: LooseValues) => RetryRule | undefined)
  /**
   * Seconds a client waits: a unit slower than this fails (and is sent again with `retry`), though the work it set off
   * still runs. It needs a latency, a `service` on its way. It reads only the load and the parameters, as retry does.
   */
  timeout?: number | ((values: LooseValues) => number)
  /**
   * Its rate over a day against its peak, `rate`: 0.45 when the day averages 45 % of it. What fills over time (a
   * component's `fills`) and a quota per day or month read it; every other limit reads the peak. 1 unless said. It reads only
   * the load and the parameters.
   */
  average?: number | ((values: LooseValues) => number)
  /**
   * Where its failures go: what it fails for good (turned away or too slow, after every retry) is served from `after`,
   * a stage on its route, along `route` instead: a stale cache, a degraded answer. It is lost only if the fallback
   * fails too.
   */
  fallback?: Fallback
  /**
   * A circuit breaker in its callers: past `opens`, a share of its attempts failing, it fails calls fast, so they reach
   * no stage. In steady state it admits the share α of the flow at which the failures among the admitted calls are
   * `opens`, p(α·rate) = opens; below that it stays closed. What it fails fast goes to the fallback, if any. It reads
   * only the load and the parameters; a flow that retries takes none, since the two would depend on each other.
   */
  breaker?: { opens: number } | ((values: LooseValues) => { opens: number } | undefined)
}

/** A flow's fallback: the stage on its route its failures go back to, and the stages that then serve them. */
export interface Fallback<S extends string = string> {
  after: S
  route: readonly S[]
}

/** Rules for a flow's backlog in a queue. */
export interface Overload {
  /** Units older than `olderThan` simulated seconds are dropped before they are handled. */
  drop?: { olderThan: number; reason?: string }
  /**
   * Under backlog (more than a second of arrivals waiting), this share of what is handled is superseded by a newer
   * unit of the same key: it leaves the queue without using capacity. Keep-newest-per-key, as a share.
   */
  merge?: { share: number; reason?: string }
}

/**
 * A unit turned away on its route (by a pass, limit or cache stage past capacity) is sent again, up to `times` more
 * times. The attempts are what every stage on the route sees; they settle where the retries they cause are the ones
 * that were assumed.
 */
export interface RetryRule {
  /** Retries after the first attempt: a whole number. */
  times: number
  /** At most this share of the flow is added as retries: 0.1 adds at most 10 %. Without one, every retry is sent. */
  budget?: number
}

/** A flow's retries worked out for one set of values. */
export interface Retry {
  /** Retries after the first attempt. */
  times: number
  /** Units per second the flow sends, before retries. */
  rate: number
  /** Attempts per second, retries included: what every stage on its route sees. */
  attempts: number
  /** The share of attempts that fail: turned away somewhere on the route, or slower than the flow's timeout. */
  rejected: number
  /** The share of failed attempts that are sent again: 1 unless the budget holds some back. */
  retried: number
  /** The share of units that fail every attempt. */
  failed: number
}

export interface ComponentDef<X> {
  name: string
  /** The name inside a sentence, with its article: "the database". Defaults to the name. */
  short?: string
  /** "are past capacity" instead of "is". */
  plural?: boolean
  /** In the capacity's unit. Without one: the units per second reaching the stages that use this component. */
  demand?: (ctx: X) => number
  /**
   * The seconds each unit holds one of its slots (a connection, a session, a request in flight): one time for every
   * flow, or one per flow. Its demand is then the slots in use, by Little's law: the units per second reaching `on`
   * times the time held, and its capacity counts slots.
   */
  held?: number | Readonly<Record<string, number>> | ((ctx: X) => number | Readonly<Record<string, number>>)
  /** The stages whose units hold its slots; by default the stages that use it. */
  on?: readonly string[]
  /**
   * The seconds a unit takes here when nothing waits: each stage it runs is then a queue (M/M/1) whose time grows as
   * service ÷ (1 − utilization), and the flows through it have a latency.
   */
  service?: number | ((ctx: X) => number)
  /**
   * What it gains each second, in its capacity's unit: a stock, such as a disk, a topic's retention or a database's
   * size, which fills over time rather than at a load. It is read with every flow at its `average`. With `keeps` it
   * holds what it gains that long and settles at fills × keeps; with `level` it stands there on `growth.asOf` and
   * grows as the load does, so its level at a load multiple is the one on the day the load reaches it. No stage runs a
   * stock.
   */
  fills?: (ctx: X) => number
  /** The seconds a stock keeps what it gains: a retention. */
  keeps?: number | ((values: LooseValues) => number)
  /** Where a stock that grows stands on `growth.asOf`, in its capacity's unit: read off a disk, a bucket, a table. */
  level?: Capacity | ((values: LooseValues) => Capacity)
  /**
   * Runs, a batch: what reaches it in `every` seconds is worked off in `within`, so its demand is the rate a run needs. A
   * nightly job that must finish in 4 hours is `{ every: 86_400, within: 14_400 }`. Every a day or more reads each
   * flow at its `average`.
   */
  runs?: Runs | ((values: LooseValues) => Runs)
  capacity: Capacity | ((ctx: X) => Capacity)
  /** The component is left out (no utilization) when this returns false. */
  when?: (ctx: X) => boolean
  /** What happens past 100 %, as a clause: "clients get 429s". */
  over: string | ((ctx: X) => string)
  /** One line under the name in the limits list. */
  describe?: string | ((ctx: X) => string)
}

export interface ModelDef<P, F extends string, C extends string, D extends string, S extends string> {
  title?: string
  load: LoadParam
  params?: P
  presets?: Readonly<Record<string, Partial<NoInfer<Values<P>>>>>
  /**
   * How long a preset's moment lasts, in seconds, by its label: a peak of two hours. The backlog it leaves in each
   * queue, and the time to clear it at the default load, are `model.backlog()`.
   */
  peaks?: Readonly<Record<string, number>>
  /**
   * Named designs to compare, by label: the defaults plus these values, never the load. The first is the baseline the
   * others are measured against.
   */
  scenarios?: Readonly<Record<string, Partial<NoInfer<Omit<Values<P>, 'load'>>>>>
  /** How fast the load grows: turns load multiples into dates. */
  growth?: Growth
  flows: { [K in F]: FlowDef<Ctx<P, F, C, D, NoInfer<S>>> }
  components: { [K in C]: ComponentDef<Ctx<P, F, C, D, NoInfer<S>>> }
  derived?: { [K in D]: (ctx: Ctx<P, F, C, D, NoInfer<S>>) => number }
  stages: { [K in S]: StageDef<NoInfer<C>> }
  routes: { [K in NoInfer<F>]: readonly NoInfer<S>[] }
  /**
   * How a stage reaches the next one on a route, and through which part of it: a consumer group that reads each
   * partition with one worker. The component of `to` then runs out when its busiest member does.
   */
  connections?: Readonly<Record<string, ConnectionDef<NoInfer<S>, NoInfer<F>>>>
  /** Fits used by the model, listed with the assumptions. */
  calibration?: Readonly<Record<string, Fit>>
  /**
   * The measured data the model reads (through `fromSnapshot`), as `parseSnapshot` returns it: each measurement is
   * listed with the assumptions, with its origin, or with why the definition's own value is used instead.
   */
  snapshot?: Snapshot
  /** Utilization of the target (default 0.5) and of "runs out" (default 1). */
  thresholds?: { target?: number; full?: number }
  /** The highest load multiple the limits search; beyond it a component "never" runs out. Default 2000. */
  searchMax?: number
  /** What must keep holding: `check()`, `assertHolds()` and `loadmap check` test them. */
  expect?: readonly Expectation<NoInfer<C>>[]
  /** A walk through the model, a step at a time: the page shows it, `loadmap record --story` plays it. */
  story?: readonly StoryStepDef<NoInfer<P>, NoInfer<C>>[]
}

/** A step of a story: what to say, and the values to show it at. */
export interface StoryStepDef<P = any, C extends string = string> {
  text: string
  /** The few words the diagram shows while the story plays the step. Default: what the step changes. */
  title?: string
  /** Start from a scenario's values; `set` goes on top. Without one, from the defaults. */
  scenario?: string
  set?: Partial<Values<P>>
  /** The component to point at: its box is outlined. */
  focus?: C
  /**
   * The subsystems the page draws closed while it shows the step, each as one box, by the ids the view gives them.
   * Without it, the ones the page starts with.
   */
  closed?: readonly string[]
  /** How long a recording holds the step. Default 4. */
  seconds?: number
}

/** A step as the model resolved it: every value set, so a step looks the same whichever step came before. */
export interface StoryStep<P = any, C extends string = string> {
  text: string
  title?: string
  values: Values<P>
  scenario?: string
  focus?: C
  closed?: readonly string[]
  seconds: number
}

export type ComponentState = 'off' | 'ok' | 'warn' | 'over'

export interface ComponentResult<C extends string = string> {
  id: C
  name: string
  short: string
  plural: boolean
  /** demand ÷ capacity at the current values, × the spread of a connection; null when switched off. */
  util: number | null
  demand: number | null
  capacity: Capacity | null
  state: ComponentState
  /** The load multiple at which utilization reaches the target; null when off, Infinity when never. */
  target: number | null
  /** The load multiple at which utilization reaches 100 %. */
  full: number | null
  /** Where it reaches the target with every capacity at its low and at its high bound; null when off. */
  targetRange: CrossingRange | null
  fullRange: CrossingRange | null
  over: string
  describe?: string
  /** For a component that counts slots: the seconds a unit of each flow holds one. */
  held?: Readonly<Record<string, number>>
  /** Why it has no published figure for this configuration: it is then not ranked, like a switched-off one. */
  missing?: string
  /** How unevenly a connection lands the work on its members, when unevenly or with members left idle. */
  spread?: Spread
  /** For a stock (`fills`): what it holds and gains at these values. */
  stock?: Stock
  /** For a component that works in runs: how often, the time a run has, and the time a run takes at these values. */
  runs?: Runs & { takes: number }
  /** For a quota (a limit `per` a window): the window, and past the quota how long into it the quota is gone. */
  quota?: { per: QuotaWindow; goneAfter?: number }
}

/** How often a batch runs, and the time each run has: seconds. */
export interface Runs {
  every: number
  within: number
}

/** A stock at one set of values, in its capacity's unit. */
export interface Stock {
  /** What it holds: for one that grows, on the day the load reaches these values. */
  level: number
  /** What it gains a second, every flow at its average. */
  gains: number
  /** The seconds it keeps what it gains; absent for one that grows. */
  keeps?: number
  /** For one that grows: the seconds until it is full if it went on gaining `gains`; 0 when it is full already. */
  room?: number
  /** One that grows with no growth to date its level: it is not ranked. */
  undated?: true
}

export interface VerdictResult {
  tier: 'ok' | 'warn' | 'over'
  text: string
}

export interface Preset<P> {
  label: string
  values: Partial<Values<P>>
  /** How long the moment lasts, in seconds, when the definition says. */
  lasts?: number
  /** Computed from the model (the target and the first limit), not declared. */
  derived: boolean
}

/** A named design: every parameter's value, the load left to the slider. */
export interface Scenario<P = any> {
  label: string
  values: Omit<Values<P>, 'load'>
}

/** The capacity whose ± matters most to where the target holds. */
export interface MeasureHint<C extends string = string> {
  component: C
  /** Where the target would hold with that capacity at its stated value and the others still ranged. */
  target: CrossingRange
  /** The first limit then: another component when measuring would change the answer. */
  firstLimit: C
  /** "Measuring the API gateway would change the answer: …" */
  text: string
}

/** One way through a model: the stages a share of a flow's units go through, in order. */
export interface FlowPath<S extends string = string> {
  stages: readonly S[]
  share: number
}

export type Assumption =
  | { kind: 'capacity'; component: string; name: string; capacity: Capacity }
  | { kind: 'fit'; name: string; fit: Fit }
  /** A measurement of the snapshot; a missing one says why, and the definition's own value is used. */
  | { kind: 'measurement'; name: string; measurement: Measurement }
  /** A connection: its rule, in a sentence. */
  | { kind: 'connection'; name: string; text: string }

export interface Evaluation<P = any, F extends string = string, C extends string = string, S extends string = string> {
  values: Values<P>
  flows: Readonly<Record<F, number>>
  components: Readonly<Record<C, ComponentResult<C>>>
  /** Components in the order they reach the target, on the pessimistic edge (every capacity at its low bound). */
  ranked: readonly ComponentResult<C>[]
  /** The component that reaches the target first, on the pessimistic edge. */
  firstLimit: ComponentResult<C> | null
  /** The component that reaches 100 % first, on the pessimistic edge. */
  firstFull: ComponentResult<C> | null
  /** Where the first component reaches the target with every capacity at its low bound, and at its high bound. */
  target: CrossingRange | null
  /** Where the first component reaches 100 %, the same way. */
  full: CrossingRange | null
  verdict: VerdictResult
  /** Which capacity, once measured, would change or narrow the answer most; null when the range is narrow. */
  measure: MeasureHint<C> | null
  presets: readonly Preset<P>[]
  assumptions: readonly Assumption[]
  stages: Readonly<Record<S, ResolvedStage>>
  routes: Readonly<Record<F, readonly S[]>>
  /** Units per second of each flow reaching each stage. */
  at: Readonly<Record<S, Readonly<Record<F, number>>>>
  /**
   * Each flow's ways through, with the share of its units that go each way: its route, once per branch of every split
   * on it. A flow without a split has one, its route, with a share of 1.
   */
  paths: Readonly<Record<F, readonly FlowPath<S>[]>>
  /** Each flow's overload rules for these values. */
  overload: Readonly<Record<F, Overload>>
  /** The retries of each flow that has a retry rule. */
  retry: Readonly<Partial<Record<F, Retry>>>
  /** Each flow's breaker, when it has one: what the flow sends, the share it admits, and what it fails fast a second. */
  breakers: Readonly<Partial<Record<F, { opens: number; rate: number; admitted: number; failedFast: number }>>>
  /** Each flow's fallback, when it has one, and the units a second it serves: what the flow fails for good. */
  fallbacks: Readonly<Partial<Record<F, Fallback<S> & { rate: number }>>>
  /** Each flow's time through, from the service times of its stages; null for a flow none of them has one on. */
  latency: Readonly<Record<F, Latency | null>>
  /** The context model functions saw: for labels and other view callbacks. */
  ctx: LooseValues
}

export interface Model<P = any, F extends string = string, C extends string = string, S extends string = string> {
  /** The definition as written; loosely typed so any model fits `Model` in the packages that drive it. */
  def: ModelDef<any, any, any, any, any>
  title?: string
  load: LoadParam
  /** The load first, then the other parameters in declaration order. */
  params: readonly { id: string; def: AnyParamDef }[]
  flowIds: readonly F[]
  componentIds: readonly C[]
  stageIds: readonly S[]
  thresholds: { target: number; full: number }
  searchMax: number
  /** Declared scenarios in order; the first is the baseline. */
  scenarios: readonly Scenario<P>[]
  /** What must keep holding, as declared. */
  expectations: readonly Expectation<C>[]
  story: readonly StoryStep<P, C>[]
  growth?: Growth
  defaults(): Values<P>
  isEnabled(id: string, values: LooseValues): boolean
  evaluate(values?: Partial<Values<P>>): Evaluation<P, F, C, S>
  /**
   * The stages at these values, each flow's ways through them, and the context they resolve in: what `evaluate` gives
   * a drawing (pods, partitions, labels, the hops dots take), without the components, crossings and verdict, so it is
   * cheap to call for many values.
   */
  stagesAt(values?: Partial<Values<P>>): Pick<Evaluation<P, F, C, S>, 'values' | 'ctx' | 'stages' | 'paths'>
  /**
   * Each component's utilization at these values: what `evaluate` computes first, without the crossings. With a
   * bound, every capacity is read at its low or high bound.
   */
  utilization(values?: Partial<Values<P>>, bound?: Bound): Readonly<Record<C, number | null>>
  /**
   * Each flow's latency at these values, as `evaluate` gives it; with a bound, every capacity at that bound. With
   * flows, only theirs.
   */
  latency(
    values?: Partial<Values<P>>,
    bound?: Bound,
    flows?: readonly F[],
  ): Readonly<Partial<Record<F, Latency | null>>>
  /** The scenario whose values these are, ignoring the load; null when they match none. */
  scenarioOf(values: LooseValues): Scenario<P> | null
  /**
   * When the load reaches this multiple, from `growth`. Null without growth, without a finite multiple, and at 1× or
   * below: a crossing already reached has no date ahead.
   */
  dateAt(multiple: number | null): Date | null
}

const RESERVED = ['load', 'flows', 'at', 'demand', 'util', 'derived']

/** An expectation under its current names: `target` and `full` were its names for `underTarget` and `notFull`. */
export function expectationNamed<C extends string>(e: Expectation<C>): Expectation<C> {
  if (e.target == null && e.full == null) return e
  const name = e.label ? `expectation "${e.label}"` : 'an expectation'
  if (e.target != null && e.underTarget != null)
    throw new Error(`loadmap: ${name} gives target and underTarget, one property: give underTarget only`)
  if (e.full != null && e.notFull != null)
    throw new Error(`loadmap: ${name} gives full and notFull, one property: give notFull only`)
  const { target, full, ...rest } = e
  const underTarget = e.underTarget ?? target
  const notFull = e.notFull ?? full
  return { ...rest, ...(underTarget != null && { underTarget }), ...(notFull != null && { notFull }) }
}

export function defineModel<
  const P extends Readonly<Record<string, ParamDef>>,
  F extends string,
  C extends string,
  S extends string,
  D extends string = never,
>(written: ModelDef<P, F, C, D, S>): Model<P, F, C, S> {
  // a connection's rule from the catalog gives what it does not write; one that gives accepts is a limit of its own
  const given = withRules(withNames(written))
  const def = withCounts(given)
  const params = (def.params ?? {}) as Readonly<Record<string, ParamDef>>
  for (const id of Object.keys(params))
    if (RESERVED.includes(id)) throw new Error(`loadmap: "${id}" is reserved and cannot name a parameter`)
  const flowIds = Object.keys(def.flows) as F[]
  const componentIds = Object.keys(def.components) as C[]
  const stageIds = Object.keys(def.stages) as S[]
  for (const f of flowIds) {
    const route = (def.routes as Record<string, readonly string[]>)[f]
    if (!route?.length) throw new Error(`loadmap: flow "${f}" has no route`)
    route.forEach((s, i) => {
      const st = (def.stages as Record<string, StageDef>)[s]
      if (!st) throw new Error(`loadmap: flow "${f}" routes through unknown stage "${s}"`)
      if (st.kind === 'fanout' && i < route.length - 1)
        throw new Error(`loadmap: fan-out "${s}" must be the last stage of the route of "${f}"`)
    })
  }
  // a fallback leaves the flow's route at a stage on it, and goes where the route does not
  for (const f of flowIds) {
    const fb = def.flows[f].fallback
    if (!fb) continue
    const route = (def.routes as Record<string, readonly string[]>)[f]!
    const known = waysOf(def as never, f)
    const own = new Set<string>([...route, ...known.ways.flat()])
    if (!route.includes(fb.after))
      throw flowError(`loadmap: flow "${f}" falls back after "${fb.after}", which is not on its route`, f, 'fallback')
    if (!fb.route.length) throw flowError(`loadmap: flow "${f}" falls back to no stage`, f, 'fallback')
    for (const s of fb.route) {
      const st = (def.stages as Record<string, StageDef>)[s]
      if (!st) throw flowError(`loadmap: flow "${f}" falls back to unknown stage "${s}"`, f, 'fallback')
      if (own.has(s))
        throw flowError(`loadmap: flow "${f}" falls back to "${s}", which its own way already takes`, f, 'fallback')
      // a fallback that loads what its own failures come from would decide its own load
      const c = (st as { component?: string }).component
      const mine = [...own].find(
        (o) => c != null && (def.stages as Record<string, { component?: string }>)[o]?.component === c,
      )
      if (mine)
        throw flowError(
          `loadmap: flow "${f}" falls back to "${s}", which runs "${c}" as "${mine}" on its own way does: give the fallback a component of its own`,
          f,
          'fallback',
        )
      if (st.kind === 'queue' || st.kind === 'split' || st.kind === 'fanout' || st.kind === 'lost')
        throw flowError(
          `loadmap: flow "${f}" falls back to ${st.kind} "${s}": a fallback is served by stages that answer it`,
          f,
          'fallback',
        )
    }
  }
  // a timeout needs a time: a service on the flow's way. A split whose ways are worked out from the values may lead
  // anywhere, so then any service counts
  for (const f of flowIds) {
    const timeout = def.flows[f].timeout
    if (timeout == null) continue
    if (typeof timeout === 'number' && !(timeout > 0))
      throw new Error(`loadmap: flow "${f}" times out after ${timeout} s: a time above 0`)
    const known = waysOf(def as never, f)
    const way = new Set<string>(known.ways.flat())
    const open = known.open
    const timedStage = (s: string) => {
      const c = ((def.stages as Record<string, StageDef>)[s] as { component?: string } | undefined)?.component
      return c != null && (def.components as Record<string, ComponentDef<unknown>>)[c]?.service != null
    }
    const any = componentIds.some((c) => def.components[c].service != null)
    if (open ? !any : ![...way].some(timedStage))
      throw flowError(
        `loadmap: flow "${f}" has a timeout but no latency: no stage on its way has a service`,
        f,
        'timeout',
      )
  }
  /** Each quota's window, by its component. */
  const quotaOf = new Map<string, QuotaWindow>()
  for (const c of componentIds) {
    const d = def.components[c]
    if (d.held != null && d.demand)
      throw new Error(`loadmap: component "${c}" takes held or demand, not both: held works out its demand`)
    for (const s of d.on ?? [])
      if (!(stageIds as readonly string[]).includes(s))
        throw new Error(`loadmap: component "${c}" is held on unknown stage "${s}"`)
    if (d.on && d.held == null)
      throw new Error(`loadmap: component "${c}" names the stages that hold its slots (on): give it held too`)
    const used = stageIds.some((s) => (def.stages[s] as { component?: string }).component === c)
    // a quota counts its window: nothing else may count the same component a second, or in another window
    const runs = stageIds
      .map((s) => def.stages[s] as StageDef)
      .filter((s) => (s as { component?: string }).component === c)
    const windows = new Set(runs.map((s) => (s.kind === 'limit' ? s.per : undefined)))
    if (runs.some((s) => s.kind === 'limit' && s.per != null)) {
      if (windows.size > 1)
        throw new Error(
          `loadmap: component "${c}" counts a quota's window and something else: give each its own component`,
        )
      if (d.demand || d.held != null)
        throw new Error(
          `loadmap: component "${c}" is a quota: it counts what reaches it in its window, so no demand or held`,
        )
      quotaOf.set(c, [...windows][0]!)
    }
    if (d.held != null && !d.on?.length && !used)
      throw new Error(`loadmap: component "${c}" is held on no stage: name them with on`)
    if (d.fills != null) {
      if (d.demand || d.held != null)
        throw new Error(`loadmap: component "${c}" fills over time: it takes no demand or held, fills is what it gains`)
      if ((d.keeps == null) === (d.level == null))
        throw new Error(
          `loadmap: component "${c}" fills over time: give it keeps (it settles at fills × keeps) or level (it grows from there), one of them`,
        )
      if (used)
        throw new Error(
          `loadmap: component "${c}" fills over time, so no stage runs it: give the stage a component of its own`,
        )
    } else if (d.keeps != null || d.level != null)
      throw new Error(`loadmap: component "${c}" has ${d.keeps != null ? 'keeps' : 'level'}: give it fills too`)
    const priorityPass = stageIds.find((s) => {
      const st = def.stages[s] as StageDef
      return st.kind === 'pass' && st.shed === 'priority' && st.component === c
    })
    if (priorityPass && (d.demand || d.held != null))
      throw new Error(
        `loadmap: pass "${priorityPass}" sheds by priority, so it counts the units that reach it: "${c}" takes no demand or held, which could weigh one flow's units over another's`,
      )
    if (d.runs != null && (d.fills != null || d.held != null || quotaOf.has(c)))
      throw new Error(`loadmap: component "${c}" works in runs: its demand is a rate, so it is no stock, held or quota`)
    if (!d.demand && d.held == null && d.fills == null && !used)
      throw new Error(`loadmap: component "${c}" needs a demand: no stage uses it`)
  }
  for (const s of stageIds) {
    const st = def.stages[s] as StageDef
    if (st.kind === 'workers' && (st.pods == null) === (st.autoscale == null))
      throw new Error(`loadmap: workers "${s}" needs pods or autoscale, one of them`)
  }
  checkLost(def as never)
  checkConnections(given as ModelDef<any, string, string, string, string>)
  const thresholds = { target: def.thresholds?.target ?? 0.5, full: def.thresholds?.full ?? 1 }
  const searchMax = def.searchMax ?? 2000
  const growth = def.growth && checkGrowth(def.growth)
  const when = (x: number | null) => (growth && x != null && x > 1 ? dateAt(growth, x) : null)
  const paramList = [
    { id: 'load', def: def.load as AnyParamDef },
    ...Object.entries(params).map(([id, d]) => ({ id, def: d })),
  ]

  const defaults = () => {
    const v: Record<string, unknown> = { load: def.load.default }
    for (const [id, d] of Object.entries(params)) v[id] = d.default
    return v as Values<P>
  }

  /** Throws unless every value is one its parameter (or the load, where allowed) can take. */
  const takes = (owner: string, set: object, load: boolean) => {
    for (const k of Object.keys(set)) {
      const v = (set as Record<string, unknown>)[k]
      if (k === 'load') {
        if (!load) throw new Error(`loadmap: ${owner} sets the load; a scenario leaves it to the slider`)
        if (!(typeof v === 'number' && v >= def.load.min && v <= def.load.max))
          throw new Error(`loadmap: ${owner} sets the load to ${String(v)}, outside ${def.load.min} to ${def.load.max}`)
        continue
      }
      const p = Object.hasOwn(params, k) ? params[k] : undefined
      if (!p) throw new Error(`loadmap: ${owner} sets unknown parameter "${k}"`)
      const fits =
        p.kind === 'select'
          ? p.options.includes(v)
          : p.kind === 'switch'
            ? typeof v === 'boolean'
            : typeof v === 'number' && v >= p.min && v <= p.max
      if (!fits) throw new Error(`loadmap: ${owner} sets "${k}" to ${String(v)}, which it cannot take`)
    }
  }

  const scenarios: Scenario<P>[] = Object.entries(def.scenarios ?? {}).map(([label, set]) => {
    takes(`scenario "${label}"`, set as object, false)
    const { load: _, ...values } = { ...defaults(), ...set } as Values<P>
    return { label, values }
  })
  for (const [label, s] of Object.entries(def.peaks ?? {})) {
    if (!Object.hasOwn(def.presets ?? {}, label)) throw new Error(`loadmap: a peak names unknown preset "${label}"`)
    if (!(s > 0 && Number.isFinite(s))) throw new Error(`loadmap: preset "${label}" lasts ${s} s: a time above 0`)
  }
  const scenarioOf = (values: LooseValues) =>
    scenarios.find((s) => Object.entries(s.values).every(([k, v]) => values[k] === v)) ?? null

  const expectations = (def.expect ?? []).map((written) => {
    let e = expectationNamed(written)
    const name = e.label ? `expectation "${e.label}"` : 'an expectation'
    if (e.lasts != null) {
      if (!growth) throw new Error(`loadmap: ${name} holds a time (lasts): give the model growth, so a time is a load`)
      if (e.notFull != null) throw new Error(`loadmap: ${name} gives lasts and notFull, one of them`)
      if (!(e.lasts > 0 && Number.isFinite(e.lasts)))
        throw new Error(`loadmap: ${name} needs lasts above 0 seconds, not ${e.lasts}`)
      // nothing runs out before the load the growth reaches that long after asOf
      e = { ...e, notFull: multipleAfter(growth, e.lasts) }
    }
    if (e.scenario != null && !scenarios.some((s) => s.label === e.scenario))
      throw new Error(`loadmap: ${name} names unknown scenario "${e.scenario}"`)
    if (e.component != null && !componentIds.includes(e.component))
      throw new Error(`loadmap: ${name} names unknown component "${e.component}"`)
    if (e.flow != null && !(flowIds as readonly string[]).includes(e.flow))
      throw new Error(`loadmap: ${name} names unknown flow "${e.flow}"`)
    const qs = PERCENTILES.filter((q) => e[q] != null)
    if ((e.flow != null || qs.length) && (e.flow == null || qs.length !== 1))
      throw new Error(`loadmap: ${name} holds a latency: a flow and one of p50, p95 or p99`)
    if (e.flow != null && (e.component != null || e.notFull != null))
      throw new Error(`loadmap: ${name} holds the latency of "${e.flow}": no component and no notFull`)
    for (const q of qs) {
      const x = e[q]!
      if (!(x > 0 && Number.isFinite(x))) throw new Error(`loadmap: ${name} has a ${q} of ${x}: a time above 0`)
    }
    // a flow's latency is checked at the values without underTarget
    if (e.underTarget == null && e.notFull == null && e.flow == null)
      throw new Error(`loadmap: ${name} needs underTarget, notFull or lasts`)
    for (const k of ['underTarget', 'notFull'] as const) {
      const x = e[k]
      if (x != null && !(x > 0 && Number.isFinite(x))) throw new Error(`loadmap: ${name} needs ${k} above 0, not ${x}`)
    }
    // a copy: a host that changes it changes no other model built from the same definition
    return { ...e } as Expectation<C>
  })

  const story = (def.story ?? []).map((st, i): StoryStep<P, C> => {
    const name = `story step ${i + 1}`
    const from = st.scenario == null ? undefined : scenarios.find((s) => s.label === st.scenario)
    if (st.scenario != null && !from) throw new Error(`loadmap: ${name} names unknown scenario "${st.scenario}"`)
    if (st.focus != null && !componentIds.includes(st.focus))
      throw new Error(`loadmap: ${name} points at unknown component "${st.focus}"`)
    if (st.seconds != null && !(st.seconds > 0 && Number.isFinite(st.seconds)))
      throw new Error(`loadmap: ${name} needs seconds above 0, not ${st.seconds}`)
    takes(name, st.set ?? {}, true)
    if (st.title != null && !st.title.trim()) throw new Error(`loadmap: ${name} has an empty title`)
    return {
      text: st.text,
      ...(st.title != null ? { title: st.title } : {}),
      values: { ...defaults(), ...from?.values, ...st.set } as Values<P>,
      ...(st.scenario != null ? { scenario: st.scenario } : {}),
      ...(st.focus != null ? { focus: st.focus } : {}),
      ...(st.closed ? { closed: [...st.closed] } : {}),
      seconds: st.seconds ?? 4,
    }
  })

  const utilAt = (values: LooseValues, bound?: Bound, pinned?: string) => (load: number) =>
    context(def as any, { ...values, load }, bound, pinned).ctx.util
  /** The highest utilization of any live component: it crosses a threshold where the first of them does. */
  const envelope = (values: LooseValues, bound?: Bound, pinned?: string) => (load: number) => {
    const util = utilAt(values, bound, pinned)(load)
    let top: number | null = null
    for (const c of componentIds) {
      const u = util[c] as number | null
      if (u != null && (top == null || u > top)) top = u
    }
    return top
  }

  // crossings depend on every value but the load: cache them per combination
  const crossingCache = new Map<string, Crossings>()
  const crossingsFor = (values: LooseValues): Crossings => {
    const { load: _, ...rest } = values
    const key = JSON.stringify(rest)
    const hit = crossingCache.get(key)
    if (hit) return hit
    const stated = context(def as any, values)
    // a stock's level may be as unsure as a capacity: it moves its crossings too
    const levelWithin = (c: string) => {
      const l = def.components[c as C]!.level
      return (typeof l === 'function' ? l(values) : l)?.within ?? 0
    }
    const uncertain = componentIds.filter((c) => (stated.capacity(c).within ?? 0) > 0 || levelWithin(c) > 0)
    const components: Crossings['components'] = {}
    // the scans of every component visit the same loads: one context per load and bound serves them all, and with
    // retries it holds the solve
    const seen = new Map<string, Readonly<Record<string, number | null>>>()
    const utilOf = (bound: Bound | undefined, load: number) => {
      const k = `${bound}|${load}`
      const hit = seen.get(k)
      if (hit) return hit
      const u = utilAt(values, bound)(load)
      seen.set(k, u)
      return u
    }
    for (const c of componentIds) {
      const at = (bound?: Bound) => (load: number) => utilOf(bound, load)[c] as number | null
      const both = (th: number) => {
        const x = crossing(at(), th, searchMax)
        if (x == null) return { x, range: null }
        // without a ± anywhere, every bound is the stated value
        if (!uncertain.length) return { x, range: { low: x, high: x } }
        const low = crossing(at('low'), th, searchMax) ?? x
        const high = crossing(at('high'), th, searchMax) ?? x
        return { x, range: { low, high } }
      }
      const t = both(thresholds.target)
      const f = both(thresholds.full)
      components[c] = { target: t.x, full: f.x, targetRange: t.range, fullRange: f.range }
    }
    // the hint costs two crossings per uncertain capacity: only when someone reads it
    let hint: ReturnType<Crossings['measure']> | undefined
    const out: Crossings = { components, measure: () => (hint ??= measure(values, uncertain, components)) }
    if (crossingCache.size > 64) crossingCache.delete(crossingCache.keys().next().value!)
    crossingCache.set(key, out)
    return out
  }

  /**
   * The capacity whose ± matters most: with it at its stated value (the others still ranged), the target range
   * narrows the most. Only when the range is wider than 10 %.
   */
  const measure = (
    values: LooseValues,
    uncertain: readonly string[],
    components: Crossings['components'],
  ): ReturnType<Crossings['measure']> => {
    const ranges = Object.values(components).flatMap((r) => (r.targetRange ? [r.targetRange] : []))
    if (!uncertain.length || !ranges.length) return null
    const now = { low: Math.min(...ranges.map((r) => r.low)), high: Math.min(...ranges.map((r) => r.high)) }
    const width = (r: CrossingRange) => Math.log(Math.min(r.high, searchMax * 2) / r.low)
    if (!(now.low > 0 && Number.isFinite(now.low)) || width(now) <= Math.log(1.1)) return null
    let best: { component: string; target: CrossingRange; gain: number } | null = null
    for (const k of uncertain) {
      const low = crossing(envelope(values, 'low', k), thresholds.target, searchMax)
      const high = crossing(envelope(values, 'high', k), thresholds.target, searchMax)
      if (low == null || high == null || !(low > 0)) continue
      const target = { low, high }
      const gain = width(now) - width(target)
      if (gain > 0.01 && (!best || gain > best.gain)) best = { component: k, target, gain }
    }
    if (!best) return null
    // the first limit then: whichever is highest where the pessimistic edge is reached
    const util = utilAt(values, 'low', best.component)(best.target.low)
    let first = best.component
    for (const c of componentIds) {
      const u = util[c] as number | null
      if (u != null && u > ((util[first] as number | null) ?? Number.NEGATIVE_INFINITY)) first = c
    }
    return { component: best.component, target: best.target, firstLimit: first }
  }

  const resolveStages = (
    ctx: LooseValues,
    shed: (s: string) => number,
    plain: (c: string) => number | null,
    assignment: (s: string) => WorkersAssignment | undefined,
    hot: (s: string) => Record<string, number> | undefined,
    shedBy: (s: string) => Record<string, number> | undefined,
  ) => {
    const stages = {} as Record<S, ResolvedStage>
    for (const s of stageIds) {
      const st = resolveStage(s, def.stages[s] as StageDef, ctx, flowIds, thresholds.full, plain)
      const a = st.kind === 'workers' ? assignment(s) : undefined
      const skew = st.kind === 'queue' ? hot(s) : undefined
      stages[s] =
        st.kind === 'pass' || st.kind === 'limit' || st.kind === 'cache' || st.kind === 'split'
          ? withShedBy({ ...st, shed: shed(s) }, shedBy(s))
          : a
            ? ({ ...st, assignment: a } as ResolvedStage)
            : skew
              ? ({ ...st, skew } as ResolvedStage)
              : st
    }
    for (const st of Object.values(stages) as ResolvedStage[])
      if (st.kind === 'fanout')
        for (const b of Object.values(st.to).flat()) {
          const to = (stages as Record<string, ResolvedStage>)[b.stage]
          if (!to || to.kind === 'queue' || to.kind === 'workers' || to.kind === 'fanout' || to.kind === 'split')
            throw new Error(
              `loadmap: fan-out "${st.id}" branches to "${b.stage}", which is not a sink, store or pass stage`,
            )
        }
    return stages
  }

  const evaluate = (partial?: Partial<Values<P>>): Evaluation<P, F, C, S> => {
    const values = { ...defaults(), ...partial } as Values<P>
    const {
      ctx,
      capacity,
      enabled,
      over,
      describe,
      overload: overloadOf,
      retries,
      shed,
      paths,
      held,
      holders,
      latencies,
      plain,
      spread,
      connectionText,
      assignment,
      hot,
      stock,
      runsOf,
      failedFor,
      shedByOf,
      breakerOf,
      admitted,
      failedFast,
      rate,
    } = context(def as any, values)
    const crossings = crossingsFor(values)
    let latency: Record<F, Latency | null> | undefined

    const components = {} as Record<C, ComponentResult<C>>
    for (const c of componentIds) {
      const d = def.components[c]
      const util = ctx.util[c] as number | null
      const off = util == null
      const missing = off && enabled(c) ? capacity(c).missing : undefined
      components[c] = {
        id: c,
        name: d.name,
        short: d.short ?? d.name,
        plural: d.plural ?? false,
        util,
        demand: off ? null : (ctx.demand[c] as number),
        capacity: off && missing == null ? null : capacity(c),
        state: off ? 'off' : util > thresholds.full ? 'over' : util > thresholds.target ? 'warn' : 'ok',
        ...crossings.components[c]!,
        over: over(c),
        describe: describe(c),
      }
      if (missing != null) components[c].missing = missing
      const st = enabled(c) ? stock(c) : undefined
      if (st) components[c].stock = st
      const run = off ? null : runsOf(c)
      // a run takes its window at full: what is past it misses the window, whatever the threshold
      if (run) components[c].runs = { ...run, takes: (run.within * util!) / thresholds.full }
      const per = off ? undefined : quotaOf.get(c)
      // a quota is hard: past all it allows it is gone, whatever the full threshold
      if (per)
        components[c].quota = { per, ...(util != null && util > 1 ? { goneAfter: QUOTA_SECONDS[per] / util } : {}) }
      const sp = off ? null : spread(c)
      if (sp?.text) components[c].spread = { factor: sp.factor, text: sp.text }
      const h = off ? null : held(c)
      if (h) {
        const on = holders(c)
        components[c].held = Object.fromEntries(
          Object.entries(h).filter(([f]) => paths(f).some((p) => p.stages.some((s) => on.includes(s)))),
        )
      }
    }

    const all = componentIds.map((c) => components[c])
    const live = all.filter((r) => r.util != null)
    // switched-off components go last, after live ones that never reach the target
    const order = (x: number | null | undefined) => (x == null ? Number.POSITIVE_INFINITY : x)
    const cmp = (x: number | null | undefined, y: number | null | undefined) =>
      order(x) === order(y) ? 0 : order(x) < order(y) ? -1 : 1
    // on the pessimistic edge first: a limit that may come early outranks one that surely comes a little later
    const ranked = [...all].sort(
      (a, b) =>
        Number(a.util == null) - Number(b.util == null) ||
        cmp(a.targetRange?.low, b.targetRange?.low) ||
        cmp(a.target, b.target) ||
        cmp(a.fullRange?.low, b.fullRange?.low),
    )
    const firstLimit = live.length ? ranked[0]! : null
    const firstFull = live.length ? live.reduce((a, b) => (cmp(b.fullRange?.low, a.fullRange?.low) < 0 ? b : a)) : null
    const edges = (k: 'targetRange' | 'fullRange'): CrossingRange | null => {
      const rs = live.flatMap((r) => (r[k] ? [r[k]] : []))
      return rs.length ? { low: Math.min(...rs.map((r) => r.low)), high: Math.min(...rs.map((r) => r.high)) } : null
    }
    const target = edges('targetRange')
    const full = edges('fullRange')

    const flows = {} as Record<F, number>
    for (const f of flowIds) flows[f] = ctx.flows[f] as number
    const stages = resolveStages(ctx, shed, plain, assignment, hot, shedByOf)
    const overload = {} as Record<F, Overload>
    for (const f of flowIds) overload[f] = overloadOf(f)
    const at = {} as Record<S, Record<F, number>>
    for (const s of stageIds) {
      const row = {} as Record<F, number>
      for (const f of flowIds) row[f] = ctx.at[s][f] as number
      at[s] = row
    }

    const assumptions: Assumption[] = []
    for (const c of componentIds) {
      const cap = components[c].capacity ?? capacity(c)
      assumptions.push({ kind: 'capacity', component: c, name: def.components[c].name, capacity: cap })
      const l = def.components[c].level
      if (l != null) {
        const level = typeof l === 'function' ? l(values) : l
        const name = `${def.components[c].name}, its level${growth ? ` on ${growth.asOf}` : ''}`
        assumptions.push({ kind: 'capacity', component: c, name, capacity: level })
      }
    }
    for (const name of Object.keys(def.connections ?? {}))
      assumptions.push({ kind: 'connection', name, text: connectionText(name) })
    for (const [name, fit] of Object.entries(def.calibration ?? {})) assumptions.push({ kind: 'fit', name, fit })
    // a reading a capacity or a fit already shows with its origin is not listed twice
    const shown = new Set(
      assumptions.flatMap((a) =>
        a.kind === 'capacity' ? [a.capacity.origin] : a.kind === 'fit' ? [a.fit.origin?.x, a.fit.origin?.y] : [],
      ),
    )
    for (const [name, m] of Object.entries(def.snapshot?.measurements ?? {}))
      if (!m.origin || !shown.has(m.origin)) assumptions.push({ kind: 'measurement', name, measurement: m })

    return {
      values,
      flows,
      components,
      ranked,
      firstLimit,
      firstFull,
      target,
      full,
      verdict: verdict(values.load, live, firstLimit, target, thresholds, searchMax, when, unranked(all)),
      get measure() {
        return measureText(crossings.measure(), components, firstLimit, thresholds, searchMax)
      },
      presets: presets(def, target, full, thresholds, searchMax),
      assumptions,
      stages,
      routes: def.routes as Record<F, readonly S[]>,
      paths: Object.fromEntries(flowIds.map((f) => [f, paths(f)])) as unknown as Record<F, readonly FlowPath<S>[]>,
      at,
      overload,
      retry: retries() as Partial<Record<F, Retry>>,
      breakers: Object.fromEntries(
        flowIds.flatMap((f) => {
          const b = breakerOf(f)
          return b ? [[f, { opens: b.opens, rate: rate(f), admitted: admitted(f), failedFast: failedFast(f) }]] : []
        }),
      ) as Partial<Record<F, { opens: number; rate: number; admitted: number; failedFast: number }>>,
      fallbacks: Object.fromEntries(
        flowIds.flatMap((f) => {
          const fb = def.flows[f].fallback
          return fb ? [[f, { after: fb.after, route: fb.route, rate: failedFor(f) }]] : []
        }),
      ) as Partial<Record<F, Fallback<S> & { rate: number }>>,
      // the gamma fits cost a bisection each: only for a reader that asks
      get latency() {
        latency ??= latencies() as Record<F, Latency | null>
        return latency
      },
      ctx,
    }
  }

  return {
    // as written: the limits connections make live in the model, not in the definition
    def: written as ModelDef<any, any, any, any, any>,
    title: def.title,
    load: def.load,
    params: paramList,
    flowIds,
    componentIds,
    stageIds,
    thresholds,
    searchMax,
    scenarios,
    expectations,
    story,
    growth,
    defaults,
    isEnabled: (id, values) => {
      const d = paramList.find((x) => x.id === id)?.def
      return d ? isEnabled(d, values) : false
    },
    evaluate,
    stagesAt: (partial) => {
      const values = { ...defaults(), ...partial } as Values<P>
      const { ctx, shed, plain, assignment, hot, paths, shedByOf } = context(def as any, values)
      let ways: Record<F, readonly FlowPath<S>[]> | undefined
      return {
        values,
        ctx,
        stages: resolveStages(ctx, shed, plain, assignment, hot, shedByOf),
        // the layout's load sweeps call this for many values and never read the ways: worked out on first read
        get paths() {
          ways ??= Object.fromEntries(flowIds.map((f) => [f, paths(f)])) as unknown as Record<F, readonly FlowPath<S>[]>
          return ways
        },
      }
    },
    utilization: (partial, bound) => {
      const util = context(def as any, { ...defaults(), ...partial }, bound).ctx.util as Record<C, number | null>
      return Object.fromEntries(componentIds.map((c) => [c, util[c]])) as Record<C, number | null>
    },
    latency: (partial, bound, only) =>
      context(def as any, { ...defaults(), ...partial }, bound).latencies(only) as Record<F, Latency | null>,
    scenarioOf,
    dateAt: when,
  }
}

/**
 * The model's numbers for one set of values. Every number is computed on first use and kept, so a model function
 * may read any other; a value that needs itself throws, naming the loop. Retries are the one loop that is solved:
 * a retrying flow's attempts settle where the share its route turns away gives back the same attempts.
 */
function context(
  def: ModelDef<any, string, string, string, string>,
  values: LooseValues,
  bound?: Bound,
  pinned?: string,
  fixed?: Readonly<Record<string, number>>,
  slow?: Readonly<Record<string, number>>,
  averaged?: boolean,
  trial?: Readonly<Record<string, number>>,
) {
  const unsolved = Object.keys(def.flows).filter(
    (f) => def.flows[f]!.breaker != null && !(trial && Object.hasOwn(trial, f)),
  )
  if (!unsolved.length) return contextAt(def, values, bound, pinned, fixed, slow, averaged, trial)
  // Every breaker admitting its whole flow first: where none fails past where it opens there, that is the answer, so
  // nearly every evaluation costs what it cost without breakers, where solving each on a trial of its own made two
  // contexts of every one. Else, or where asking throws, each is solved on trials, and the error comes where it did.
  const whole = contextAt(def, values, bound, pinned, fixed, slow, averaged, trial, new Set(unsolved))
  const failures: Record<string, number> = {}
  try {
    const closed = (f: string) => {
      const b = whole.breakerOf(f)
      if (b == null || !(whole.rate(f) > 0)) return true
      failures[f] = whole.failure(f)
      return failures[f] <= b.opens
    }
    if (unsolved.every(closed)) return whole
  } catch {}
  // one breaker alone: what it failed here is its trial at the whole flow, so its solve starts from it
  const known = unsolved.length === 1 ? failures : undefined
  return contextAt(def, values, bound, pinned, fixed, slow, averaged, trial, undefined, known)
}

function contextAt(
  def: ModelDef<any, string, string, string, string>,
  values: LooseValues,
  bound?: Bound,
  /** A component whose capacity stays at its stated value under a bound. */
  pinned?: string,
  /** The attempts of every retrying flow, held while the retries are solved. */
  fixed?: Readonly<Record<string, number>>,
  /** The share of each retrying flow too slow for its timeout, held while the retries are solved. */
  slow?: Readonly<Record<string, number>>,
  /** Every flow at its average, not its peak: what a stock gains. */
  averaged?: boolean,
  /** A flow held at a breaker's trial rate: its breaker is not solved again, and it fails nothing fast. */
  trial?: Readonly<Record<string, number>>,
  /** The breaker flows taken to admit all of their rate: what `context` asks first. */
  admitsAll?: ReadonlySet<string>,
  /** What a breaker flow fails admitted whole, found by `context` already. */
  failsWhole?: Readonly<Record<string, number>>,
) {
  const cache = new Map<string, unknown>()
  const stack: string[] = []
  // an error belongs to the first memo it leaves: a flow is blamed only for what its own computation raised
  const seen = new WeakSet<object>()
  const memo = <T>(key: string, f: () => T, flow?: string): T => {
    if (cache.has(key)) return cache.get(key) as T
    if (stack.includes(key)) {
      const loop = new Error(`loadmap: ${[...stack.slice(stack.indexOf(key)), key].join(' → ')} is a loop`)
      // no one flow's fault
      seen.add(loop)
      throw loop
    }
    stack.push(key)
    try {
      const v = f()
      cache.set(key, v)
      return v
    } catch (err) {
      if (typeof err === 'object' && err !== null && !seen.has(err)) {
        seen.add(err)
        if (flow) blame(err, flow)
      }
      throw err
    } finally {
      stack.pop()
    }
  }
  const table = (ids: readonly string[], get: (id: string) => unknown) => {
    const t = {}
    for (const id of ids) Object.defineProperty(t, id, { enumerable: true, get: () => get(id) })
    return Object.freeze(t)
  }

  const ctx: Record<string, any> = { ...values }
  const full = def.thresholds?.full ?? 1
  const flowIds = Object.keys(def.flows)
  const componentIds = Object.keys(def.components)
  const stages = def.stages as Record<string, StageDef>
  const stageIds = Object.keys(stages)
  const routes = def.routes as Record<string, readonly string[]>
  const capacity = (c: string) =>
    memo(`capacity of ${c}`, () => {
      const cap = def.components[c]!.capacity
      return typeof cap === 'function' ? cap(ctx as any) : cap
    })
  const enabled = (c: string): boolean =>
    memo(`${c} enabled`, () => {
      // a limit a connection's accepts makes is off with the component of the stage it counts against
      const head = Object.hasOwn(def.connections ?? {}, c) ? def.connections![c] : undefined
      const target = head?.accepts != null ? opener(stages, head)?.target : undefined
      const of = target == null ? undefined : (stages[target] as { component?: string }).component
      if (of != null && !enabled(of)) return false
      return def.components[c]!.when?.(ctx as any) ?? true
    })
  /** The seconds a unit of each flow holds one of the component's slots; null when it does not count slots. */
  const held = (c: string) =>
    memo(`held of ${c}`, () => {
      const d = def.components[c]!
      if (d.held == null) return null
      const h = typeof d.held === 'function' ? d.held(ctx as any) : d.held
      if (typeof h !== 'number')
        for (const f of Object.keys(h))
          if (!flowIds.includes(f)) throw new Error(`loadmap: component "${c}" is held by unknown flow "${f}"`)
      const out: Record<string, number> = {}
      for (const f of flowIds) {
        const v = typeof h === 'number' ? h : (h[f] ?? 0)
        if (!Number.isFinite(v) || v < 0)
          throw new Error(`loadmap: component "${c}" is held ${v} s by each unit of "${f}": a time from 0 up`)
        out[f] = v
      }
      const unit = capacity(c).unit
      if (/\/\s*(s|sec|second|min|minute|h|hour)$|\bper (sec|min|hour)|^[rq]p[sm]$/i.test(unit.trim()))
        throw new Error(
          `loadmap: component "${c}" is held, so its capacity counts slots ("connections", "sessions"), not "${unit}"`,
        )
      return out
    })
  const overload = (f: string): Overload =>
    memo(`overload of ${f}`, () => {
      const o = def.flows[f]!.overload
      return (typeof o === 'function' ? o(ctx as any) : o) ?? {}
    })
  const retryOf = (f: string) => {
    const rule = def.flows[f]!.retry
    const r = typeof rule === 'function' ? rule(values) : rule
    if (!r) return undefined
    if (!(Number.isInteger(r.times) && r.times >= 0))
      throw new Error(`loadmap: flow "${f}" retries a whole number of times, not ${r.times}`)
    if (r.budget != null && !(r.budget >= 0 && Number.isFinite(r.budget)))
      throw new Error(`loadmap: flow "${f}" needs a retry budget of 0 or more, not ${r.budget}`)
    return r.times > 0 && r.budget !== 0 ? r : undefined
  }
  const averageOf = (f: string) =>
    memo(`average of ${f}`, () => {
      const a = def.flows[f]!.average
      const v = typeof a === 'function' ? a(values) : (a ?? 1)
      if (!(v > 0 && v <= 1))
        throw new Error(`loadmap: flow "${f}" averages ${v} of its peak: a share above 0, up to 1`)
      return v
    })
  const rateOf = (f: string) => {
    const r = def.flows[f]!.rate
    const v = typeof r === 'function' ? r(ctx as any) : r
    return averaged ? v * averageOf(f) : v
  }
  const rate = (f: string) => memo(`rate of ${f}`, () => rateOf(f), f)
  const breakerOf = (f: string) =>
    memo(`breaker of ${f}`, () => {
      const b = def.flows[f]!.breaker
      const v = typeof b === 'function' ? b(values) : b
      if (v != null && !(v.opens > 0 && v.opens < 1))
        throw new Error(
          `loadmap: flow "${f}"'s breaker opens past a share of failures above 0 and below 1, not ${v.opens}`,
        )
      if (v != null && retryOf(f))
        throw flowError(
          `loadmap: flow "${f}" has a breaker and retries: each would decide what the other sees, so give it one of them`,
          f,
          'breaker',
        )
      return v
    })
  /**
   * The share of a flow its breaker admits: 1 while its failures stay at or under `opens`; past that, the α at which
   * the failures among the admitted are `opens`. Each trial is a whole evaluation of the flow's way, on every load the
   * ranking scans past where it opens, so the steps count. One saturated stage fails 1 − C/x, whose root is one step
   * away from any point: it settles the usual case in two or three trials. A step that does not halve the bracket is
   * followed by a secant, two by a bisection, so the bracket halves at least every third trial whatever the curve.
   */
  const admitted = (f: string): number =>
    memo(`admitted of ${f}`, () => {
      if (admitsAll?.has(f)) return 1
      const b = breakerOf(f)!
      const lam = rate(f)
      // each trial holds the flow at its trial rate, the other values and the averaged flag as they are here
      const excess = (x: number) =>
        context(def, values, bound, pinned, fixed, slow, averaged, { ...trial, [f]: x * lam }).failure(f) - b.opens
      if (!(lam > 0)) return 1
      const full = failsWhole && Object.hasOwn(failsWhole, f) ? failsWhole[f]! - b.opens : excess(1)
      if (!(full > 0)) return 1
      // the secant's other end: nothing admitted fails nothing. Where something fails anyway (a latency past the
      // timeout at any rate) the root is 0, and the bisections reach it.
      let lo = 0
      let flo = -b.opens
      let hi = 1
      let fhi = full
      let missed = 0
      let x = (1 - (full + b.opens)) / (1 - b.opens)
      for (let i = 0; i < 120 && hi - lo > 1e-12; i++) {
        if (missed > 1) x = (lo + hi) / 2
        else if (missed === 1 || !(x > lo && x < hi)) {
          const secant = (lo * fhi - hi * flo) / (fhi - flo)
          x = secant > lo && secant < hi ? secant : (lo + hi) / 2
        }
        const width = hi - lo
        const fx = excess(x)
        if (fx > 0) {
          hi = x
          fhi = fx
        } else {
          lo = x
          flo = fx
          if (fx === 0) break
        }
        missed = hi - lo <= width / 2 ? 0 : missed + 1
        const step = (x * (1 - (fx + b.opens))) / (1 - b.opens)
        // a step onto a bound says the root is there: the point just inside settles it
        x = step <= lo ? lo + 1e-12 : step >= hi ? hi - 1e-12 : step
      }
      return lo
    })
  /** What a flow's breaker fails fast, units a second: they reach no stage. */
  const failedFast = (f: string) =>
    breakerOf(f) && !(trial && Object.hasOwn(trial, f)) && !admitsAll?.has(f) ? rate(f) * (1 - admitted(f)) : 0
  ctx.flows = table(flowIds, (f) =>
    memo(
      `flow ${f}`,
      () => {
        if (fixed && Object.hasOwn(fixed, f)) return fixed[f]!
        if (trial && Object.hasOwn(trial, f)) return trial[f]!
        if (admitsAll?.has(f)) return rate(f)
        if (breakerOf(f)) return rate(f) * admitted(f)
        return retryOf(f) ? retries()[f]!.attempts : rateOf(f)
      },
      f,
    ),
  )

  /** A split's branches for each flow, checked. */
  const branchesOf = (s: string) =>
    memo(`branches of ${s}`, () =>
      splitOf(s, stages[s] as Extract<StageDef, { kind: 'split' }>, ctx as LooseValues, flowIds),
    ) as Readonly<Record<string, readonly SplitBranch[]>>
  /**
   * A flow's ways through: its route, once per branch of each split on it, with the share of units that go that way.
   * A branch that ends in a store, a sink or a fan-out ends there; any other rejoins the route after the split.
   */
  const paths = (f: string) =>
    memo(
      `paths of ${f}`,
      () => {
        const out: FlowPath[] = []
        const walk = (done: string[], rest: readonly string[], share: number, depth: number) => {
          if (depth > 16) throw new Error(`loadmap: the splits on the route of "${f}" nest more than 16 deep`)
          for (const [i, s] of rest.entries()) {
            const st = stages[s]
            if (!st) throw new Error(`loadmap: flow "${f}" goes through unknown stage "${s}"`)
            const branches = st.kind === 'split' ? branchesOf(s)[f] : undefined
            if (branches?.length) {
              const after = rest.slice(i + 1)
              for (const b of branches) {
                const end = stages[b.stages.at(-1)!]?.kind
                const ends = end === 'store' || end === 'sink' || end === 'fanout'
                const twice = ends ? undefined : b.stages.find((x) => after.includes(x))
                if (twice)
                  throw new Error(
                    `loadmap: split "${s}" sends "${f}" through "${twice}", which the route takes after it: a way names only the stages before it rejoins`,
                  )
                walk([...done, s], [...b.stages, ...(ends ? [] : after)], share * b.share, depth + 1)
              }
              return
            }
            done.push(s)
          }
          out.push({ stages: done, share })
        }
        walk([], routes[f] ?? [], 1, 0)
        for (const p of out)
          p.stages.forEach((s, i) => {
            if (stages[s]!.kind === 'fanout' && i < p.stages.length - 1)
              throw new Error(`loadmap: fan-out "${s}" must be the last stage on every way "${f}" goes`)
            // a queue is drained by the stage after it; a split without a component would drain it at any rate
            const next = stages[p.stages[i + 1] ?? '']
            if (stages[s]!.kind === 'queue' && next?.kind === 'split' && !next.component)
              throw new Error(
                `loadmap: queue "${s}" is drained by split "${p.stages[i + 1]}", which has no component: give it one, or split before the queue`,
              )
          })
        return out as readonly FlowPath[]
      },
      f,
    )

  /** The share a stage turns away: past its component's `full`, what is above it. */
  const rejects = (s: string) =>
    memo(`rejects at ${s}`, () => {
      const st = stages[s]!
      if (
        !(
          st.kind === 'pass' ||
          st.kind === 'limit' ||
          st.kind === 'cache' ||
          st.kind === 'fanout' ||
          st.kind === 'split'
        ) ||
        !st.component
      )
        return 0
      return rejectShare(ctx.util[st.component] as number | null, full)
    })
  /** A pass that turns away by priority: the flow with the larger number first. */
  const byPriority = (s: string) => {
    const st = stages[s]!
    return st.kind === 'pass' && st.shed === 'priority'
  }
  /**
   * The share of a flow's offered units a stage turns away. A pass that sheds by priority lets through what it always
   * would, (1 − rejects) of all that is offered, but priority 1 first: a flow is turned away only once those before it
   * have what they ask.
   */
  const rejectsFor = (s: string, f: string): number => {
    if (!byPriority(s)) return rejects(s)
    return memo(`rejects of ${f} at ${s}`, () => {
      const r = rejects(s)
      if (!r) return 0
      const offered = new Map(flowIds.map((g) => [g, arriving(s, g)]))
      let room = [...offered.values()].reduce((a, x) => a + x, 0) * (1 - r)
      const prio = (g: string) => (def.flows[g]!.priority as number | undefined) ?? 1
      for (const p of [...new Set(flowIds.map(prio))].sort((a, b) => a - b)) {
        const group = flowIds.filter((g) => prio(g) === p)
        const want = group.reduce((a, g) => a + offered.get(g)!, 0)
        if (group.includes(f)) return want > room ? 1 - (want > 0 ? room / want : 1) : 0
        room = Math.max(0, room - want)
      }
      return 0
    })
  }
  const hit = (s: string) => memo(`hit at ${s}`, () => hitOf(s, stages[s] as Extract<StageDef, { kind: 'cache' }>, ctx))
  /** The share of a flow's units that go on past a stage: cache hits stay, and what a limiter turns away. */
  const onward = (s: string) => {
    const st = stages[s]!
    return st.kind === 'cache' ? 1 - hit(s) : st.kind === 'limit' ? 1 - rejects(s) : 1
  }
  /** Copies per unit of a flow that a fan-out at t sends to s: 0 unless t is a fan-out with a branch there. */
  const copies = (t: string, f: string, s: string) => {
    const st = stages[t]!
    if (st.kind !== 'fanout') return 0
    const to = memo(`branches of ${t}`, () => dyn(st.to, ctx)) as
      | readonly Branch[]
      | Readonly<Record<string, readonly Branch[]>>
    let n = 0
    for (const b of Array.isArray(to) ? to : ((to as Record<string, readonly Branch[]>)[f] ?? []))
      if ((b as Branch).stage === s) n += (b as Branch).share
    return n
  }
  const arriving = (s: string, f: string) =>
    memo(`${f} at ${s}`, () => {
      if (stages[s]!.kind === 'lost') return lostAt(s, f)
      const fb = def.flows[f]!.fallback
      const k = fb?.route.indexOf(s) ?? -1
      if (k >= 0) {
        // what the flow fails for good, less what the fallback's stages before this one answered or turned away
        let r = failedFor(f)
        for (const t of fb!.route.slice(0, k)) r *= (1 - shedFor(t, f)) * (stages[t]!.kind === 'cache' ? 1 - hit(t) : 1)
        return r
      }
      let total = 0
      // each way the flow goes, for the share of its units that go that way
      for (const { stages: route, share } of paths(f)) {
        // past the last place that reaches s (the stage itself, or a fan-out that copies to it) nothing counts, so a
        // stage never needs what it lets through to know what reaches it
        const last = route.findLastIndex((t) => t === s || copies(t, f, s) > 0)
        let r = (ctx.flows[f] as number) * share
        for (const [i, t] of route.entries()) {
          if (t === s) total += r
          total += r * copies(t, f, s)
          if (i >= last) break
          r *= onward(t)
        }
      }
      return total
    })
  const inner = new Map<string, object>()
  ctx.at = table(stageIds, (s) => {
    const known = inner.get(s)
    if (known) return known
    const t = table(flowIds, (f) => arriving(s, f))
    inner.set(s, t)
    return t
  })

  /**
   * The share of what reaches a queue that it drops, on the way that goes on to `after`: in steady state what its
   * reader there cannot drain (the rate the sim drains it at). 0 without a drop rule, or a reader with a component.
   */
  const drops = (f: string, s: string, after: string | undefined) => {
    const next = stages[after ?? '']
    if (stages[s]!.kind !== 'queue' || !next || !('component' in next) || !next.component || !overload(f).drop) return 0
    return rejectShare(ctx.util[next.component] as number | null, full)
  }

  /**
   * The share of a flow's attempts turned away somewhere on its route; a cache hit is an answer, not a failure. A
   * stage's rejections are counted against what is offered to it, so behind another stage that turns work away it
   * passes at most what it can take (offered × (1 − rejects)), not a share of a share: the bottleneck decides.
   */
  const failure = (f: string) =>
    memo(`failures of ${f}`, () => {
      let failed = 0
      let dropped = 0
      for (const { stages: route, share } of paths(f)) {
        let offered = 1
        let actual = 1
        let answered = 0
        let gone = 0
        for (const [i, s] of route.entries()) {
          // a fan-out turns away copies, not the unit
          const r = stages[s]!.kind === 'fanout' ? 0 : rejectsFor(s, f)
          if (r > 0) actual = Math.min(actual, offered * (1 - r))
          const d = drops(f, s, route[i + 1])
          if (d > 0) {
            gone += actual * d
            actual *= 1 - d
          }
          if (stages[s]!.kind === 'cache') {
            answered += actual * hit(s)
            actual *= 1 - hit(s)
          }
          offered *= onward(s)
        }
        failed += share * Math.max(0, 1 - answered - actual - gone)
        dropped += share * gone
      }
      // a unit that got through can still be too slow for its client; a dropped one is lost at its queue, never
      // sent again: it neither failed nor got through
      const late = slow?.[f] ?? timedOut(f)
      if (!(late > 0)) return failed
      // without a drop both say the same: the second keeps every digit a flow with no drop rule had
      return dropped > 0 ? failed + Math.max(0, 1 - failed - dropped) * late : 1 - (1 - failed) * (1 - late)
    })

  /**
   * What actually reaches a stage, per second: like `at`, less what stages before it turned away or dropped. A stage
   * takes up to what is offered to it × (1 − rejects), so behind another stage that turns work away the bottleneck
   * decides; a reader behind a queue that drops is reached only by what it can drain, and turns none of it away.
   */
  const actual = (s: string, f: string) =>
    memo(`${f} reaching ${s}`, () => {
      if (stages[s]!.kind === 'lost') return lostAt(s, f)
      // a fallback's stage is reached by what its flow fails for good, less what the fallback's stages before it took
      if (def.flows[f]!.fallback?.route.includes(s)) return arriving(s, f)
      const ways = paths(f)
      let total = 0
      for (const { stages: route, share } of ways) {
        const last = route.findLastIndex((t) => t === s || copies(t, f, s) > 0)
        let r = (ctx.flows[f] as number) * share
        // what is offered at each stage on this way: on a route with one way, what reaches it
        let offered = r
        // the share the queue in front of this stage dropped: its reader then turns nothing away
        let fed = 0
        for (const [i, t] of route.entries()) {
          if (t === s) total += r
          // a fan-out's copies, less the share it turns away (none of what a dropping queue let it read)
          total += r * copies(t, f, s) * (fed > 0 ? 1 : 1 - rejects(t))
          if (i >= last) break
          const cut = rejectsFor(t, f)
          if (cut > 0) r = Math.min(r, (ways.length === 1 ? arriving(t, f) : offered) * (1 - cut))
          fed = drops(f, t, route[i + 1])
          r *= 1 - fed
          if (stages[t]!.kind === 'cache') r *= 1 - hit(t)
          offered *= onward(t)
        }
      }
      return total
    })
  /** The share of what actually reaches a stage that it turns away: the one number the sim and the meters show. */
  const shed = (s: string) =>
    memo(`shed at ${s}`, () => {
      const r = rejects(s)
      if (!r) return 0
      let reaching = 0
      if (byPriority(s)) {
        // the share of all that reaches it: each flow's, weighed by what reaches it of that flow
        let turned = 0
        for (const f of flowIds) {
          reaching += actual(s, f)
          turned += actual(s, f) * shedFor(s, f)
        }
        return reaching > 0 ? turned / reaching : 0
      }
      let offered = 0
      for (const f of flowIds) {
        offered += arriving(s, f)
        reaching += actual(s, f)
      }
      return reaching > 0 ? Math.max(0, 1 - (offered * (1 - r)) / reaching) : 0
    })
  /** Of what actually reaches a stage of a flow, the share it turns away: the stage's own unless it sheds by priority. */
  const shedFor = (s: string, f: string): number => {
    if (!byPriority(s)) return shed(s)
    return memo(`shed of ${f} at ${s}`, () => {
      const r = rejectsFor(s, f)
      const reaching = actual(s, f)
      return r > 0 && reaching > 0 ? Math.max(0, 1 - (arriving(s, f) * (1 - r)) / reaching) : 0
    })
  }

  /**
   * What each stage loses of a flow, per second, by loss, before any retry: what it turns away of what reaches it,
   * what a queue drops (in steady state, what its reader cannot drain: the rate the sim drains it at), and what is too
   * slow for the client at the end of each way (a cache's answers at the cache). Each way is walked as a unit goes
   * it, so a unit is lost once: only what a stage let through reaches the next, and only what got to the end of its
   * way (or was answered by a cache) can be too slow.
   */
  const causes = (f: string) =>
    memo(`losses of ${f}`, () => {
      const out: { stage: string; loss: Loss; rate: number }[] = []
      const add = (stage: string, loss: Loss, rate: number) => {
        if (!(rate > 0)) return
        // a stage on several ways loses on each
        const known = out.find((c) => c.stage === stage && c.loss === loss)
        if (known) known.rate += rate
        else out.push({ stage, loss, rate })
      }
      // the share too slow of each timed part of a way: `${path}` at its end, `${path}/${cache}` answered there
      const slowOf = new Map<string, { share: number; late: number }>()
      const t = timeoutOf(f)
      const times = t == null ? undefined : timesOf(f)
      if (t != null && times)
        times.tags.forEach((tag, i) => {
          const w = times.ways[i]!
          const key = tag.answeredAt == null ? `${tag.path}` : `${tag.path}/${tag.answeredAt}`
          const part = slowOf.get(key) ?? { share: 0, late: 0 }
          part.share += w.share
          part.late += w.share * beyond([{ ...w, share: 1 }], t)
          slowOf.set(key, part)
        })
      const late = (key: string) => {
        const part = slowOf.get(key)
        return part && part.share > 0 ? part.late / part.share : 0
      }
      for (const [i, way] of paths(f).entries()) {
        let r = (ctx.flows[f] as number) * way.share
        for (const [j, s] of way.stages.entries()) {
          const st = stages[s]!
          if (st.kind === 'pass' || st.kind === 'limit' || st.kind === 'cache' || st.kind === 'split') {
            const turned = r * shedFor(s, f)
            add(s, 'rejected', turned)
            r -= turned
          }
          const dropped = r * drops(f, s, way.stages[j + 1])
          add(s, 'dropped', dropped)
          r -= dropped
          if (st.kind === 'cache') {
            // a cache's answer is too slow at the cache; any other unit at the end of its way
            add(s, 'timedOut', r * hit(s) * late(`${i}/${s}`))
            r *= 1 - hit(s)
          }
        }
        const end = way.stages.at(-1)
        if (end) add(end, 'timedOut', r * late(`${i}`))
      }
      return out
    })
  /** The stages past where a flow falls back after, on any of its ways: only what fails there reached it. */
  const pastAfter = (f: string) =>
    memo(`${f} past its fallback's after`, () => {
      const fb = def.flows[f]!.fallback
      const out = new Set<string>()
      if (fb) for (const p of paths(f)) for (const s of p.stages.slice(p.stages.indexOf(fb.after) + 1)) out.add(s)
      return out
    })
  /**
   * Of what a flow fails, the units a second for good (after every retry; inside the retries' solve, where none are
   * known, every failure) and the share of them that `at` stages.
   */
  const forGood = (f: string, at?: ReadonlySet<string>) => {
    const failing = causes(f).filter((c) => c.loss !== 'dropped')
    const all = failing.reduce((a, c) => a + c.rate, 0)
    const there = at ? failing.filter((c) => at.has(c.stage)).reduce((a, c) => a + c.rate, 0) : all
    if (fixed) return there
    const r = retryOf(f) ? retries()[f] : undefined
    return r ? (all > 0 ? (r.rate * r.failed * there) / all : 0) : there
  }
  /**
   * The units a second a flow's fallback serves: what it fails for good past where it falls back after; what failed
   * before it never reached it.
   */
  const failedFor = (f: string) => memo(`${f} failed for good`, () => forGood(f, pastAfter(f)) + failedFast(f))
  /**
   * What reaches a lost box of a flow: what its stages lose of what it takes, after every retry. The units a flow fails for
   * good (the model's failed share; without retries, every failure) are shared out over the rejections and timeouts in
   * proportion; a drop is never sent again. With a fallback, what fails past where it falls back after goes on to it.
   */
  const lostAt = (d: string, f: string) =>
    memo(`${f} lost at ${d}`, () => {
      // the retries decide what is lost for good, and they are solved over every other number: none may read it
      if (fixed)
        throw new Error(
          `loadmap: a formula reads at.${d}, what the retries leave lost: the retries cannot depend on it`,
        )
      const st = stages[d] as Extract<StageDef, { kind: 'lost' }>
      const wanted = st.takes ?? LOSSES
      const all = causes(f)
      const failing = all.filter((c) => c.loss !== 'dropped').reduce((a, c) => a + c.rate, 0)
      const k = failing > 0 ? Math.min(1, forGood(f) / failing) : 0
      const fb = def.flows[f]!.fallback
      const served = pastAfter(f)
      let total = 0
      for (const c of all)
        if (st.from.includes(c.stage) && wanted.includes(c.loss))
          total += c.loss === 'dropped' ? c.rate : fb && served.has(c.stage) ? 0 : c.rate * k
      if (fb && wanted.includes('rejected'))
        for (const s of fb.route) if (st.from.includes(s)) total += arriving(s, f) * shedFor(s, f)
      return total
    })

  const retries = (): Record<string, Retry> =>
    memo('retries', () => {
      const ids = flowIds.filter((f) => retryOf(f))
      const lam: Record<string, number> = {}
      for (const f of ids) lam[f] = rate(f)
      // the retries' share of a flow at most: n, or the budget
      const most = (f: string) => {
        const r = retryOf(f)!
        return Math.min(r.times, r.budget ?? Number.POSITIVE_INFINITY)
      }
      const attempts = (e: Record<string, number>) => {
        const a: Record<string, number> = {}
        for (const f of ids) a[f] = lam[f]! * (1 + e[f]!)
        return a
      }
      // The unknowns are the excess of each flow, attempts = λ (1 + e): just past the knee e is tiny, and λ·S(p) − λ
      // would lose it to rounding where p + p² + … + pⁿ keeps every digit, so flows behind one bottleneck step alike.
      // The share of each flow too slow for its timeout is held while they settle: timing a flow costs the time of
      // every stage on its way, too much for each trial of the attempts.
      const wanted = (e: Record<string, number>, late: Readonly<Record<string, number>>) => {
        // a breaker's trial and the averaged flag hold in every trial of the attempts too
        const sub = context(def, values, bound, pinned, attempts(e), late, averaged, trial)
        const w: Record<string, number> = {}
        const p: Record<string, number> = {}
        for (const f of ids) {
          p[f] = sub.failure(f)
          w[f] = Math.min(excess(p[f], retryOf(f)!.times), most(f))
        }
        return { w, p, sub }
      }
      // From below, never past the answer: where the excess calls for more, step along that call as far as it still
      // holds. Flows that share a bottleneck settle on that line in one search; the call rises with the attempts when
      // formulas rise with the load, so the steps climb to the least fixed point.
      // read off the definition: a rule worked out from the values may read what the retries decide
      const falls = ids.some((f) => {
        const o = def.flows[f]!.overload
        return typeof o === 'function' || o?.drop != null
      })
      const solve = (from: Record<string, number>, late: Readonly<Record<string, number>>) => {
        let e = from
        for (let step = 0; step < 100; step++) {
          const { w, p: failed, sub } = wanted(e, late)
          const d: Record<string, number> = {}
          for (const f of ids) d[f] = Math.max(0, w[f]! - e[f]!)
          // after the first search, what is left below 1e-10 is rounding; before it any call counts, since just past
          // the knee a tiny call can still be far from the answer
          const live = ids.filter((f) => lam[f]! > 0 && d[f]! > (step ? 1e-10 * (1 + e[f]!) : 0))
          if (!live.length) return { e, failed, sub }
          const along = (t: number) => {
            const y = { ...e }
            for (const f of live) y[f] = e[f]! + t * d[f]!
            return y
          }
          const holds = (t: number) => {
            const y = along(t)
            const wy = wanted(y, late).w
            return Math.min(...live.map((f) => (wy[f]! - y[f]!) / d[f]!))
          }
          const far = Math.min(...live.map((f) => (most(f) - e[f]!) / d[f]!))
          // t = 1 is the plain step, which holds where the call rises with the attempts. A queue that drops takes more
          // units out of the failures as they rise, so there the call can fall: the step stops where it is met
          const back = (t: number, ht = holds(t)) => (ht < -1e-9 ? settle(holds, 0, t, 1) : t)
          if (far <= 1) e = along(falls ? back(far) : far)
          else {
            const h1 = holds(1)
            e = along(h1 > 0 ? settle(holds, 1, far, h1) : falls ? back(1, h1) : 1)
          }
        }
        throw new Error(`loadmap: the retries of ${joinAnd(ids.map((f) => `"${f}"`))} do not settle`)
      }
      // the timed-out share at the attempts they settled at, held again: it rises with them, so plain rounds climb to
      // the least fixed point of both, never past it, but just past a knee by tiny steps. Where what is left shrinks, a
      // secant step (never more than a thousand plain ones) saves rounds; where it grows the steps double, and a doubled one
      // is held only when the share at its middle still reaches the middle. One that overshoots steps back to the plain
      // one. A dip narrower than half a step can be missed: only at a tipping point, where the storm then starts a
      // little early
      const timed = ids.filter((f) => timeoutOf(f) != null)
      const zero = Object.fromEntries(ids.map((f) => [f, 0]))
      const share = (s: { sub: { timedOut: (f: string) => number } }, late: Record<string, number>) => {
        const next = { ...late }
        for (const f of timed) next[f] = s.sub.timedOut(f)
        return next
      }
      let late: Record<string, number> = zero
      let e: Record<string, number> = zero
      let last: { late: Record<string, number>; next: Record<string, number>; e: Record<string, number> } | undefined
      let gain = 1
      for (let round = 0; ; round++) {
        if (round === 2000)
          throw new Error(`loadmap: the timeouts of ${joinAnd(timed.map((f) => `"${f}"`))} do not settle`)
        const s = solve(e, late)
        // the held share changes only the failures, never the time: the solve's last context reads it
        const next = share(s, late)
        const tol = (f: string) => 1e-10 * (1 + late[f]!)
        if (timed.some((f) => Math.abs(next[f]! - late[f]!) > tol(f))) {
          if (last && timed.some((f) => next[f]! < late[f]! - tol(f))) {
            late = last.next
            e = last.e
            last = undefined
            gain = 1
            continue
          }
          const step = { ...next }
          let doubled = false
          if (last)
            for (const f of timed) {
              const now = next[f]! - late[f]!
              const before = last.next[f]! - last.late[f]!
              if (!(now > 0)) continue
              if (before > now) {
                const x = late[f]! + (now * (late[f]! - last.late[f]!)) / (before - now)
                if (x > next[f]!) step[f] = Math.min(x, late[f]! + 1000 * now, (next[f]! + 1) / 2)
              } else {
                doubled = true
                step[f] = Math.max(next[f]!, Math.min(late[f]! + 2 * gain * now, (next[f]! + 1) / 2))
              }
            }
          gain = doubled ? gain * 2 : 1
          if (doubled) {
            // the middle of the jump must still be below the answer: its share reaches past it
            const mid = Object.fromEntries(ids.map((f) => [f, (next[f]! + step[f]!) / 2]))
            const atMid = share(solve(s.e, mid), mid)
            if (timed.some((f) => atMid[f]! < mid[f]! - tol(f))) {
              for (const f of timed) step[f] = next[f]!
              gain = 1
            }
          }
          last = { late, next, e: s.e }
          late = step
          e = s.e
          continue
        }
        e = s.e
        const a = attempts(e)
        const out: Record<string, Retry> = {}
        for (const f of ids) {
          const l = lam[f]!
          const p = s.failed[f]!
          const times = retryOf(f)!.times
          // with a budget only a share q of rejections is sent again: pq solves pq + … + (pq)ⁿ = the excess
          const retried =
            p > 0 && excess(p, times) > e[f]! * (1 + 1e-12) ? root((y) => excess(y, times), e[f]!, p) / p : 1
          out[f] = {
            times,
            rate: l,
            attempts: a[f]!,
            rejected: p,
            retried,
            failed: l > 0 ? 1 - (1 - p) * (1 + e[f]!) : 0,
          }
        }
        return out
      }
    })

  const usedBy = (c: string) => stageIds.filter((s) => (stages[s] as { component?: string }).component === c)
  const service = (c: string) =>
    memo(`service of ${c}`, () => {
      const s = def.components[c]!.service
      if (s == null) return null
      const v = typeof s === 'function' ? s(ctx as any) : s
      if (!Number.isFinite(v) || v < 0)
        throw new Error(`loadmap: component "${c}" takes ${v} s a unit: a service time from 0 up`)
      return v
    })
  /** The seconds a unit spends at a stage: its component's service time, stretched by the queue in front (M/M/1). */
  const response = (s: string) =>
    memo(`response at ${s}`, () => {
      const c = (stages[s] as { component?: string }).component
      const time = c == null ? null : service(c)
      if (time == null) return null
      const u = ctx.util[c!] as number | null
      // switched off it is not there; without a figure its time is not known
      if (u == null) return enabled(c!) && capacity(c!).missing != null ? Number.NaN : 0
      return u >= 1 ? Number.POSITIVE_INFINITY : time / (1 - u)
    })
  /** A flow's ways through, timed: the stages of each way add up; a cache's hits leave the way there. */
  const timesOf = (f: string) =>
    memo(`times of ${f}`, () => {
      const ways: WayTime[] = []
      // which way each is: the path, and the cache that answered it
      const tags: { path: number; answeredAt?: string }[] = []
      const unknown = new Set<string>()
      let timed = false
      for (const [i, p] of paths(f).entries()) {
        // one part of the way, or one per group of members a connection's spread sets apart
        let parts: WayTime[] = [{ share: p.share, mean: 0, variance: 0 }]
        for (const s of p.stages) {
          const rs = responses(s, f)
          if (rs) timed = true
          if (rs?.length === 1 && Number.isNaN(rs[0]!.time))
            unknown.add(def.components[(stages[s] as { component: string }).component]!.name)
          else if (rs)
            parts = parts.flatMap((w) =>
              rs.map((g) => ({ share: w.share * g.share, mean: w.mean + g.time, variance: w.variance + g.time ** 2 })),
            )
          if (stages[s]!.kind === 'cache') {
            for (const w of parts) {
              ways.push({ ...w, share: w.share * hit(s) })
              tags.push({ path: i, answeredAt: s })
            }
            parts = parts.map((w) => ({ ...w, share: w.share * (1 - hit(s)) }))
          }
        }
        for (const w of parts) {
          ways.push(w)
          tags.push({ path: i })
        }
      }
      return timed ? { ways, tags, unknown: [...unknown] } : null
    })
  const timeoutOf = (f: string) => {
    const t = def.flows[f]!.timeout
    const v = typeof t === 'function' ? t(values) : t
    if (v != null && !(v > 0 && !Number.isNaN(v)))
      throw new Error(`loadmap: flow "${f}" times out after ${v} s: a time above 0`)
    return v
  }
  /** The share of a flow's units slower than its timeout: 0 without one. */
  const timedOut = (f: string) =>
    memo(`timed out of ${f}`, () => {
      const t = timeoutOf(f)
      if (t == null) return 0
      const times = timesOf(f)
      if (!times)
        throw flowError(
          `loadmap: flow "${f}" has a timeout but no latency: no stage on its way has a service`,
          f,
          'timeout',
        )
      // below a millionth it moves no capacity number: none, so the retries stay unsolved below their knee, as without
      // a timeout
      const late = beyond(times.ways, t)
      return late < 1e-6 ? 0 : late
    })
  const latency = (f: string) =>
    memo(`latency of ${f}`, () => {
      const times = timesOf(f)
      if (!times) {
        // a timeout without a latency: refused there
        timedOut(f)
        return null
      }
      const l: Latency = latencyOf(times.ways)
      const t = timeoutOf(f)
      return {
        ...l,
        ...(times.unknown.length ? { unknown: times.unknown } : {}),
        ...(t != null
          ? {
              timedOut: timedOut(f),
              ways: perWay(times, t),
            }
          : {}),
      }
    })
  /** The stages whose units hold a component's slots. */
  const holders = (c: string) => {
    const on = def.components[c]!.on
    return on?.length ? on : usedBy(c)
  }
  /** What a stock gains a second, every flow at its average. */
  const gains = (c: string): number =>
    memo(`gains of ${c}`, () => {
      const at = averaged
        ? ctx
        : memo('averaged', () => context(def, values, bound, pinned, undefined, undefined, true).ctx)
      const v = def.components[c]!.fills!(at as any)
      if (!(v >= 0 && Number.isFinite(v))) throw new Error(`loadmap: component "${c}" fills ${v} a second: 0 or more`)
      return v
    })
  const keepsOf = (c: string) => {
    const k = def.components[c]!.keeps!
    const v = typeof k === 'function' ? k(values) : k
    if (!(v >= 0 && Number.isFinite(v))) throw new Error(`loadmap: component "${c}" keeps ${v} s: a time from 0 up`)
    return v
  }
  /** Where a stock that grows stands on asOf, at the bound: high when the capacities are low, the pessimistic edge. */
  const levelOf = (c: string) =>
    memo(`level of ${c}`, () => {
      const l = def.components[c]!.level!
      const lv = typeof l === 'function' ? l(values) : l
      if (!(lv.value >= 0 && Number.isFinite(lv.value)))
        throw new Error(`loadmap: component "${c}" stands at ${lv.value}: a level from 0 up`)
      const w = c === pinned ? 0 : (lv.within ?? 0)
      return bound === 'low' ? lv.value * (1 + w) : bound === 'high' ? lv.value * (1 - w) : lv.value
    })
  /** A stock that grows with no growth to say when: its level has no load, so it is not ranked. */
  const undated = (c: string) => def.components[c]!.level != null && !def.growth
  const stockLevel = (c: string): number => {
    if (def.components[c]!.keeps != null) return gains(c) * keepsOf(c)
    if (averaged || !def.growth) return levelOf(c)
    return levelOf(c) + grown(def, values, bound, pinned, c)
  }
  /** A component's runs, every and within, checked. */
  const runsOf = (c: string) =>
    memo(`runs of ${c}`, () => {
      const b = def.components[c]!.runs
      if (b == null) return null
      const v = typeof b === 'function' ? b(values) : b
      if (!(v.every > 0 && Number.isFinite(v.every) && v.within > 0 && v.within <= v.every))
        throw new Error(
          `loadmap: component "${c}" works off every ${v.every} s within ${v.within} s: two times above 0, within at most every`,
        )
      return v
    })
  ctx.demand = table(componentIds, (c) =>
    memo(`demand of ${c}`, () => {
      const raw = rawDemand(c)
      const b = runsOf(c)
      if (!b) return raw
      // what a run must work off: every's worth of arrivals in within; a day or more at each flow's average
      if (averaged || b.every < 86_400) return (raw * b.every) / b.within
      return memo('averaged', () => context(def, values, bound, pinned, undefined, undefined, true).ctx).demand[c]
    }),
  )
  /** A component's demand before its runs scale it to the rate a run needs. */
  const rawDemand = (c: string): number => {
    {
      if (def.components[c]!.fills) return stockLevel(c)
      const opened = counted(c)
      if (opened) return opened.reduce((a, o) => a + o.members * o.open, 0)
      const h = held(c)
      if (h) {
        // Little's law: the slots in use are what arrives each second times how long each unit holds one
        let slots = 0
        const on = holders(c)
        for (const f of flowIds) {
          if (!h[f]) continue
          // a unit holds one slot however many of these stages it passes
          for (const p of paths(f)) {
            const twice = p.stages.filter((s) => on.includes(s))
            if (twice.length > 1)
              throw new Error(
                `loadmap: component "${c}" is held on "${twice[0]}" and "${twice[1]}", and "${f}" passes both: a unit holds one slot, so name one of them`,
              )
          }
          for (const s of on) slots += arriving(s, f) * h[f]
        }
        return slots
      }
      const d = def.components[c]!.demand
      if (d) return d(ctx as any)
      let total = 0
      for (const s of usedBy(c)) {
        // a quota counts a window: an hour at the peak, a day or a month at each flow's average
        const per = (stages[s] as { per?: QuotaWindow }).per
        for (const f of flowIds)
          total +=
            per == null
              ? arriving(s, f)
              : // in the averaged context the rates are averages already
                arriving(s, f) * QUOTA_SECONDS[per] * (per === 'hour' || averaged ? 1 : averageOf(f))
      }
      return total
    }
  }
  const connections = (def.connections ?? {}) as Readonly<Record<string, ConnectionDef>>
  /**
   * For the limit a connection's accepts makes: what each connection into its stage opens, the members of its pool at
   * these values (the pods an autoscaler runs, from the plain utilization) times what each keeps open.
   */
  const counted = (c: string) => {
    const head = Object.hasOwn(connections, c) ? connections[c]! : undefined
    if (head?.accepts == null) return null
    return memo(`connections open for ${c}`, () => {
      const target = opener(stages, head)!.target
      const out: { id: string; members: number; open: number; owner: 'worker' | 'pod' }[] = []
      for (const [k, cn] of Object.entries(connections)) {
        const o = opener(stages, cn)
        if (cn.open == null || o?.target !== target) continue
        const st = stages[o.pool] as Extract<StageDef, { kind: 'workers' }>
        const { running } = podsOf(o.pool, st, ctx, plain(st.component))
        const owner = cn.owner ?? 'worker'
        out.push({ id: k, members: owner === 'pod' ? running : running * dyn(st.perPod, ctx), open: openOf(k), owner })
      }
      return out
    })
  }
  // the components an exclusive connection spreads over: only these pay for a spread (utilization is the hot path)
  const spreading = new Set(
    Object.values(connections)
      .filter((cn) => cn.assign != null && cn.assign !== 'shared')
      .map((cn) => (stages[cn.to] as { component?: string }).component),
  )
  /** demand ÷ capacity, before any connection's spread. */
  const plainOf = (c: string): number | null => {
    if (!enabled(c) || capacity(c).missing != null || undated(c)) return null
    const cap = boundOf(capacity(c), c === pinned ? undefined : bound)
    const d = ctx.demand[c] as number
    return cap > 0 ? d / cap : d > 0 ? Number.POSITIVE_INFINITY : 0
  }
  /** The utilization before any connection's spread: what an autoscaler's average reads. */
  const plain = (c: string): number | null =>
    spreading.has(c) ? memo(`plain utilization of ${c}`, () => plainOf(c)) : (ctx.util[c] as number | null)
  /** A flow goes from one stage straight to the other: next on one of its ways, or a fan-out's copy. */
  const goesStraight = (f: string, from: string, to: string) =>
    paths(f).some((p) => p.stages.some((s, i) => s === from && (p.stages[i + 1] === to || copies(s, f, to) > 0)))
  /**
   * The flows a connection covers at these values: none while a split sends them another way (the definition was
   * checked against every way they can go).
   */
  const covered = (k: string) =>
    memo(`flows of connection ${k}`, () => {
      const cn = connections[k]!
      // a flow listed twice counts once
      return [...new Set(cn.flows ?? flowIds)].filter((f) => goesStraight(f, cn.from, cn.to))
    })
  /** A queue's partitions of the flow, or the connection's parts. */
  const partsOf = (k: string, f: string) => {
    const cn = connections[k]!
    const from = stages[cn.from]!
    if (from.kind === 'queue') {
      const n = dyn(from.partitions, ctx)[f]
      if (n == null)
        throw new Error(
          `loadmap: connection "${k}" reads "${f}" from queue "${cn.from}", which has no partitions of it`,
        )
      return whole(n, `connection "${k}" reads "${f}" from queue "${cn.from}"`, 'partitions')
    }
    return whole(dyn(cn.parts!, ctx), `connection "${k}"`, 'parts')
  }
  /** The parts of the stage a key connection reaches: its partitions of the flow when it is a queue, else `parts`. */
  const keyParts = (k: string, f: string) => {
    const cn = connections[k]!
    const to = stages[cn.to]!
    if (to.kind === 'queue') {
      const n = dyn(to.partitions, ctx)[f]
      if (n == null)
        throw new Error(`loadmap: connection "${k}" sends "${f}" to queue "${cn.to}", which has no partitions of it`)
      return whole(n, `connection "${k}" sends "${f}" to queue "${cn.to}"`, 'partitions')
    }
    return whole(dyn(cn.parts!, ctx), `connection "${k}"`, 'parts')
  }
  /**
   * A key connection's skew: a share from 0 to 1, at the edge of its ± the bound asks for (the pessimistic one, every
   * capacity low, takes the larger share), and never below an even part (fewer parts than it assumed make it even).
   */
  const skewOf = (k: string, parts: number) => {
    const cn = connections[k]!
    if (cn.skew == null) return undefined
    const c = typeof cn.skew === 'function' ? cn.skew(ctx) : cn.skew
    if (!(c.value >= 0 && c.value <= 1))
      throw new Error(`loadmap: connection "${k}" puts ${c.value} of a flow on its hottest part: a share from 0 to 1`)
    const w = c.within ?? 0
    const edge = bound === 'low' ? c.value * (1 + w) : bound === 'high' ? c.value * (1 - w) : c.value
    return Math.min(1, Math.max(1 / parts, edge))
  }
  /**
   * How unevenly the connections into the stage that runs it land the work: exclusive readers, or keys and a leader
   * on its members; null without one.
   */
  const spread = (c: string) =>
    !spreading.has(c)
      ? null
      : memo(`spread of ${c}`, () => {
          const spreaders = Object.entries(connections).filter(
            ([k, cn]) =>
              cn.assign != null && cn.assign !== 'shared' && usedBy(c).includes(cn.to) && covered(k).length > 0,
          )
          if (!spreaders.length) return null
          const [first, cn] = spreaders[0]!
          // a key or a leader may reach several stages of one component (a cluster's topics); readers, one stage
          const into = [...new Set(spreaders.map(([, x]) => x.to))]
          const stage = cn.to
          const st = stages[stage]!
          const reads = cn.assign === 'exclusive'
          const two = spreaders.find(([, x]) => (x.assign === 'exclusive') !== reads)
          if (two)
            throw new Error(
              `loadmap: connections "${first}" and "${two[0]}" spread "${stage}" two ways, by readers and by keys: one way for a stage`,
            )
          // the connections into a stage see the same members
          const members = spreaders.map(([k, x]) =>
            st.kind === 'workers'
              ? `${x.owner ?? 'worker'}/${x.capacityPer ?? x.owner ?? 'worker'}`
              : whole(dyn(x.members!, ctx), `connection "${k}"`, 'members'),
          )
          const other = members.findIndex((m) => m !== members[0])
          if (other > 0)
            throw new Error(
              `loadmap: connections "${first}" and "${spreaders[other]![0]}" read into "${stage}" with different members: give them the same owner, capacityPer and members`,
            )
          let shape: Shape
          let pool: { running: number; perPod: number; owner: 'worker' | 'pod' } | undefined
          if (st.kind === 'workers') {
            const owner = cn.owner ?? 'worker'
            const { running } = podsOf(stage, st, ctx, plain(c))
            if (!(running >= 1)) return null
            const perPod = whole(dyn(st.perPod, ctx), `workers "${stage}"`, 'perPod')
            pool = { running: whole(running, `workers "${stage}"`, 'pods'), perPod, owner }
            shape = poolShape(pool.running, perPod, owner, cn.capacityPer ?? owner)
          } else shape = memberShape(members[0] as number)
          // each flow by its share of the demand: for slots, what arrives × how long each unit holds one
          const h = held(c)
          const weight = (f: string, at: readonly string[]) =>
            at.reduce((a, t) => a + arriving(t, f), 0) * (h ? (h[f] ?? 0) : 1)
          const work: (Work & { at: readonly string[] })[] = []
          for (const [k, x] of spreaders)
            for (const f of covered(k)) {
              const twice = work.find((w) => w.flow === f)
              if (twice)
                throw new Error(
                  `loadmap: connections "${spreaders.find(([, y]) => y.from === twice.from)![0]}" and "${k}" both bring "${f}" into "${stage}": a flow reaches a spread stage through one connection`,
                )
              if (x.assign === 'exclusive') {
                // a hot key on the queue in front lands on its partition 0, and so on the worker that reads it
                const skew = hot(x.from)?.[f]
                work.push({ flow: f, weight: 0, parts: partsOf(k, f), from: x.from, skew, at: [x.to] })
                continue
              }
              // a key's parts sit on the members from member 0 for each flow; a leader is one part on member 0
              const parts = x.assign === 'leader' ? 1 : keyParts(k, f)
              work.push({ flow: f, weight: 0, parts, from: x.from, restart: true, skew: skewOf(k, parts), at: [x.to] })
            }
          const on = usedBy(c)
          for (const f of flowIds) {
            if (work.some((w) => w.flow === f)) continue
            const at = on.filter((t) => paths(f).some((p) => p.stages.some((x) => x === t || copies(x, f, t) > 0)))
            if (at.length) work.push({ flow: f, weight: 0, parts: null, at })
          }
          // one flow alone has all the work, whatever its rate: what reaches the stage is read only to weigh several
          if (work.length > 1) for (const w of work) w.weight = weight(w.flow, w.at)
          const s = spreadOver(shape, work)
          const d = def.components[c]!
          const short = d.short ?? d.name
          const plural = d.plural ?? false
          const queues = spreaders.every(([, x]) => stages[reads ? x.from : x.to]!.kind === 'queue')
          const mode = reads ? 'read' : spreaders.every(([, x]) => x.assign === 'leader') ? 'leader' : 'key'
          const text = spreadText(s, shape, work, { short, plural, part: queues ? 'partition' : 'part', mode })
          const base = { stage, stages: into, shape, work, dealt: s, pool }
          // a published figure was run with its own way of spreading the work: a key or a leader leaves it as it is
          if (!reads && capacity(c).provenance === 'published') {
            const hotKeys = work.flatMap((w) =>
              w.skew != null ? [`The hottest key carries ${pct(w.skew)} of ${w.flow}.`] : [],
            )
            const keeps = `${capital(short)} ${plural ? 'keep their' : 'keeps its'} published figure: its run spread the work its own way.`
            return {
              ...base,
              factor: 1,
              published: true,
              text: s.factor > 1 ? [`${text?.split(':')[0]}.`, ...hotKeys, keeps].join(' ') : null,
            }
          }
          return { ...base, factor: s.factor, text }
        })
  /** The share of each flow on partition 0 of a queue a key connection with a skew reaches; undefined without one. */
  const hot = (stage: string): Record<string, number> | undefined =>
    memo(`hot partitions of ${stage}`, () => {
      let out: Record<string, number> | undefined
      for (const [k, cn] of Object.entries(connections)) {
        if (cn.assign !== 'key' || cn.to !== stage || cn.skew == null) continue
        for (const f of covered(k)) {
          out ??= {}
          out[f] = skewOf(k, keyParts(k, f))!
        }
      }
      return out
    })
  /** Which worker reads each partition of an exclusive pool, and each running worker's share of the work. */
  const assignment = (stage: string): WorkersAssignment | undefined => {
    const c = (stages[stage] as { component?: string }).component
    const sp = c ? spread(c) : null
    if (!sp?.pool || sp.stage !== stage) return undefined
    // a pool is read by exclusive connections only: one stage
    const { running, perPod, owner } = sp.pool
    const cell = sp.shape.cellOf
    const cells: Record<string, number[]> = {}
    const from: Record<string, string> = {}
    for (const [f, list] of sp.dealt.owners) cells[f] = list.map(cell)
    for (const w of sp.work) if (w.from) from[w.flow] = w.from
    const weights = new Array<number>(running * perPod).fill(0)
    let left = 1
    sp.dealt.owned.forEach((w, o) => {
      left -= w
      if (owner === 'worker') weights[cell(o)]! += w
      else for (let t = 0; t < perPod; t++) weights[cell(o) + t]! += w / perPod
    })
    // what no exclusive connection covers lands evenly; a sliver left by rounding is none
    if (left > 1e-9) for (let i = 0; i < weights.length; i++) weights[i]! += left / weights.length
    return { owner, cells, from, weights }
  }
  /**
   * The time a unit of a flow spends at a stage, by the share of its units that take it: one time, or one per group of
   * members whose utilization a connection's spread sets apart.
   */
  const responses = (s: string, f: string): { share: number; time: number }[] | null => {
    const r = response(s)
    const c = (stages[s] as { component?: string }).component
    if (r == null || Number.isNaN(r) || !c) return r == null ? null : [{ share: 1, time: r }]
    const sp = spread(c)
    const u0 = plain(c)
    const time = service(c)
    if (!sp?.stages.includes(s) || 'published' in sp || u0 == null || time == null) return [{ share: 1, time: r }]
    const units = sp.shape.units
    const groups = new Map<number, number>()
    for (let u = 0; u < units; u++) {
      const q = sp.dealt.flows[u]!.get(f) ?? 0
      if (q <= 0) continue
      const util = u0 * sp.dealt.share[u]! * units
      const t = util >= 1 ? Number.POSITIVE_INFINITY : time / (1 - util)
      groups.set(t, (groups.get(t) ?? 0) + q)
    }
    if (!groups.size) return [{ share: 1, time: r }]
    const total = [...groups.values()].reduce((a, q) => a + q, 0)
    return [...groups].map(([t, share]) => ({ share: total > 0 ? share / total : share, time: t }))
  }
  /** A connection's rule in a sentence, for the assumptions; a rule from the catalog adds its own and its source. */
  const connectionText = (k: string) => {
    const cn = connections[k]!
    const r = cn.rule
    const own = ruleSentence(k)
    // the source backs the rule only where its assign is the one in effect
    const cites = r != null && (cn.assign ?? 'shared') === r.assign
    return cites ? `${own} ${r.what.replace(/\.$/, '')} (${r.source.title}, ${r.source.by}).` : own
  }
  const ruleSentence = (k: string) => {
    const cn = connections[k]!
    const which = cn.flows ? ` (${joinAnd(cn.flows.map((f) => def.flows[f]!.label ?? f))})` : ''
    const from = stages[cn.from]!.label ?? cn.from
    const to = stages[cn.to]!.label ?? cn.to
    const pool = stages[cn.to]!.kind === 'workers'
    const owner = pool ? (cn.owner ?? 'worker') : 'member'
    if (cn.assign === 'key' || cn.assign === 'leader') {
      const n = dyn(cn.members!, ctx)
      if (cn.assign === 'leader')
        return `Every unit${which} goes to the leader, one of ${fmt(n)} members of ${to} (leader).`
      const part = stages[cn.to]!.kind === 'queue' ? 'partition' : 'part'
      const sk = cn.skew == null ? undefined : (typeof cn.skew === 'function' ? cn.skew(ctx) : cn.skew).value
      const hot = sk == null ? ' Every key as busy as another.' : ` The hottest key carries ${pct(sk)} of a flow.`
      return `Each unit${which} goes to the ${part} its key hashes to; ${part} i of each flow sits on member i mod ${fmt(n)} of ${to} (key).${hot}`
    }
    if (cn.assign === 'exclusive') {
      const part = stages[cn.from]!.kind === 'queue' ? 'partition' : 'part'
      const turn = pool && owner === 'worker' ? 'workers alternating pods' : `${owner}s`
      return `Each ${part} of ${from}${which} is read by one ${owner} of ${to} (exclusive). The ${part}s are dealt in turn to ${turn}: the most even case.${opens(k)}`
    }
    // one written only to count says what it counts, not a rule nobody set
    if (cn.assign == null && (cn.open != null || cn.accepts != null)) {
      const target = opener(stages, cn)?.target
      const label = target == null ? to : (stages[target]!.label ?? target)
      return opens(k).trim() || `It gives the most ${label} accepts: the limit on the connections open to it.`
    }
    const rule = pool
      ? `Any ${owner} of ${to} takes any unit from ${from}${which} (shared).`
      : `${capital(to)} takes the units from ${from}${which} evenly (shared).`
    return rule + opens(k)
  }
  /** What a connection keeps open per member, checked: a count from 0 up. */
  const openOf = (k: string) => {
    const open = dyn(connections[k]!.open!, ctx)
    if (!(open >= 0)) throw new Error(`loadmap: connection "${k}" keeps ${open} connections open: a count from 0 up`)
    return open
  }
  /** " Each pod keeps 20 connections open to db." */
  const opens = (k: string) => {
    const cn = connections[k]!
    const o = opener(stages, cn)
    if (cn.open == null || !o) return ''
    const n = openOf(k)
    return ` Each ${cn.owner ?? 'worker'} of ${stages[o.pool]!.label ?? o.pool} keeps ${fmt(n)} connection${n === 1 ? '' : 's'} open to ${stages[o.target]!.label ?? o.target}.`
  }
  ctx.util = table(componentIds, (c) =>
    memo(`utilization of ${c}`, () => {
      if (!spreading.has(c)) return plainOf(c)
      const u = plain(c)
      if (u == null) return null
      const s = spread(c)
      return s ? u * s.factor : u
    }),
  )
  ctx.derived = table(Object.keys(def.derived ?? {}), (k) =>
    memo(`derived ${k}`, () => (def.derived as Record<string, (c: any) => number>)[k]!(ctx)),
  )
  const text = (v: string | ((c: any) => string) | undefined) => (typeof v === 'function' ? v(ctx) : v)
  /** A stock at these values; undefined for any other component. */
  const stock = (c: string): Stock | undefined => {
    const d = def.components[c]!
    if (!d.fills) return undefined
    const level = stockLevel(c)
    if (d.keeps != null) return { level, gains: gains(c), keeps: keepsOf(c) }
    const cap = capacity(c).value
    const g = gains(c)
    const room = level >= cap ? 0 : g > 0 ? (cap - level) / g : Number.POSITIVE_INFINITY
    return { level, gains: g, room, ...(undated(c) ? { undated: true as const } : {}) }
  }
  return {
    ctx: Object.freeze(ctx),
    capacity,
    enabled,
    gains,
    stock,
    runsOf,
    failedFor,
    breakerOf,
    admitted,
    failedFast,
    rate,
    shedByOf: (s: string) => (byPriority(s) ? Object.fromEntries(flowIds.map((f) => [f, shedFor(s, f)])) : undefined),
    overload,
    failure,
    shed,
    paths,
    retries: () => (flowIds.some((f) => retryOf(f)) ? retries() : {}),
    over: (c: string) => text(def.components[c]!.over) ?? '',
    describe: (c: string) => {
      const opened = counted(c)
      if (!opened) return text(def.components[c]!.describe)
      // "3 pods × 20 = 60 open"
      const parts = opened.map((o) => `${fmt(o.members)} ${o.owner}${o.members === 1 ? '' : 's'} × ${fmt(o.open)}`)
      return `${parts.join(' + ')} = ${fmt(opened.reduce((a, o) => a + o.members * o.open, 0))} open`
    },
    held,
    holders,
    timedOut,
    plain,
    spread,
    connectionText,
    assignment,
    hot,
    latencies: (only: readonly string[] = flowIds) => {
      const timed = componentIds.some((c) => def.components[c]!.service != null)
      // each flow's on first read: the quantiles cost a bisection each
      const out = {}
      for (const f of only) Object.defineProperty(out, f, { enumerable: true, get: () => (timed ? latency(f) : null) })
      return out
    },
  }
}

/**
 * Each way's share too slow for its timeout: one entry per way, its groups of members (a connection's spread splits a
 * way by them) weighed by their share.
 */
function perWay(
  times: { ways: readonly WayTime[]; tags: readonly { path: number; answeredAt?: string }[] },
  t: number,
): { path: number; answeredAt?: string; timedOut: number }[] {
  const out = new Map<
    string,
    { tag: { path: number; answeredAt?: string }; late: number; share: number; first: number }
  >()
  times.tags.forEach((tag, i) => {
    const w = times.ways[i]!
    const key = `${tag.path}/${tag.answeredAt ?? ''}`
    const late = beyond([{ ...w, share: 1 }], t)
    const e = out.get(key) ?? { tag, late: 0, share: 0, first: late }
    e.late += w.share * late
    e.share += w.share
    out.set(key, e)
  })
  // a way nothing takes still says how slow it is
  return [...out.values()].map((e) => ({ ...e.tag, timedOut: e.share > 0 ? e.late / e.share : e.first }))
}

/**
 * The definition under its current names (a connection's `max` is `accepts`), and each stage without a label named by
 * its component's `short` when no other stage runs that component: "the gateway" reads in a sentence, `gateway` does
 * not. With two stages on one component (two topics on one cluster) the short would name both, so they keep their ids.
 */
function withNames<T extends ModelDef<any, any, any, any, any>>(def: T): T {
  const all = Object.entries(def.connections ?? {}) as [string, ConnectionDef][]
  const renamed = all.some(([, cn]) => cn.max != null)
    ? Object.fromEntries(
        all.map(([k, cn]) => {
          const { max, ...rest } = cn
          if (max != null && cn.accepts != null)
            throw new Error(`loadmap: connection "${k}" gives max and accepts, one property: give accepts only`)
          return [k, max == null ? cn : { ...rest, accepts: max }]
        }),
      )
    : undefined
  const stages = def.stages as Readonly<Record<string, StageDef>>
  const components = def.components as Readonly<Record<string, ComponentDef<any> | undefined>>
  const runs = new Map<string, number>()
  for (const st of Object.values(stages)) {
    const c = (st as { component?: string }).component
    if (c != null) runs.set(c, (runs.get(c) ?? 0) + 1)
  }
  let named: Record<string, StageDef> | undefined
  for (const [id, st] of Object.entries(stages)) {
    const c = (st as { component?: string }).component
    const short = c != null && runs.get(c) === 1 && Object.hasOwn(components, c) ? components[c]?.short : undefined
    if (st.label != null || short == null) continue
    named ??= { ...stages }
    named[id] = { ...st, label: short }
  }
  return { ...def, ...(renamed && { connections: renamed }), ...(named && { stages: named }) }
}

/** The definition with each connection's rule filled in: its assign and owner where the connection writes none. */
function withRules<T extends ModelDef<any, any, any, any, any>>(def: T): T {
  const all = Object.entries(def.connections ?? {}) as [string, ConnectionDef][]
  if (!all.some(([, cn]) => cn.rule)) return def
  const stages = def.stages as Readonly<Record<string, StageDef>>
  const fill = (cn: ConnectionDef): ConnectionDef => {
    const r = cn.rule!
    // shared is what a connection does anyway, and an owner belongs to a pool: a rule fills only what applies
    const assign = cn.assign ?? (r.assign === 'shared' ? undefined : r.assign)
    const owner = cn.owner ?? (stages[cn.to]?.kind === 'workers' ? r.owner : undefined)
    return { ...cn, ...(assign != null && { assign }), ...(owner != null && { owner }) }
  }
  return { ...def, connections: Object.fromEntries(all.map(([k, cn]) => [k, cn.rule ? fill(cn) : cn])) }
}

/** The definition with a component for each connection that gives accepts: the connections open against it. */
function withCounts<T extends ModelDef<any, any, any, any, any>>(def: T): T {
  const all = Object.entries(def.connections ?? {}) as [string, ConnectionDef][]
  if (!all.some(([, cn]) => cn.accepts != null)) return def
  const stages = def.stages as Readonly<Record<string, StageDef>>
  const components: Record<string, ComponentDef<any>> = { ...def.components }
  for (const [k, cn] of all) {
    const o = cn.accepts == null || Object.hasOwn(components, k) ? undefined : opener(stages, cn)
    if (!o) continue
    const label = stages[o.target]?.label ?? o.target
    components[k] = {
      name: `Connections to ${label}`,
      short: `the connections to ${label}`,
      plural: true,
      // worked out where the pods are known: the members of each pool times what each keeps open
      demand: () => 0,
      capacity: cn.accepts!,
      over: `new connections to ${label} are refused`,
    }
  }
  return { ...def, components }
}

/** A count of parts or members: a whole number from 1 up. */
function whole(n: number, who: string, what: string): number {
  if (!(Number.isInteger(n) && n >= 1))
    throw new Error(`loadmap: ${who} needs ${what} as a whole number from 1 up, not ${n}`)
  return n
}

/** What a definition's connections must hold whatever the values: the rest is checked where the flows go. */
function checkConnections(def: ModelDef<any, string, string, string, string>): void {
  const stages = def.stages as Readonly<Record<string, StageDef>>
  const all = Object.entries(def.connections ?? {}) as [string, ConnectionDef][]
  for (const [k, cn] of all) {
    const at = `loadmap: connection "${k}"`
    if (Object.hasOwn(def.components, k)) throw new Error(`${at} has the name of a component: give it its own`)
    for (const end of [cn.from, cn.to])
      if (!Object.hasOwn(stages, end)) throw new Error(`${at} names unknown stage "${end}"`)
    for (const f of cn.flows ?? [])
      if (!Object.hasOwn(def.flows, f)) throw new Error(`${at} covers unknown flow "${f}"`)
    const from = stages[cn.from]!
    const to = stages[cn.to]!
    const pool = to.kind === 'workers'
    // owner is a member of the pool after (exclusive) or of the pool that opens (counts); capacityPer only the first
    const opens = cn.open != null && from.kind === 'workers'
    if (!pool && (cn.capacityPer != null || (cn.owner != null && !opens)))
      throw new Error(`${at} names owner or capacityPer, but "${cn.to}" is not a pool: give it members`)
    if (cn.owner === 'pod' && cn.capacityPer === 'worker')
      throw new Error(
        `${at} divides the capacity per worker, but a pod owns each part: capacityPer is the owner or a pod`,
      )
    const target = cn.assign === 'key' || cn.assign === 'leader'
    if (!target && from.kind === 'queue' && cn.parts != null)
      throw new Error(`${at}: the parts of queue "${cn.from}" are its partitions; leave parts out`)
    if (pool && cn.members != null)
      throw new Error(`${at}: the members of pool "${cn.to}" are its workers or pods; leave members out`)
    if (cn.skew != null && cn.assign !== 'key') throw new Error(`${at} gives skew, which only a key connection has`)
    if (target) {
      if (pool)
        throw new Error(
          `${at} spreads by ${cn.assign} over pool "${cn.to}": a key or a leader spreads over the members of a stage that is not a pool`,
        )
      if (cn.members == null) throw new Error(`${at} needs members: the members of "${cn.to}" its parts sit on`)
      if (cn.assign === 'leader' && cn.parts != null)
        throw new Error(`${at}: a leader takes every unit on one member; leave parts out`)
      if (to.kind === 'queue' && cn.parts != null)
        throw new Error(`${at}: the parts of queue "${cn.to}" are its partitions; leave parts out`)
      if (cn.assign === 'key' && to.kind !== 'queue' && cn.parts == null)
        throw new Error(`${at} needs parts: "${cn.to}" is not a queue with partitions`)
    } else if (cn.assign !== 'exclusive') continue
    if (target) {
      const c = to.kind === 'sink' || to.kind === 'lost' ? undefined : to.component
      if (!c) throw new Error(`${at} spreads parts over "${cn.to}", which has no component to run out`)
      continue
    }
    if (from.kind !== 'queue' && cn.parts == null)
      throw new Error(`${at} needs parts: "${cn.from}" is not a queue with partitions`)
    if (!pool && cn.members == null) throw new Error(`${at} needs members: "${cn.to}" is not a pool`)
    const c = to.kind === 'sink' || to.kind === 'lost' ? undefined : to.component
    if (!c) throw new Error(`${at} spreads parts over "${cn.to}", which has no component to run out`)
    const also = Object.keys(stages).find((s) => s !== cn.to && (stages[s] as { component?: string }).component === c)
    if (also)
      throw new Error(
        `${at} spreads parts over "${cn.to}", but its component "${c}" also runs "${also}": give "${cn.to}" a component of its own`,
      )
  }
  // connections counted against a stage: one of those into it gives accepts, and those that open need it
  for (const [k, cn] of all) {
    if (cn.open == null && cn.accepts == null) continue
    const o = opener(stages, cn)
    if (!o)
      throw new Error(
        `loadmap: connection "${k}" counts connections, but neither "${cn.from}" nor "${cn.to}" is a pool to open them`,
      )
    // between two pools, owner is a member of the pool after: it cannot also be one of the pool that opens
    if (cn.open != null && cn.owner != null && cn.assign === 'exclusive' && o.pool !== cn.to)
      throw new Error(
        `loadmap: connection "${k}" opens from "${o.pool}" and spreads over "${cn.to}": owner cannot name a member of both; give the counting its own connection`,
      )
    const into = all.filter(([, x]) => (x.open != null || x.accepts != null) && opener(stages, x)?.target === o.target)
    const maxes = into.filter(([, x]) => x.accepts != null).map(([j]) => j)
    if (maxes.length > 1)
      throw new Error(
        `loadmap: connections "${maxes[0]}" and "${maxes[1]}" both give the most "${o.target}" accepts: give accepts on one`,
      )
    if (!maxes.length)
      throw new Error(
        `loadmap: connection "${k}" opens connections to "${o.target}", but none into it gives accepts: the most it takes`,
      )
    if (!into.some(([, x]) => x.open != null))
      throw new Error(`loadmap: connection "${k}" gives accepts, but none into "${o.target}" opens any: give open`)
  }
  // the flows that can go from one stage straight to the other; a split may send a flow any way its branches go, so a
  // route through one is checked where the values pick a way
  const routes = def.routes as Readonly<Record<string, readonly string[]>>
  const flowIds = Object.keys(def.flows)
  const mayGo = (f: string, from: string, to: string) => {
    const r = routes[f] ?? []
    if (r.some((s, i) => s === from && r[i + 1] === to)) return true
    if (r.some((s) => stages[s]?.kind === 'split')) return true
    // a fan-out's copies: its branches are worked out from the values
    return r.at(-1) === from && stages[from]?.kind === 'fanout'
  }
  const may = (cn: ConnectionDef) => flowIds.filter((f) => mayGo(f, cn.from, cn.to))
  // a connection that only counts what it holds open needs no flow on its hop: a pool keeps connections it may not use
  const countsOnly = (cn: ConnectionDef) =>
    cn.assign !== 'exclusive' && cn.flows == null && (cn.open != null || cn.accepts != null)
  for (const [k, cn] of all) {
    for (const f of cn.flows ?? [])
      if (!mayGo(f, cn.from, cn.to))
        throw new Error(
          `loadmap: connection "${k}" covers "${f}", which does not go from "${cn.from}" straight to "${cn.to}"`,
        )
    if (countsOnly(cn)) continue
    if (!may(cn).length)
      throw new Error(
        `loadmap: connection "${k}" joins "${cn.from}" to "${cn.to}", but no flow goes from one straight to the other`,
      )
    for (const [j, other] of all) {
      if (j <= k || other.from !== cn.from || other.to !== cn.to || countsOnly(other)) continue
      const both = (cn.flows ?? may(cn)).find((f) => (other.flows ?? may(other)).includes(f))
      if (both)
        throw new Error(
          `loadmap: connections "${k}" and "${j}" both cover "${both}" from "${cn.from}" to "${cn.to}": a flow follows one rule at each hop`,
        )
    }
  }
}

function excess(y: number, n: number): number {
  return y >= 1 ? n : (y * (1 - y ** n)) / (1 - y)
}

/**
 * Where h, above 0 at lo and at most 0 at hi, reaches 0: regula falsi with the Illinois step, a few evaluations where
 * bisection takes forty, and still bracketed when h has a kink (the knee where rejections start).
 */
function settle(h: (x: number) => number, lo: number, hi: number, hl = h(lo)): number {
  let hh = h(hi)
  if (hh >= 0) return hi
  let side = 0
  let x = lo
  for (let k = 0; k < 100 && hi - lo > 1e-13 * hi; k++) {
    x = (lo * hh - hi * hl) / (hh - hl)
    const hx = h(x)
    if (hx === 0) break
    if (hx > 0) {
      lo = x
      hl = hx
      if (side === 1) hh /= 2
      side = 1
    } else {
      hi = x
      hh = hx
      if (side === -1) hl /= 2
      side = -1
    }
  }
  return x
}

/** The y in [0, hi] where a rising f(y) reaches `goal`. */
function root(f: (y: number) => number, goal: number, hi: number): number {
  let lo = 0
  for (let k = 0; k < 200 && hi - lo > 1e-15; k++) {
    const mid = (lo + hi) / 2
    if (f(mid) < goal) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Seconds in a period of growth: a month and a year as the calendar averages them. */
const PERIOD = { month: 2_629_800, year: 31_557_600 } as const

/** The load multiple the growth reaches `seconds` after asOf. */
export function multipleAfter(g: Growth, seconds: number): number {
  return (1 + g.rate) ** (seconds / PERIOD[g.per])
}

/** The step, in ln(load), of the grid a stock's gains are added up on. */
const STEP = Math.LN2 / 8
/** For each definition, by stock and values: what it has gained up to each point of the grid, and its gains there. */
const grids = new WeakMap<object, Map<string, { sum: number[]; at: number[] }>>()

/**
 * What a stock that grows has gained from asOf to the day the load reaches `values.load`: its gains (at each flow's
 * average) added up over the time the growth takes. The load is 1× on asOf and grows as `(1 + rate)` a period, so a
 * load x is reached `ln x ÷ ln(1 + rate)` periods on, and the sum runs over ln x, the trapezoid on a fixed grid.
 */
function grown(
  def: ModelDef<any, string, string, string, string>,
  values: LooseValues,
  bound: Bound | undefined,
  pinned: string | undefined,
  c: string,
): number {
  const g = def.growth!
  const load = values.load as number
  if (!(load > 1)) return 0
  const { load: _, ...rest } = values
  const key = `${c}|${bound}|${pinned}|${JSON.stringify(rest)}`
  const byDef = grids.get(def) ?? new Map<string, { sum: number[]; at: number[] }>()
  grids.set(def, byDef)
  let grid = byDef.get(key)
  if (!grid) {
    if (byDef.size > 256) byDef.delete(byDef.keys().next().value!)
    const at0 = context(def, { ...values, load: 1 }, bound, pinned, undefined, undefined, true).gains(c)
    grid = { sum: [0], at: [at0] }
    byDef.set(key, grid)
  }
  const gainsAt = (u: number) =>
    context(def, { ...values, load: Math.exp(u) }, bound, pinned, undefined, undefined, true).gains(c)
  const u = Math.log(load)
  const k = Math.floor(u / STEP)
  while (grid.at.length <= k + 1) {
    const i = grid.at.length
    grid.at.push(gainsAt(i * STEP))
    grid.sum.push(grid.sum[i - 1]! + (STEP * (grid.at[i - 1]! + grid.at[i]!)) / 2)
  }
  const part = u - k * STEP
  const end = grid.at[k]! + ((grid.at[k + 1]! - grid.at[k]!) * part) / STEP
  const total = grid.sum[k]! + (part * (grid.at[k]! + end)) / 2
  return (total * PERIOD[g.per]) / Math.log(1 + g.rate)
}

/** A pass or limit with each flow's own shed, where it sheds by priority. */
function withShedBy<T extends object>(st: T, by: Record<string, number> | undefined): T {
  return by ? { ...st, shedBy: by } : st
}

/**
 * The lowest load multiple at which `util(load)` reaches `th`. A coarse geometric scan finds the first bracket, so a
 * utilization that does not rise steadily with the load is not mis-bisected; bisection then narrows it.
 */
export function crossing(util: (load: number) => number | null, th: number, max: number): number | null {
  const u0 = util(0)
  if (u0 == null) return null
  if (u0 >= th) return 0
  const steps = 96
  const lo0 = 0.01
  let prev = 0
  for (let i = 0; i <= steps; i++) {
    const at = lo0 * (max / lo0) ** (i / steps)
    const u = util(at)
    if (u != null && u >= th) {
      let lo = prev
      let hi = at
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2
        const um = util(mid)
        if (um != null && um >= th) hi = mid
        else lo = mid
      }
      return hi
    }
    prev = at
  }
  return Number.POSITIVE_INFINITY
}

/** Where a range of multiples is reached, with its dates: "between 7.4× and 10× (between May 2029 and …)". */
export function reach(
  r: CrossingRange | null,
  searchMax: number,
  when: (x: number | null) => Date | null = () => null,
): string {
  if (!r) return multiple(null)
  return `${multiples(r, searchMax)}${months(when(r.low), when(r.high))}`
}

/**
 * " (capacity estimated ±30 %)", " (capacity published, a best case)"; nothing for a measured capacity without a ± or
 * a configured one.
 */
export function sureness(c: Capacity | null): string {
  if (c?.ref?.measure === 'limit') return ' (a published limit)'
  if (c?.ref) return ` (capacity published${c.within ? ` −${pct(c.within)}` : ''}, a best case)`
  if (!c || (c.provenance !== 'estimated' && !c.within)) return ''
  return ` (capacity ${c.provenance}${c.within ? ` ±${pct(c.within)}` : ''})`
}

/** " The brokers have no published benchmark for 6 brokers, so they are not ranked." */
function unranked(all: readonly ComponentResult[]): string {
  return all
    .filter((c) => c.missing != null || c.stock?.undated)
    .map((c) =>
      c.missing != null
        ? ` ${capital(c.short)} ${c.plural ? 'have' : 'has'} no published benchmark ${c.missing}, so ${c.plural ? 'they are' : 'it is'} not ranked.`
        : ` ${capital(c.short)} ${c.plural ? 'fill' : 'fills'} over time, and without growth no load says when, so ${c.plural ? 'they are' : 'it is'} not ranked.`,
    )
    .join('')
}

function verdict(
  load: number,
  live: readonly ComponentResult[],
  first: ComponentResult | null,
  range: CrossingRange | null,
  th: { target: number; full: number },
  searchMax: number,
  when: (x: number | null) => Date | null,
  unranked = '',
): VerdictResult {
  if (!first && unranked) return { tier: 'warn', text: `At ${fmt(load)}×, no component has a capacity.${unranked}` }
  const v = stated(load, live, first, range, th, searchMax, when)
  // an unranked component may run out first: never call that ok
  return unranked ? { tier: v.tier === 'ok' ? 'warn' : v.tier, text: v.text + unranked } : v
}

function stated(
  load: number,
  live: readonly ComponentResult[],
  first: ComponentResult | null,
  range: CrossingRange | null,
  th: { target: number; full: number },
  searchMax: number,
  when: (x: number | null) => Date | null,
): VerdictResult {
  const at = `At ${fmt(load)}×`
  const target = `${pct(th.target)} target`
  if (!first) return { tier: 'ok', text: `${at}, every component is switched off.` }
  const est = (c: ComponentResult) => sureness(c.capacity)
  const upTo = reach(range, searchMax, when)
  const holds = `The ${target} holds up to ${upTo}, limited by ${first.short}${est(first)}.`
  const verb = (list: readonly ComponentResult[], one: string, many: string) =>
    list.length > 1 || list[0]?.plural ? many : one

  const overs = live.filter((c) => (c.util ?? 0) > th.full).sort((a, b) => (b.util ?? 0) - (a.util ?? 0))
  if (overs.length) {
    const what = joinAnd(overs.map((c) => c.short))
    return {
      tier: 'over',
      text: `${at}, ${what} ${verb(overs, 'is', 'are')} past capacity: ${overs.map((c) => c.over).join('; ')}. ${holds}`,
    }
  }
  // past a pessimistic edge the stated capacities are not the whole answer: say what may already be happening
  const may = (k: 'targetRange' | 'fullRange') => live.filter((c) => c[k] != null && load > c[k].low)
  const mayOver = may('fullRange')
  if (mayOver.length) {
    const what = joinAnd(mayOver.map((c) => c.short))
    return {
      tier: 'warn',
      text: `${at}, everything fits at the stated capacities, but ${what} may already be past capacity: ${mayOver.map((c) => c.over).join('; ')}. ${holds}`,
    }
  }
  const warns = live.filter((c) => (c.util ?? 0) > th.target)
  if (warns.length) {
    const what = joinAnd(warns.map((c) => c.short))
    return {
      tier: 'warn',
      text: `${at}, everything still fits, but ${what} ${verb(warns, 'runs', 'run')} above the ${target}. ${holds}`,
    }
  }
  const mayWarn = may('targetRange')
  if (mayWarn.length)
    return {
      tier: 'warn',
      text: `${at}, every component is under the ${target} at its stated capacity, but ${joinAnd(mayWarn.map((c) => c.short))} may already be above it. ${holds}`,
    }
  return {
    tier: 'ok',
    text: `${at}, every component is under the ${target}. It holds up to ${upTo}; ${first.short} ${verb([first], 'is', 'are')} the first limit${est(first)}.`,
  }
}

function measureText<C extends string>(
  m: ReturnType<Crossings['measure']>,
  components: Readonly<Record<C, ComponentResult<C>>>,
  first: ComponentResult<C> | null,
  th: { target: number; full: number },
  searchMax: number,
): MeasureHint<C> | null {
  if (!m || !first) return null
  const k = components[m.component as C]
  const then = components[m.firstLimit as C]
  const holds = `the ${pct(th.target)} target holds up to ${multiples(m.target, searchMax)}`
  const text =
    then.id !== first.id
      ? `Measuring ${k.short} would change the answer: at its stated capacity, ${then.short} ${then.plural ? 'are' : 'is'} the first limit and ${holds}.`
      : `Measuring ${k.short} would narrow this most: at its stated capacity, ${holds}.`
  return { component: k.id, target: m.target, firstLimit: then.id, text }
}

function presets<P>(
  def: ModelDef<P, string, string, string, string>,
  target: CrossingRange | null,
  full: CrossingRange | null,
  th: { target: number; full: number },
  searchMax: number,
): Preset<P>[] {
  const { min, max, step } = def.load
  const out: Preset<P>[] = []
  if (min <= 1 && max >= 1) out.push({ label: 'Today · 1×', values: { load: 1 } as Partial<Values<P>>, derived: false })
  for (const [label, values] of Object.entries(def.presets ?? {})) {
    const lasts = def.peaks?.[label]
    out.push({ label, values: values as Partial<Values<P>>, derived: false, ...(lasts != null ? { lasts } : {}) })
  }
  const at = (label: string, x: number | null | undefined) => {
    if (x == null || !Number.isFinite(x) || x < min) return
    const load = Math.min(max, Math.floor(x / step) * step)
    out.push({ label: `${label} · ${multiple(x, searchMax)}`, values: { load } as Partial<Values<P>>, derived: true })
  }
  // the pessimistic edge: where it may already happen
  at(`${pct(th.target)} target`, target?.low)
  at('Runs out', full?.low)
  return out
}

interface Crossings {
  components: Record<string, Pick<ComponentResult, 'target' | 'full' | 'targetRange' | 'fullRange'>>
  measure: () => { component: string; target: CrossingRange; firstLimit: string } | null
}
