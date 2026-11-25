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
  /**
   * Past capacity, who is turned away: `even`, the same share of every flow (the default), or `priority`, the flow
   * with the larger `priority` number first, so priority 1 keeps going while there is room for it.
   */
  shed?: 'even' | 'priority'
}

/** Flows wait here; the next stage on each flow's route drains it at that stage's capacity. */
export interface QueueStage<C extends string = string> extends StageBase {
  kind: 'queue'
  component?: C
  /** Partitions per flow. Drawn as cells; partition i sits on member i mod n of the node that shows it. */
  partitions: Dyn<Readonly<Record<string, number>>>
  /**
   * How many units it holds: a bounded queue, a buffer, a mailbox. Once its reader cannot keep up it fills, and what
   * arrives then finds it full. Without one it holds whatever comes.
   */
  holds?: Dyn<number>
  /**
   * What happens to a unit that finds it full: `reject` turns it away at the queue (the default), `block` makes the
   * stage before it wait, so the unit is turned away there.
   */
  whenFull?: 'reject' | 'block'
}

/** A pool of workers: pods × workers per pod. Busy workers fill evenly across pods. */
export interface WorkersStage<C extends string = string> extends StageBase {
  kind: 'workers'
  component: C
  /** How many pods; an autoscaled pool runs between its min and max instead. */
  pods?: Dyn<number>
  perPod: Dyn<number>
  /** 'round-robin' spreads load across pods (the default); 'in-order' fills pod 0 first. */
  placement?: 'round-robin' | 'in-order'
  /** @deprecated `placement`: a fill is a colour everywhere else. */
  fill?: 'round-robin' | 'in-order'
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
  /**
   * A quota over a window, not a rate: its component's capacity is what the window allows, and its demand what reaches
   * it in one window, at the peak for an hour and at each flow's average for a day or a month.
   */
  per?: QuotaWindow
}

/** The window of a quota. */
export type QuotaWindow = 'hour' | 'day' | 'month'

/** Seconds in each window: a month as the calendar averages it. */
export const QUOTA_SECONDS: Readonly<Record<QuotaWindow, number>> = { hour: 3_600, day: 86_400, month: 2_629_800 }

/** Where a flow ends: written to its component. */
export interface StoreStage<C extends string = string> extends StageBase {
  kind: 'store'
  component: C
}

/** Where a flow ends without a component of its own: a receiver, a viewer, an app. */
export interface SinkStage extends StageBase {
  kind: 'sink'
}

/**
 * Why a unit leaves without reaching the end of its way: turned away, dropped as too old, too slow for its client, or
 * failed by the stage that worked on it (an error that is not about capacity).
 */
export type Loss = 'rejected' | 'dropped' | 'timedOut' | 'failed'

export const LOSSES: readonly Loss[] = ['rejected', 'dropped', 'timedOut', 'failed']

/**
 * Where what other stages lose goes: what a pass, limit, cache or split turns away, what a queue drops as too old, what
 * is too slow for its client at the end of its way. It is on no route: `from` names the stages it takes from, and
 * `takes` which losses (all of them without one). What reaches it (`at`) is what is lost there after every retry.
 */
export interface LostStage extends StageBase {
  kind: 'lost'
  from: readonly string[]
  takes?: readonly Loss[]
}

/**
 * One branch of a fan-out: a copy goes to `stage`, or on through `stages` one after the other (a queue, the workers
 * that read it, what they call); `share` is the expected number of copies per unit (may pass 1). A branch never comes
 * back to the route.
 */
export type Branch = { share: number } & (
  | { stage: string; stages?: undefined }
  | { stages: readonly string[]; stage?: undefined }
)

/** A branch at one set of values: the stages its copies go through, `stage` the first of them. */
export interface ResolvedBranch {
  stage: string
  stages: readonly string[]
  share: number
}

/** The stages a branch's copies go through, in order. */
export const chainOf = (b: Branch | ResolvedBranch): readonly string[] => b.stages ?? [b.stage as string]

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

/**
 * Each unit makes several calls at once and goes on when enough of them have answered: a read from every shard, a
 * quorum of replicas, a page built from many services. `to` is the calls of each flow, one branch a flow, written as
 * a fan-out's: its `share` is the calls a unit makes, a whole number. `needs` is how many must answer (all of them
 * without it). The unit waits for the slowest call it needs, and fails when too few answer. Unlike a fan-out it does
 * not end the route.
 */
export interface GatherStage extends StageBase {
  kind: 'gather'
  component?: undefined
  to: Dyn<readonly Branch[] | Readonly<Record<string, readonly Branch[]>>>
  needs?: Dyn<number>
  /**
   * A hedge: a call not answered by this percentile of its own time (0.95: by its p95) is sent a second time, and the
   * first of the two answers counts. It cuts the wait for a slow call, and what is called sees the second calls too:
   * 5 % more at 0.95.
   */
  hedge?: Dyn<number>
}

export type StageDef<C extends string = string> =
  | PassStage<C>
  | GatherStage
  | QueueStage<C>
  | WorkersStage<C>
  | StoreStage<C>
  | SinkStage
  | FanoutStage<C>
  | CacheStage<C>
  | LimitStage<C>
  | SplitStage<C>
  | LostStage

export function pass<const C extends string>(
  component: C,
  o: StageBase & { shed?: 'even' | 'priority' } = {},
): PassStage<C> {
  return { kind: 'pass', component, ...o }
}

export function queue<const C extends string = never>(
  o: {
    partitions: QueueStage['partitions']
    component?: C
    holds?: QueueStage['holds']
    whenFull?: QueueStage['whenFull']
  } & StageBase,
): QueueStage<C> {
  return { kind: 'queue', ...o }
}

export function workers<const C extends string>(
  component: C,
  o: ({ pods: Dyn<number>; autoscale?: undefined } | { pods?: undefined; autoscale: Autoscale }) & {
    perPod: Dyn<number>
    placement?: WorkersStage['placement']
    /** @deprecated `placement`. */
    fill?: WorkersStage['placement']
  } & StageBase,
): WorkersStage<C> {
  const { fill, ...rest } = o
  if (fill != null && o.placement != null)
    throw new Error(`loadmap: workers "${component}" gives fill and placement, one property: give placement only`)
  return { kind: 'workers', component, ...rest, placement: o.placement ?? fill ?? 'round-robin' }
}

export function cache<const C extends string = never>(
  o: { hit: Dyn<number>; component?: C } & StageBase,
): CacheStage<C> {
  return { kind: 'cache', ...o }
}

export function limit<const C extends string>(component: C, o: StageBase & { per?: QuotaWindow } = {}): LimitStage<C> {
  if (o.per != null && !Object.hasOwn(QUOTA_SECONDS, o.per))
    throw new Error(`loadmap: limit "${component}" is per hour, day or month, not "${o.per}"`)
  return { kind: 'limit', component, ...o }
}

export function store<const C extends string>(component: C, o: StageBase = {}): StoreStage<C> {
  return { kind: 'store', component, ...o }
}

export function sink(o: StageBase = {}): SinkStage {
  return { kind: 'sink', ...o }
}

export function lost(o: { from: readonly string[]; takes?: readonly Loss[] } & StageBase): LostStage {
  return { kind: 'lost', ...o }
}

// the component only from the argument: from the stages the result goes into, a split beside it reads as any string
export function fanout<const C extends string = never>(
  o: { to: FanoutStage['to']; component?: C } & StageBase,
): FanoutStage<NoInfer<C>> {
  return { kind: 'fanout', ...o }
}

export function gather(
  o: { to: GatherStage['to']; needs?: GatherStage['needs']; hedge?: GatherStage['hedge'] } & StageBase,
): GatherStage {
  return { kind: 'gather', ...o }
}

export function split<const C extends string = never>(
  o: { to: SplitStage['to']; component?: C } & StageBase,
): SplitStage<NoInfer<C>> {
  return { kind: 'split', ...o }
}

/**
 * A store or a pass that a key connection shards over members: each flow's parts, part i on member i mod members, and
 * with a skew the share of each flow on part 0, the hottest. What the board draws, and where the dots go.
 */
export interface Shards {
  members: number
  parts: Readonly<Record<string, number>>
  skew?: Readonly<Record<string, number>>
}

/** A stage with its numbers worked out for one set of values. */
export type ResolvedStage = {
  id: string
  label: string
  shards?: Shards
  /** The share of the units it works on that its component fails, when it fails any. */
  fails?: number
  /** Its component is in a named part of a domain that is down: what reaches it is turned away here. */
  gone?: true
  /** A split with a part down: the flows no way is left for, turned away here. */
  stranded?: readonly string[]
} & (
  | {
      kind: 'pass' | 'limit'
      component: string
      /** The share of what is offered (`at`) above its capacity. */
      rejects: number
      /** The share of what actually reaches it that it turns away: less than `rejects` behind a stage that cut first. */
      shed: number
      /** A pass that sheds by priority: each flow's share of what reaches it that it turns away. */
      shedBy?: Readonly<Record<string, number>>
    }
  | { kind: 'store'; component: string }
  | { kind: 'sink'; component?: undefined }
  | { kind: 'lost'; component?: undefined; from: readonly string[]; takes: readonly Loss[] }
  | {
      kind: 'queue'
      component?: string
      partitions: Readonly<Record<string, number>>
      /** With a key connection that gives skew: the share of each flow on partition 0, the hottest. */
      skew?: Readonly<Record<string, number>>
      /** The units it holds, when it has a size. */
      holds?: number
      /** With a size: where a unit that finds it full is turned away, at the queue or at the stage before it. */
      whenFull?: 'reject' | 'block'
    }
  | {
      kind: 'workers'
      component: string
      /** The pods drawn: an autoscaled pool's max, so the load never moves the layout. */
      pods: number
      perPod: number
      placement: 'round-robin' | 'in-order'
      /** The pods running at these values: `pods` unless the pool autoscales. */
      running: number
      autoscale?: { min: number; max: number; target: number }
      /** With an exclusive connection into it: which worker reads each partition. */
      assignment?: WorkersAssignment
    }
  | {
      kind: 'fanout'
      component?: string
      to: Readonly<Record<string, readonly ResolvedBranch[]>>
      rejects: number
      /** The share of its copies it turns away. */
      shed: number
    }
  | {
      kind: 'gather'
      component?: undefined
      /** Each flow's calls: one branch, its `share` the calls a unit makes. */
      to: Readonly<Record<string, readonly ResolvedBranch[]>>
      /** How many of the calls must answer; all of them without it. */
      needs?: number
      /** The percentile of a call's time past which it is sent again; none without it. */
      hedge?: number
      /** The share of each flow's units that fail here: too few of their calls answered. */
      failing: Readonly<Record<string, number>>
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

/** Which worker of an exclusive pool reads each partition, and how much of the work each running worker has. */
export interface WorkersAssignment {
  /** What owns a partition: a worker, or a pod (then `cells` names the pod's first worker). */
  owner: 'worker' | 'pod'
  /** Per flow, the worker (its cell: pod × workers per pod + its place in the pod) that reads each partition. */
  cells: Readonly<Record<string, readonly number[]>>
  /** Per flow, the queue whose partitions those are. */
  from: Readonly<Record<string, string>>
  /** Each running worker's share of the work, adding up to 1; 0 for one that reads no partition. */
  weights: readonly number[]
}

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
  const rejects = rejectShare(util(s.kind === 'sink' || s.kind === 'lost' ? undefined : s.component), full)
  switch (s.kind) {
    case 'queue': {
      const holds = s.holds == null ? undefined : dyn(s.holds, ctx)
      if (holds != null && !(holds > 0 && Number.isFinite(holds)))
        throw new Error(`loadmap: queue "${id}" holds ${holds} units: a number above 0`)
      return {
        id,
        label,
        kind: 'queue',
        component: s.component,
        partitions: dyn(s.partitions, ctx),
        ...(holds != null ? { holds, whenFull: s.whenFull ?? 'reject' } : {}),
      }
    }
    case 'workers': {
      const perPod = dyn(s.perPod, ctx)
      const base = {
        id,
        label,
        kind: 'workers' as const,
        component: s.component,
        perPod,
        placement: s.placement ?? s.fill ?? 'round-robin',
      }
      return { ...base, ...podsOf(id, s, ctx, plain ? plain(s.component) : util(s.component)) }
    }
    case 'fanout': {
      const to = dyn(s.to, ctx)
      const perFlow: Record<string, readonly ResolvedBranch[]> = {}
      for (const f of flowIds)
        perFlow[f] = ((Array.isArray(to) ? to : ((to as Record<string, Branch[]>)[f] ?? [])) as Branch[]).map((b) => {
          const stages = chainOf(b)
          if (!stages.length) throw new Error(`loadmap: fan-out "${id}" has a branch with no stage`)
          return { stage: stages[0]!, stages, share: b.share }
        })
      return { id, label, kind: 'fanout', component: s.component, to: perFlow, rejects, shed: rejects }
    }
    case 'gather': {
      const to = dyn(s.to, ctx)
      const perFlow: Record<string, readonly ResolvedBranch[]> = {}
      for (const f of flowIds) {
        const list = (Array.isArray(to) ? to : ((to as Record<string, Branch[]>)[f] ?? [])) as Branch[]
        if (list.length > 1)
          throw new Error(`loadmap: gather "${id}" has ${list.length} branches for "${f}": one a flow`)
        perFlow[f] = list.map((b) => {
          const stages = chainOf(b)
          if (!stages.length) throw new Error(`loadmap: gather "${id}" has a branch with no stage`)
          if (!(Number.isInteger(b.share) && b.share >= 1))
            throw new Error(
              `loadmap: gather "${id}" makes ${b.share} calls for each unit of "${f}": a whole number from 1`,
            )
          return { stage: stages[0]!, stages, share: b.share }
        })
      }
      const needs = s.needs == null ? undefined : dyn(s.needs, ctx)
      for (const f of flowIds) {
        const calls = perFlow[f]![0]?.share
        if (calls != null && needs != null && !(Number.isInteger(needs) && needs >= 1 && needs <= calls))
          throw new Error(
            `loadmap: gather "${id}" needs ${needs} of its ${calls} calls: a whole number from 1 to ${calls}`,
          )
      }
      const hedge = s.hedge == null ? undefined : dyn(s.hedge, ctx)
      // 1 is no hedge: a call is never still out past all of its time, so a control can switch it off
      if (hedge != null && !(hedge > 0 && hedge <= 1))
        throw new Error(`loadmap: gather "${id}" hedges at a share of ${hedge}: a percentile above 0, up to 1`)
      return {
        id,
        label,
        kind: 'gather',
        to: perFlow,
        ...(needs != null ? { needs } : {}),
        ...(hedge != null && hedge < 1 ? { hedge } : {}),
        failing: {},
      }
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
    case 'lost':
      return { id, label, kind: 'lost', from: s.from, takes: s.takes ?? LOSSES }
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
