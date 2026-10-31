import type { LooseValues } from './params'

/** A number, or one computed from the model's context (parameters, flows, utilization). */
export type Dyn<T> = T | ((ctx: LooseValues) => T)

/** Flows pass through; when its component is over capacity, the share above 100 % is rejected. */
export interface PassStage<C extends string = string> {
  kind: 'pass'
  component: C
}

/** Flows wait here; the next stage on each flow's route drains it at that stage's capacity. */
export interface QueueStage<C extends string = string> {
  kind: 'queue'
  component?: C
  /** Partitions per flow. Drawn as cells; partition i sits on member i mod n of the node that shows it. */
  partitions: Dyn<Readonly<Record<string, number>>>
}

/** A pool of workers: pods × workers per pod. Busy workers fill evenly across pods. */
export interface WorkersStage<C extends string = string> {
  kind: 'workers'
  component: C
  pods: Dyn<number>
  perPod: Dyn<number>
  /** 'round-robin' spreads load across pods (the default); 'in-order' fills pod 0 first. */
  fill: 'round-robin' | 'in-order'
}

/** Where a flow ends: written to its component. */
export interface StoreStage<C extends string = string> {
  kind: 'store'
  component: C
}

export type StageDef<C extends string = string> = PassStage<C> | QueueStage<C> | WorkersStage<C> | StoreStage<C>

export function pass<const C extends string>(component: C): PassStage<C> {
  return { kind: 'pass', component }
}

export function queue<const C extends string = never>(o: {
  partitions: QueueStage['partitions']
  component?: C
}): QueueStage<C> {
  return { kind: 'queue', ...o }
}

export function workers<const C extends string>(
  component: C,
  o: { pods: Dyn<number>; perPod: Dyn<number>; fill?: WorkersStage['fill'] },
): WorkersStage<C> {
  return { kind: 'workers', component, pods: o.pods, perPod: o.perPod, fill: o.fill ?? 'round-robin' }
}

export function store<const C extends string>(component: C): StoreStage<C> {
  return { kind: 'store', component }
}

/** A stage with its numbers worked out for one set of values. */
export type ResolvedStage =
  | { id: string; kind: 'pass' | 'store'; component: string }
  | { id: string; kind: 'queue'; component?: string; partitions: Readonly<Record<string, number>> }
  | { id: string; kind: 'workers'; component: string; pods: number; perPod: number; fill: WorkersStage['fill'] }

export function dyn<T>(v: Dyn<T>, ctx: LooseValues): T {
  return typeof v === 'function' ? (v as (ctx: LooseValues) => T)(ctx) : v
}

export function resolveStage(id: string, s: StageDef, ctx: LooseValues): ResolvedStage {
  switch (s.kind) {
    case 'queue':
      return { id, kind: 'queue', component: s.component, partitions: dyn(s.partitions, ctx) }
    case 'workers':
      return {
        id,
        kind: 'workers',
        component: s.component,
        pods: dyn(s.pods, ctx),
        perPod: dyn(s.perPod, ctx),
        fill: s.fill,
      }
    default:
      return { id, kind: s.kind, component: s.component }
  }
}
