import type { LinearFit } from './calibrate'
import { type Bound, boundOf, type Capacity, type CrossingRange } from './capacity'
import type { Expectation } from './check'
import { fmt, joinAnd, months, multiple, multiples, pct } from './format'
import { growth as checkGrowth, dateAt, type Growth } from './growth'
import { type AnyParamDef, isEnabled, type LoadParam, type LooseValues, type ParamDef, type Values } from './params'
import { type ResolvedStage, resolveStage, type StageDef } from './stages'

/** What every model function receives: the parameter values plus the model's own derived numbers. */
export type Ctx<P, F extends string, C extends string, D extends string> = Values<P> & {
  /** Units per second of each flow. */
  readonly flows: Readonly<Record<F, number>>
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
  /** Units per second. */
  rate: (ctx: X) => number
  /** 1 is served first. Flows of the same priority share capacity. */
  priority?: number
  /** What happens to this flow's backlog in a queue; may depend on the values. Without a rule it waits. */
  overload?: Overload | ((ctx: X) => Overload)
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

export interface ComponentDef<X> {
  name: string
  /** The name inside a sentence, with its article: "the database". Defaults to the name. */
  short?: string
  /** "are past capacity" instead of "is". */
  plural?: boolean
  /** In the capacity's unit. */
  demand: (ctx: X) => number
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
   * Named designs to compare, by label: the defaults plus these values, never the load. The first is the baseline the
   * others are measured against.
   */
  scenarios?: Readonly<Record<string, Partial<NoInfer<Omit<Values<P>, 'load'>>>>>
  /** How fast the load grows: turns load multiples into dates. */
  growth?: Growth
  flows: { [K in F]: FlowDef<Ctx<P, F, C, D>> }
  components: { [K in C]: ComponentDef<Ctx<P, F, C, D>> }
  derived?: { [K in D]: (ctx: Ctx<P, F, C, D>) => number }
  stages: { [K in S]: StageDef<NoInfer<C>> }
  routes: { [K in NoInfer<F>]: readonly NoInfer<S>[] }
  /** Fits used by the model, listed with the assumptions. */
  calibration?: Readonly<Record<string, LinearFit>>
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
  /** Start from a scenario's values; `set` goes on top. Without one, from the defaults. */
  scenario?: string
  set?: Partial<Values<P>>
  /** The component to point at: its box is outlined. */
  focus?: C
  /** How long a recording holds the step. Default 4. */
  seconds?: number
}

/** A step as the model resolved it: every value set, so a step looks the same whichever step came before. */
export interface StoryStep<P = any, C extends string = string> {
  text: string
  values: Values<P>
  scenario?: string
  focus?: C
  seconds: number
}

export type ComponentState = 'off' | 'ok' | 'warn' | 'over'

export interface ComponentResult<C extends string = string> {
  id: C
  name: string
  short: string
  plural: boolean
  /** demand ÷ capacity at the current values; null when switched off. */
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
}

export interface Verdict {
  tier: 'ok' | 'warn' | 'over'
  text: string
}

export interface Preset<P> {
  label: string
  values: Partial<Values<P>>
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

export type Assumption =
  | { kind: 'capacity'; component: string; name: string; capacity: Capacity }
  | { kind: 'fit'; name: string; fit: LinearFit }

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
  verdict: Verdict
  /** Which capacity, once measured, would change or narrow the answer most; null when the range is narrow. */
  measure: MeasureHint<C> | null
  presets: readonly Preset<P>[]
  assumptions: readonly Assumption[]
  stages: Readonly<Record<S, ResolvedStage>>
  routes: Readonly<Record<F, readonly S[]>>
  /** Each flow's overload rules for these values. */
  overload: Readonly<Record<F, Overload>>
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
   * Each component's utilization at these values: what `evaluate` computes first, without the crossings. With a
   * bound, every capacity is read at its low or high bound.
   */
  utilization(values?: Partial<Values<P>>, bound?: Bound): Readonly<Record<C, number | null>>
  /** The scenario whose values these are, ignoring the load; null when they match none. */
  scenarioOf(values: LooseValues): Scenario<P> | null
  /**
   * When the load reaches this multiple, from `growth`. Null without growth, without a finite multiple, and at 1× or
   * below: a crossing already reached has no date ahead.
   */
  dateAt(multiple: number | null): Date | null
}

const RESERVED = ['load', 'flows', 'demand', 'util', 'derived']

export function defineModel<
  const P extends Readonly<Record<string, ParamDef>>,
  F extends string,
  C extends string,
  S extends string,
  D extends string = never,
>(def: ModelDef<P, F, C, D, S>): Model<P, F, C, S> {
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
  const scenarioOf = (values: LooseValues) =>
    scenarios.find((s) => Object.entries(s.values).every(([k, v]) => values[k] === v)) ?? null

  const expectations = (def.expect ?? []).map((e) => {
    const name = e.label ? `expectation "${e.label}"` : 'an expectation'
    if (e.scenario != null && !scenarios.some((s) => s.label === e.scenario))
      throw new Error(`loadmap: ${name} names unknown scenario "${e.scenario}"`)
    if (e.component != null && !componentIds.includes(e.component))
      throw new Error(`loadmap: ${name} names unknown component "${e.component}"`)
    if (e.target == null && e.full == null) throw new Error(`loadmap: ${name} needs a target or a full multiple`)
    for (const k of ['target', 'full'] as const) {
      const x = e[k]
      if (x != null && !(x > 0 && Number.isFinite(x)))
        throw new Error(`loadmap: ${name} needs a ${k} multiple above 0, not ${x}`)
    }
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
    return {
      text: st.text,
      values: { ...defaults(), ...from?.values, ...st.set } as Values<P>,
      ...(st.scenario != null ? { scenario: st.scenario } : {}),
      ...(st.focus != null ? { focus: st.focus } : {}),
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
    const uncertain = componentIds.filter((c) => (stated.capacity(c).within ?? 0) > 0)
    const components: Crossings['components'] = {}
    for (const c of componentIds) {
      const at = (bound?: Bound) => (load: number) => utilAt(values, bound)(load)[c] as number | null
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

  const evaluate = (partial?: Partial<Values<P>>): Evaluation<P, F, C, S> => {
    const values = { ...defaults(), ...partial } as Values<P>
    const { ctx, capacity, over, describe } = context(def as any, values)
    const crossings = crossingsFor(values)

    const components = {} as Record<C, ComponentResult<C>>
    for (const c of componentIds) {
      const d = def.components[c]
      const util = ctx.util[c] as number | null
      const off = util == null
      components[c] = {
        id: c,
        name: d.name,
        short: d.short ?? d.name,
        plural: d.plural ?? false,
        util,
        demand: off ? null : (ctx.demand[c] as number),
        capacity: off ? null : capacity(c),
        state: off ? 'off' : util > thresholds.full ? 'over' : util > thresholds.target ? 'warn' : 'ok',
        ...crossings.components[c]!,
        over: over(c),
        describe: describe(c),
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
    const stages = {} as Record<S, ResolvedStage>
    for (const s of stageIds) stages[s] = resolveStage(s, def.stages[s] as StageDef, ctx, flowIds)
    for (const st of Object.values(stages) as ResolvedStage[])
      if (st.kind === 'fanout')
        for (const b of Object.values(st.to).flat()) {
          const to = (stages as Record<string, ResolvedStage>)[b.stage]
          if (!to || to.kind === 'queue' || to.kind === 'workers' || to.kind === 'fanout')
            throw new Error(
              `loadmap: fan-out "${st.id}" branches to "${b.stage}", which is not a sink, store or pass stage`,
            )
        }
    const overload = {} as Record<F, Overload>
    for (const f of flowIds) {
      const o = def.flows[f].overload
      overload[f] = (typeof o === 'function' ? o(ctx as any) : o) ?? {}
    }

    const assumptions: Assumption[] = []
    for (const c of componentIds) {
      const cap = components[c].capacity ?? capacity(c)
      assumptions.push({ kind: 'capacity', component: c, name: def.components[c].name, capacity: cap })
    }
    for (const [name, fit] of Object.entries(def.calibration ?? {})) assumptions.push({ kind: 'fit', name, fit })

    return {
      values,
      flows,
      components,
      ranked,
      firstLimit,
      firstFull,
      target,
      full,
      verdict: verdict(values.load, live, firstLimit, target, thresholds, searchMax, when),
      get measure() {
        return measureText(crossings.measure(), components, firstLimit, thresholds, searchMax)
      },
      presets: presets(def, target, full, thresholds, searchMax),
      assumptions,
      stages,
      routes: def.routes as Record<F, readonly S[]>,
      overload,
      ctx,
    }
  }

  return {
    def: def as ModelDef<any, any, any, any, any>,
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
    utilization: (partial, bound) => {
      const util = context(def as any, { ...defaults(), ...partial }, bound).ctx.util as Record<C, number | null>
      return Object.fromEntries(componentIds.map((c) => [c, util[c]])) as Record<C, number | null>
    },
    scenarioOf,
    dateAt: when,
  }
}

/**
 * The model's numbers for one set of values. Every number is computed on first use and kept, so a model function
 * may read any other; a value that needs itself throws, naming the loop.
 */
function context(
  def: ModelDef<any, string, string, string, string>,
  values: LooseValues,
  bound?: Bound,
  /** A component whose capacity stays at its stated value under a bound. */
  pinned?: string,
) {
  const cache = new Map<string, unknown>()
  const stack: string[] = []
  const memo = <T>(key: string, f: () => T): T => {
    if (cache.has(key)) return cache.get(key) as T
    if (stack.includes(key))
      throw new Error(`loadmap: ${[...stack.slice(stack.indexOf(key)), key].join(' → ')} is a loop`)
    stack.push(key)
    try {
      const v = f()
      cache.set(key, v)
      return v
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
  const flowIds = Object.keys(def.flows)
  const componentIds = Object.keys(def.components)
  const capacity = (c: string) =>
    memo(`capacity of ${c}`, () => {
      const cap = def.components[c]!.capacity
      return typeof cap === 'function' ? cap(ctx as any) : cap
    })
  const enabled = (c: string) => memo(`${c} enabled`, () => def.components[c]!.when?.(ctx as any) ?? true)
  ctx.flows = table(flowIds, (f) => memo(`flow ${f}`, () => def.flows[f]!.rate(ctx as any)))
  ctx.demand = table(componentIds, (c) => memo(`demand of ${c}`, () => def.components[c]!.demand(ctx as any)))
  ctx.util = table(componentIds, (c) =>
    memo(`utilization of ${c}`, () => {
      if (!enabled(c)) return null
      const cap = boundOf(capacity(c), c === pinned ? undefined : bound)
      const d = ctx.demand[c] as number
      return cap > 0 ? d / cap : d > 0 ? Number.POSITIVE_INFINITY : 0
    }),
  )
  ctx.derived = table(Object.keys(def.derived ?? {}), (k) =>
    memo(`derived ${k}`, () => (def.derived as Record<string, (c: any) => number>)[k]!(ctx)),
  )
  const text = (v: string | ((c: any) => string) | undefined) => (typeof v === 'function' ? v(ctx) : v)
  return {
    ctx: Object.freeze(ctx),
    capacity,
    over: (c: string) => text(def.components[c]!.over) ?? '',
    describe: (c: string) => text(def.components[c]!.describe),
  }
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

/** " (capacity estimated ±30 %)"; nothing for a measured capacity without a ±. */
export function sureness(c: Capacity | null): string {
  if (!c || (c.provenance === 'measured' && !c.within)) return ''
  return ` (capacity ${c.provenance}${c.within ? ` ±${pct(c.within)}` : ''})`
}

function verdict(
  load: number,
  live: readonly ComponentResult[],
  first: ComponentResult | null,
  range: CrossingRange | null,
  th: { target: number; full: number },
  searchMax: number,
  when: (x: number | null) => Date | null,
): Verdict {
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
  for (const [label, values] of Object.entries(def.presets ?? {}))
    out.push({ label, values: values as Partial<Values<P>>, derived: false })
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
