import type { Dyn, LooseValues, Model } from '@loadmap/core'

/** Text, or text computed from the model's context (e.g. a rate). */
export type Label = string | ((ctx: LooseValues) => string)

/** A theme token (accent, alt, ok, warn, drop, muted) or any CSS colour. */
export type FlowColor = 'accent' | 'alt' | 'ok' | 'warn' | 'drop' | 'muted' | (string & {})

export interface NodeDef<S extends string = string> {
  kind: 'node'
  label: Label
  sub?: Label
  /** The stage this node shows: dots stop here, and it takes its component's state colour. */
  stage?: S
  /** A component to colour by, for a node that is not a stage. */
  component?: string
  shape: 'box' | 'cylinder'
}

/** A cluster of members (brokers) holding a queue stage's partitions: partition i on member i mod n. */
export interface ClusterDef<S extends string = string> {
  kind: 'cluster'
  label: Label
  sub?: Label
  stage: S
  members: Dyn<number>
  memberLabel?: (i: number) => string
}

/** A workers stage drawn as pods holding a grid of workers. */
export interface PoolDef<S extends string = string> {
  kind: 'pool'
  label: Label
  sub?: Label
  stage: S
  podLabel?: (i: number) => string
}

export type AnyNodeDef<S extends string = string> = NodeDef<S> | ClusterDef<S> | PoolDef<S>

export interface EdgeDef<N extends string = string> {
  from: N
  to: N
  label?: Label
  /** The edge is left out when this returns false. */
  when?: (ctx: LooseValues) => unknown
}

export interface FlowView<N extends string = string> {
  /** The node a flow's dots start from. */
  from: N
  color: FlowColor
  label?: string
}

export interface ViewDef<F extends string, S extends string, N extends string> {
  nodes: { [K in N]: AnyNodeDef<NoInfer<S>> }
  edges: readonly EdgeDef<NoInfer<N>>[]
  flows: { [K in F]: FlowView<NoInfer<N>> }
}

export interface View<F extends string = string, S extends string = string, N extends string = string> {
  model: Model<any, F, any, S>
  def: ViewDef<F, S, N>
}

export function topology<P, F extends string, C extends string, S extends string, const N extends string>(
  model: Model<P, F, C, S>,
  def: ViewDef<F, S, N>,
): View<F, S, N> {
  const nodes = def.nodes as Record<string, AnyNodeDef>
  for (const e of def.edges)
    for (const end of [e.from, e.to]) if (!(end in nodes)) throw new Error(`loadmap: edge to unknown node "${end}"`)
  for (const [f, fv] of Object.entries(def.flows) as [string, FlowView][])
    if (!(fv.from in nodes)) throw new Error(`loadmap: flow "${f}" starts at unknown node "${fv.from}"`)
  for (const s of model.stageIds)
    if (!Object.values(nodes).some((n) => n.stage === s)) throw new Error(`loadmap: no node shows stage "${s}"`)
  return { model, def }
}

export function node<const S extends string = never>(o: {
  label: Label
  sub?: Label
  stage?: S
  component?: string
  shape?: NodeDef['shape']
}): NodeDef<S> {
  return { kind: 'node', shape: 'box', ...o }
}

export function cluster<const S extends string>(o: Omit<ClusterDef<S>, 'kind'>): ClusterDef<S> {
  return { kind: 'cluster', ...o }
}

export function pool<const S extends string>(o: Omit<PoolDef<S>, 'kind'>): PoolDef<S> {
  return { kind: 'pool', ...o }
}

export function edge<const A extends string, const B extends string>(
  from: A,
  to: B,
  o: { label?: Label; when?: EdgeDef['when'] } = {},
): EdgeDef<A | B> {
  return { from, to, ...o }
}
