import type { Dyn, LooseValues, Model } from '@loadmap/core'

/** Text, or text computed from the model's context (e.g. a rate). */
export type Label = string | ((ctx: LooseValues) => string)

/** A theme token (accent, alt, ok, warn, drop, muted) or any CSS colour. */
export type FlowColor = 'accent' | 'alt' | 'ok' | 'warn' | 'drop' | 'muted' | (string & {})

export interface NodeDef<S extends string = string, T extends string = string> {
  kind: 'node'
  label: Label
  sub?: Label
  /** The stage this node shows: dots stop here, and it takes its component's state colour. */
  stage?: S
  /** A component to colour by, for a node that is not a stage. */
  component?: string
  shape: 'box' | 'cylinder'
  /** The tier (`ViewDef.tiers`) the box stands in. */
  tier?: T
}

/**
 * A cluster of members (brokers) holding the partitions of one or several queue stages (topics): partition i of each
 * on member i mod n.
 */
export interface ClusterDef<S extends string = string, T extends string = string> {
  kind: 'cluster'
  label: Label
  sub?: Label
  stage: S | readonly S[]
  members: Dyn<number>
  memberLabel?: (i: number) => string
  tier?: T
}

/** A workers stage drawn as pods holding a grid of workers. */
export interface PoolDef<S extends string = string, T extends string = string> {
  kind: 'pool'
  label: Label
  sub?: Label
  stage: S
  podLabel?: (i: number) => string
  tier?: T
}

export type AnyNodeDef<S extends string = string, T extends string = string> =
  | NodeDef<S, T>
  | ClusterDef<S, T>
  | PoolDef<S, T>

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

/** A band the diagram is cut into across the flow (edge, app, data), in the order the flow meets them. */
export interface TierDef {
  label: string
  /** The lane's own fill in place of the theme's: a CSS colour (a definition's text takes hex, `rgb()` or `hsl()`). */
  fill?: string
  /** Its fill in the dark theme, also without `fill` (light keeps the theme's). Default: `fill`'s hue, as dark as the theme's lanes. */
  fillDark?: string
}

export interface ViewDef<F extends string, S extends string, N extends string, T extends string = string> {
  nodes: { [K in N]: AnyNodeDef<NoInfer<S>, NoInfer<T>> }
  edges: readonly EdgeDef<NoInfer<N>>[]
  flows: { [K in F]: FlowView<NoInfer<N>> }
  /**
   * Bands across the flow, in the order the flow meets them: each box names its own (`tier`), a box without one
   * stands in the tier of the boxes that feed it. Without tiers, the boxes nothing feeds come first and the sinks and
   * stores that feed nothing come last.
   */
  tiers?: { readonly [K in T]: TierDef }
  /**
   * `compact` (the default) lays out each phase (a scenario, story step, preset or choice of a select or switch) on its
   * own, over every load and every point of the range controls, and moves the boxes from one phase to the next;
   * `stable` lays out every box at its largest anywhere the model reaches, so no phase moves a box. Neither the load nor
   * a range control moves one either way.
   */
  layout?: 'compact' | 'stable'
  /** `filled` (the default) gives every lane a fill, alternating two shades; `striped` leaves every other one clear. */
  lanes?: 'filled' | 'striped'
}

export interface View<F extends string = string, S extends string = string, N extends string = string> {
  model: Model<any, F, any, S>
  def: ViewDef<F, S, N>
}

export function defineView<
  P,
  F extends string,
  C extends string,
  S extends string,
  const N extends string,
  const T extends string = never,
>(model: Model<P, F, C, S>, def: ViewDef<F, S, N, T>): View<F, S, N> {
  const nodes = def.nodes as Record<string, AnyNodeDef>
  for (const e of def.edges)
    for (const end of [e.from, e.to]) if (!(end in nodes)) throw new Error(`loadmap: edge to unknown node "${end}"`)
  for (const [f, fv] of Object.entries(def.flows) as [string, FlowView][])
    if (!(fv.from in nodes)) throw new Error(`loadmap: flow "${f}" starts at unknown node "${fv.from}"`)
  const tiers: Readonly<Record<string, TierDef>> = def.tiers ?? {}
  for (const [id, n] of Object.entries(nodes))
    if (n.tier != null && !Object.hasOwn(tiers, n.tier))
      throw new Error(`loadmap: node "${id}" stands in unknown tier "${n.tier}"`)
  if (def.layout != null && def.layout !== 'compact' && def.layout !== 'stable')
    throw new Error(`loadmap: layout "${def.layout}" is not compact or stable`)
  const shows = (n: AnyNodeDef, s: string) => (Array.isArray(n.stage) ? n.stage.includes(s) : n.stage === s)
  for (const s of model.stageIds)
    if (!Object.values(nodes).some((n) => shows(n, s))) throw new Error(`loadmap: no node shows stage "${s}"`)
  return { model, def }
}

export function node<const S extends string = never, const T extends string = never>(o: {
  label: Label
  sub?: Label
  stage?: S
  component?: string
  shape?: NodeDef['shape']
  tier?: T
}): NodeDef<S, NoInfer<T>> {
  return { kind: 'node', shape: 'box', ...o }
}

export function cluster<const S extends string, const T extends string = never>(
  o: Omit<ClusterDef<S, T>, 'kind'>,
): ClusterDef<S, NoInfer<T>> {
  return { kind: 'cluster', ...o }
}

export function pool<const S extends string, const T extends string = never>(
  o: Omit<PoolDef<S, T>, 'kind'>,
): PoolDef<S, NoInfer<T>> {
  return { kind: 'pool', ...o }
}

export function edge<const A extends string, const B extends string>(
  from: A,
  to: B,
  o: { label?: Label; when?: EdgeDef['when'] } = {},
): EdgeDef<A | B> {
  return { from, to, ...o }
}
