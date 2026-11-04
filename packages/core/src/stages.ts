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

export type StageDef<C extends string = string> =
  | PassStage<C>
  | QueueStage<C>
  | WorkersStage<C>
  | StoreStage<C>
  | SinkStage
  | FanoutStage<C>
  | CacheStage<C>
  | LimitStage<C>

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

export function fanout<const C extends string = never>(
  o: { to: FanoutStage['to']; component?: C } & StageBase,
): FanoutStage<C> {
  return { kind: 'fanout', ...o }
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
)

/** The share a stage turns away when its component is past `full`: what is above it. */
export function rejectShare(util: number | null | undefined, full: number): number {
  return util != null && util > full ? 1 - full / util : 0
}

export function dyn<T>(v: Dyn<T>, ctx: LooseValues): T {
  return typeof v === 'function' ? (v as (ctx: LooseValues) => T)(ctx) : v
}

export function resolveStage(
  id: string,
  s: StageDef,
  ctx: LooseValues,
  flowIds: readonly string[],
  full: number,
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
      if (!s.autoscale) {
        const pods = dyn(s.pods ?? 0, ctx)
        return { ...base, pods, running: pods }
      }
      const a = autoscaleOf(id, s.autoscale, ctx)
      return { ...base, pods: a.max, running: running(a, util(s.component)), autoscale: a }
    }
    case 'fanout': {
      const to = dyn(s.to, ctx)
      const perFlow: Record<string, readonly Branch[]> = {}
      for (const f of flowIds) perFlow[f] = Array.isArray(to) ? to : ((to as Record<string, Branch[]>)[f] ?? [])
      return { id, label, kind: 'fanout', component: s.component, to: perFlow, rejects, shed: rejects }
    }
    case 'cache':
      return { id, label, kind: 'cache', component: s.component, hit: hitOf(id, s, ctx), rejects, shed: rejects }
    case 'sink':
      return { id, label, kind: 'sink' }
    case 'store':
      return { id, label, kind: 'store', component: s.component }
    default:
      return { id, label, kind: s.kind, component: s.component, rejects, shed: rejects }
  }
}

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
