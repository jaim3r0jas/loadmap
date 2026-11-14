import type { LooseValues } from './params'

/** A number, or one computed from the model's context (parameters, flows, utilization). */
export type Dyn<T> = T | ((ctx: LooseValues) => T)

interface StageBase {
  /** How meters and cluster groups name the stage: "positions topic". Defaults to its id. */
  label?: string
}

/** Flows pass through; when its component is over capacity, the share above 100 % is rejected. */
export interface PassStage<C extends string = string> extends StageBase {
  kind: 'pass'
  component: C
}

/** Flows wait here; the next stage on each flow's route drains it at that stage's capacity. */
export interface QueueStage<C extends string = string> extends StageBase {
  kind: 'queue'
  component?: C
  /** Partitions per flow. Drawn as cells; partition i sits on member i mod n of the node that shows it. */
  partitions: Dyn<Readonly<Record<string, number>>>
}

/** A pool of workers: pods × workers per pod. Busy workers fill evenly across pods. */
export interface WorkersStage<C extends string = string> extends StageBase {
  kind: 'workers'
  component: C
  /** How many pods; an autoscaled pool runs between its min and max instead. */
  pods?: Dyn<number>
  perPod: Dyn<number>
  /** 'round-robin' spreads load across pods (the default); 'in-order' fills pod 0 first. */
  fill: 'round-robin' | 'in-order'
  autoscale?: Autoscale
}

/**
 * Pods added and removed to hold each running pod near `target` utilization, between `min` and `max`. The component's
 * capacity is the pool at `max` pods: it runs out when the pool cannot grow further.
 */
export interface Autoscale {
  min: Dyn<number>
  max: Dyn<number>
  /** The utilization each running pod is held at, 0 to 1: 0.7 scales out above 70 %. */
  target: Dyn<number>
}

/**
 * A cache: a share `hit` of the units is answered here and goes no further on its route. With a component, past
 * capacity the share above 100 % is rejected, as at a pass stage.
 */
export interface CacheStage<C extends string = string> extends StageBase {
  kind: 'cache'
  component?: C
  /** The share of units answered from the cache, 0 to 1. */
  hit: Dyn<number>
}

/**
 * A rate limiter: its component's capacity is the limit, and past it the share above is rejected. Unlike a pass
 * stage, what it rejects is gone from every stage after it: the rate reaching them (`at`) stops at the limit.
 */
export interface LimitStage<C extends string = string> extends StageBase {
  kind: 'limit'
  component: C
}

/** Where a flow ends: written to its component. */
export interface StoreStage<C extends string = string> extends StageBase {
  kind: 'store'
  component: C
}

/** Where a flow ends without a component of its own: a receiver, a viewer, an app. */
export interface SinkStage extends StageBase {
  kind: 'sink'
}

/** One branch of a fan-out: a copy goes to `stage`; `share` is the expected number of copies per unit (may pass 1). */
export interface Branch {
  stage: string
  share: number
}

/**
 * Each unit is copied to several stages (sinks or stores), each copy with its own share. The last stage of a route.
 * `to` is one list for every flow, or a list per flow.
 */
export interface FanoutStage<C extends string = string> extends StageBase {
  kind: 'fanout'
  component?: C
  to: Dyn<readonly Branch[] | Readonly<Record<string, readonly Branch[]>>>
}

/** One way out of a split: the stages a unit goes through, and the share of units that go this way. */
export interface SplitBranch {
  stages: readonly string[]
  share: number
}

/**
 * Each unit goes on to one of several branches, by share: a read/write split, shards, regions, an A/B test,
 * failover. A branch that ends in a store, a sink or a fan-out ends there; any other rejoins the route after the
 * split. A flow's shares add up to 1; a flow it does not name goes straight on. `to` is one list for every flow, or a
 * list per flow.
 */
export interface SplitStage<C extends string = string> extends StageBase {
  kind: 'split'
  component?: C
  to: Dyn<readonly SplitBranch[] | Readonly<Record<string, readonly SplitBranch[]>>>
}

export type StageDef<C extends string = string> =
  | PassStage<C>
  | QueueStage<C>
  | WorkersStage<C>
  | StoreStage<C>
  | SinkStage
  | FanoutStage<C>
  | CacheStage<C>
  | LimitStage<C>
  | SplitStage<C>

export function pass<const C extends string>(component: C, o: StageBase = {}): PassStage<C> {
  return { kind: 'pass', component, ...o }
}

export function queue<const C extends string = never>(
  o: { partitions: QueueStage['partitions']; component?: C } & StageBase,
): QueueStage<C> {
  return { kind: 'queue', ...o }
}

export function workers<const C extends string>(
  component: C,
  o: ({ pods: Dyn<number>; autoscale?: undefined } | { pods?: undefined; autoscale: Autoscale }) & {
    perPod: Dyn<number>
    fill?: WorkersStage['fill']
  } & StageBase,
): WorkersStage<C> {
  return { kind: 'workers', component, ...o, fill: o.fill ?? 'round-robin' }
}

export function cache<const C extends string = never>(
  o: { hit: Dyn<number>; component?: C } & StageBase,
): CacheStage<C> {
  return { kind: 'cache', ...o }
}

export function limit<const C extends string>(component: C, o: StageBase = {}): LimitStage<C> {
  return { kind: 'limit', component, ...o }
}

export function store<const C extends string>(component: C, o: StageBase = {}): StoreStage<C> {
  return { kind: 'store', component, ...o }
}

export function sink(o: StageBase = {}): SinkStage {
  return { kind: 'sink', ...o }
}

// the component only from the argument: from the stages the result goes into, a split beside it reads as any string
export function fanout<const C extends string = never>(
  o: { to: FanoutStage['to']; component?: C } & StageBase,
): FanoutStage<NoInfer<C>> {
  return { kind: 'fanout', ...o }
}

export function split<const C extends string = never>(
  o: { to: SplitStage['to']; component?: C } & StageBase,
): SplitStage<NoInfer<C>> {
  return { kind: 'split', ...o }
}

/** A stage with its numbers worked out for one set of values. */
export type ResolvedStage = { id: string; label: string } & (
  | {
      kind: 'pass' | 'limit'
      component: string
      /** The share of what is offered (`at`) above its capacity. */
      rejects: number
      /** The share of what actually reaches it that it turns away: less than `rejects` behind a stage that cut first. */
      shed: number
    }
  | { kind: 'store'; component: string }
  | { kind: 'sink'; component?: undefined }
  | { kind: 'queue'; component?: string; partitions: Readonly<Record<string, number>> }
  | {
      kind: 'workers'
      component: string
      /** The pods drawn: an autoscaled pool's max, so the load never moves the layout. */
      pods: number
      perPod: number
      fill: WorkersStage['fill']
      /** The pods running at these values: `pods` unless the pool autoscales. */
      running: number
      autoscale?: { min: number; max: number; target: number }
    }
  | {
      kind: 'fanout'
      component?: string
      to: Readonly<Record<string, readonly Branch[]>>
      rejects: number
      /** The share of its copies it turns away. */
      shed: number
    }
  | { kind: 'cache'; component?: string; hit: number; rejects: number; shed: number }
  | {
      kind: 'split'
      component?: string
      /** Each flow's branches; a flow without any goes straight on. */
      to: Readonly<Record<string, readonly SplitBranch[]>>
      rejects: number
      shed: number
    }
)

/** The share a stage turns away when its component is past `full`: what is above it. */
export function rejectShare(util: number | null | undefined, full: number): number {
  return util != null && util > full ? 1 - full / util : 0
}

export function dyn<T>(v: Dyn<T>, ctx: LooseValues): T {
  return typeof v === 'function' ? (v as (ctx: LooseValues) => T)(ctx) : v
}

/**
 * The pods a workers stage draws and runs. An autoscaler reads `util`: the plain utilization, the average its metric
 * sees, never one a connection's spread raised (the spread itself depends on the pods running).
 */
export function podsOf(
  id: string,
  s: WorkersStage,
  ctx: LooseValues,
  util: number | null | undefined,
): { pods: number; running: number; autoscale?: { min: number; max: number; target: number } } {
  if (!s.autoscale) {
    const pods = dyn(s.pods ?? 0, ctx)
    return { pods, running: pods }
  }
  const a = autoscaleOf(id, s.autoscale, ctx)
  return { pods: a.max, running: running(a, util), autoscale: a }
}

export function resolveStage(
  id: string,
  s: StageDef,
  ctx: LooseValues,
  flowIds: readonly string[],
  full: number,
  /** The utilization before any connection's spread, for an autoscaler; `ctx.util` without one. */
  plain?: (c: string) => number | null,
): ResolvedStage {
  const label = s.label ?? id
  const util = (c: string | undefined) => (c ? (ctx.util as Record<string, number | null>)[c] : null)
  const rejects = rejectShare(util(s.kind === 'sink' ? undefined : s.component), full)
  switch (s.kind) {
    case 'queue':
      return { id, label, kind: 'queue', component: s.component, partitions: dyn(s.partitions, ctx) }
    case 'workers': {
      const perPod = dyn(s.perPod, ctx)
      const base = { id, label, kind: 'workers' as const, component: s.component, perPod, fill: s.fill }
      return { ...base, ...podsOf(id, s, ctx, plain ? plain(s.component) : util(s.component)) }
    }
    case 'fanout': {
      const to = dyn(s.to, ctx)
      const perFlow: Record<string, readonly Branch[]> = {}
      for (const f of flowIds) perFlow[f] = Array.isArray(to) ? to : ((to as Record<string, Branch[]>)[f] ?? [])
      return { id, label, kind: 'fanout', component: s.component, to: perFlow, rejects, shed: rejects }
    }
    case 'cache':
      return { id, label, kind: 'cache', component: s.component, hit: hitOf(id, s, ctx), rejects, shed: rejects }
    case 'split':
      return {
        id,
        label,
        kind: 'split',
        component: s.component,
        to: splitOf(id, s, ctx, flowIds),
        rejects,
        shed: rejects,
      }
    case 'sink':
      return { id, label, kind: 'sink' }
    case 'store':
      return { id, label, kind: 'store', component: s.component }
    default:
      return { id, label, kind: s.kind, component: s.component, rejects, shed: rejects }
  }
}

/** A split's branches per flow, checked: each share from 0 to 1, a flow's adding up to 1. */
export function splitOf(
  id: string,
  s: SplitStage,
  ctx: LooseValues,
  flowIds: readonly string[],
): Record<string, readonly SplitBranch[]> {
  const to = dyn(s.to, ctx)
  const out: Record<string, readonly SplitBranch[]> = {}
  for (const f of flowIds) {
    const list = Array.isArray(to)
      ? (to as readonly SplitBranch[])
      : ((to as Record<string, readonly SplitBranch[]>)[f] ?? [])
    if (!list.length) continue
    let sum = 0
    for (const b of list) {
      if (!(b.share >= 0 && b.share <= 1))
        throw new Error(`loadmap: split "${id}" sends a share from 0 to 1 of "${f}" each way, not ${b.share}`)
      if (!b.stages.length) throw new Error(`loadmap: split "${id}" has a branch of "${f}" through no stage`)
      sum += b.share
    }
    if (Math.abs(sum - 1) > 1e-9)
      throw new Error(`loadmap: split "${id}" sends ${fmtShare(sum)} of "${f}" on: its shares add up to 1`)
    out[f] = list
  }
  return out
}

const fmtShare = (x: number) => `${Math.round(x * 1000) / 10} %`

/** A cache's hit share, checked: a share outside 0 to 1 is a mistake, not a rate. */
export function hitOf(id: string, s: CacheStage, ctx: LooseValues): number {
  const hit = dyn(s.hit, ctx)
  if (!(hit >= 0 && hit <= 1)) throw new Error(`loadmap: cache "${id}" needs a hit share from 0 to 1, not ${hit}`)
  return hit
}

function autoscaleOf(id: string, a: Autoscale, ctx: LooseValues) {
  const min = dyn(a.min, ctx)
  const max = dyn(a.max, ctx)
  const target = dyn(a.target, ctx)
  if (!(Number.isInteger(min) && Number.isInteger(max) && min >= 1 && max >= min))
    throw new Error(`loadmap: workers "${id}" autoscale needs whole numbers with 1 ≤ min ≤ max, not ${min} and ${max}`)
  if (!(target > 0 && target <= 1))
    throw new Error(`loadmap: workers "${id}" autoscale needs a target above 0 and at most 1, not ${target}`)
  return { min, max, target }
}

/**
 * The pods an autoscaler runs: enough to hold each near its target. `util` is against the pool at max pods, so
 * util × max is the work in pods' worth of capacity.
 */
function running(a: { min: number; max: number; target: number }, util: number | null | undefined): number {
  // a hair of slack, so a pool exactly at its target does not add a pod for a rounding error
  const need = Math.ceil(((util ?? 0) * a.max) / a.target - 1e-9)
  return Math.min(a.max, Math.max(a.min, need))
}
