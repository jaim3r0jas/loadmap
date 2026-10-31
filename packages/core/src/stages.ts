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
  pods: Dyn<number>
  perPod: Dyn<number>
  /** 'round-robin' spreads load across pods (the default); 'in-order' fills pod 0 first. */
  fill: 'round-robin' | 'in-order'
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
  o: { pods: Dyn<number>; perPod: Dyn<number>; fill?: WorkersStage['fill'] } & StageBase,
): WorkersStage<C> {
  return { kind: 'workers', component, ...o, fill: o.fill ?? 'round-robin' }
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
  | { kind: 'pass' | 'store'; component: string }
  | { kind: 'sink'; component?: undefined }
  | { kind: 'queue'; component?: string; partitions: Readonly<Record<string, number>> }
  | { kind: 'workers'; component: string; pods: number; perPod: number; fill: WorkersStage['fill'] }
  | { kind: 'fanout'; component?: string; to: Readonly<Record<string, readonly Branch[]>> }
)

export function dyn<T>(v: Dyn<T>, ctx: LooseValues): T {
  return typeof v === 'function' ? (v as (ctx: LooseValues) => T)(ctx) : v
}

export function resolveStage(id: string, s: StageDef, ctx: LooseValues, flowIds: readonly string[]): ResolvedStage {
  const label = s.label ?? id
  switch (s.kind) {
    case 'queue':
      return { id, label, kind: 'queue', component: s.component, partitions: dyn(s.partitions, ctx) }
    case 'workers':
      return {
        id,
        label,
        kind: 'workers',
        component: s.component,
        pods: dyn(s.pods, ctx),
        perPod: dyn(s.perPod, ctx),
        fill: s.fill,
      }
    case 'fanout': {
      const to = dyn(s.to, ctx)
      const perFlow: Record<string, readonly Branch[]> = {}
      for (const f of flowIds) perFlow[f] = Array.isArray(to) ? to : ((to as Record<string, Branch[]>)[f] ?? [])
      return { id, label, kind: 'fanout', component: s.component, to: perFlow }
    }
    case 'sink':
      return { id, label, kind: 'sink' }
    default:
      return { id, label, kind: s.kind, component: s.component }
  }
}
