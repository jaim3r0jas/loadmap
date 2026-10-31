import type { LinearFit } from './calibrate'
import type { Capacity } from './capacity'
import { around, fmt, joinAnd, multiple, pct } from './format'
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

export type Assumption =
  | { kind: 'capacity'; component: string; name: string; capacity: Capacity }
  | { kind: 'fit'; name: string; fit: LinearFit }

export interface Evaluation<P = any, F extends string = string, C extends string = string, S extends string = string> {
  values: Values<P>
  flows: Readonly<Record<F, number>>
  components: Readonly<Record<C, ComponentResult<C>>>
  /** Components in the order they reach the target. */
  ranked: readonly ComponentResult<C>[]
  /** The component that reaches the target first. */
  firstLimit: ComponentResult<C> | null
  /** The component that reaches 100 % first. */
  firstFull: ComponentResult<C> | null
  verdict: Verdict
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
  growth?: Growth
  defaults(): Values<P>
  isEnabled(id: string, values: LooseValues): boolean
  evaluate(values?: Partial<Values<P>>): Evaluation<P, F, C, S>
  /** Each component's utilization at these values: what `evaluate` computes first, without the crossings. */
  utilization(values?: Partial<Values<P>>): Readonly<Record<C, number | null>>
  /** The scenario whose values these are, ignoring the load; null when they match none. */
  scenarioOf(values: LooseValues): Scenario<P> | null
  /** When the load reaches this multiple, from `growth`; null without growth or a finite multiple. */
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
  const when = (x: number | null) => (growth ? dateAt(growth, x) : null)
  const paramList = [
    { id: 'load', def: def.load as AnyParamDef },
    ...Object.entries(params).map(([id, d]) => ({ id, def: d })),
  ]

  const defaults = () => {
    const v: Record<string, unknown> = { load: def.load.default }
    for (const [id, d] of Object.entries(params)) v[id] = d.default
    return v as Values<P>
  }

  const scenarios: Scenario<P>[] = Object.entries(def.scenarios ?? {}).map(([label, set]) => {
    for (const k of Object.keys(set as object)) {
      if (k === 'load')
        throw new Error(`loadmap: scenario "${label}" sets the load; a scenario leaves it to the slider`)
      if (!Object.hasOwn(params, k)) throw new Error(`loadmap: scenario "${label}" sets unknown parameter "${k}"`)
    }
    const { load: _, ...values } = { ...defaults(), ...set } as Values<P>
    return { label, values }
  })
  const scenarioOf = (values: LooseValues) =>
    scenarios.find((s) => Object.entries(s.values).every(([k, v]) => values[k] === v)) ?? null

  // crossings depend on every value but the load: cache them per combination
  const crossingCache = new Map<string, Record<string, { target: number | null; full: number | null }>>()
  const crossingsFor = (values: LooseValues) => {
    const { load: _, ...rest } = values
    const key = JSON.stringify(rest)
    let hit = crossingCache.get(key)
    if (!hit) {
      hit = {}
      for (const c of componentIds) {
        const at = (load: number) => context(def as any, { ...values, load }).ctx.util[c] as number | null
        hit[c] = { target: crossing(at, thresholds.target, searchMax), full: crossing(at, thresholds.full, searchMax) }
      }
      if (crossingCache.size > 64) crossingCache.delete(crossingCache.keys().next().value!)
      crossingCache.set(key, hit)
    }
    return hit
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
        target: crossings[c]!.target,
        full: crossings[c]!.full,
        over: over(c),
        describe: describe(c),
      }
    }

    const all = componentIds.map((c) => components[c])
    const live = all.filter((r) => r.util != null)
    // switched-off components go last, after live ones that never reach the target
    const order = (x: number | null) => (x == null ? Number.POSITIVE_INFINITY : x)
    const cmp = (x: number | null, y: number | null) => (order(x) === order(y) ? 0 : order(x) < order(y) ? -1 : 1)
    const ranked = [...all].sort(
      (a, b) => Number(a.util == null) - Number(b.util == null) || cmp(a.target, b.target) || cmp(a.full, b.full),
    )
    const firstLimit = live.length ? live.reduce((a, b) => (order(b.target) < order(a.target) ? b : a)) : null
    const firstFull = live.length ? live.reduce((a, b) => (order(b.full) < order(a.full) ? b : a)) : null

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
      verdict: verdict(values.load, live, firstLimit, thresholds, searchMax, when),
      presets: presets(def, firstLimit, firstFull, thresholds, searchMax),
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
    growth,
    defaults,
    isEnabled: (id, values) => {
      const d = paramList.find((x) => x.id === id)?.def
      return d ? isEnabled(d, values) : false
    },
    evaluate,
    utilization: (partial) => {
      const util = context(def as any, { ...defaults(), ...partial }).ctx.util as Record<C, number | null>
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
function context(def: ModelDef<any, string, string, string, string>, values: LooseValues) {
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
      const cap = capacity(c).value
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

function verdict(
  load: number,
  live: readonly ComponentResult[],
  first: ComponentResult | null,
  th: { target: number; full: number },
  searchMax: number,
  when: (x: number | null) => Date | null,
): Verdict {
  const at = `At ${fmt(load)}×`
  const target = `${pct(th.target)} target`
  if (!first) return { tier: 'ok', text: `${at}, every component is switched off.` }
  const est = (c: ComponentResult) => (c.capacity?.provenance === 'estimated' ? ' (capacity estimated)' : '')
  // a date only for a crossing still ahead: below 1× it has already passed
  const date = first.target != null && first.target > 1 ? when(first.target) : null
  const upTo = `${multiple(first.target, searchMax)}${date ? ` (${around(date)})` : ''}`
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
  const warns = live.filter((c) => (c.util ?? 0) > th.target)
  if (warns.length) {
    const what = joinAnd(warns.map((c) => c.short))
    return {
      tier: 'warn',
      text: `${at}, everything still fits, but ${what} ${verb(warns, 'runs', 'run')} above the ${target}. ${holds}`,
    }
  }
  return {
    tier: 'ok',
    text: `${at}, every component is under the ${target}. It holds up to ${upTo}; ${first.short} ${verb([first], 'is', 'are')} the first limit${est(first)}.`,
  }
}

function presets<P>(
  def: ModelDef<P, string, string, string, string>,
  first: ComponentResult | null,
  firstFull: ComponentResult | null,
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
  at(`${pct(th.target)} target`, first?.target)
  at('Runs out', firstFull?.full)
  return out
}
