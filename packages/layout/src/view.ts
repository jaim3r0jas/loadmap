import type { Dyn, LooseValues, Loss, Model, ResolvedStage, StageDef } from '@loadmap/core'
import { compact } from '@loadmap/core/format'

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
  /** The subsystem (`ViewDef.subsystems`) whose frame the box stands in. */
  subsystem?: string
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
  subsystem?: string
}

/** A workers stage drawn as pods holding a grid of workers. */
export interface PoolDef<S extends string = string, T extends string = string> {
  kind: 'pool'
  label: Label
  sub?: Label
  stage: S
  podLabel?: (i: number) => string
  tier?: T
  subsystem?: string
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

/**
 * Several boxes as one on the board: a frame around the boxes that name it, with its name. A subsystem `in` another
 * stands inside that one's frame.
 */
export interface SubsystemDef {
  label: string
  in?: string
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
   * The subsystems, by id: each is drawn as a frame around its boxes (`subsystem` on a box) and the subsystems `in` it.
   * With tiers, a subsystem is framed where its boxes stand in one tier: a frame cannot cross a lane.
   */
  subsystems?: Readonly<Record<string, SubsystemDef>>
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
  return checked(model, def, true)
}

/**
 * `defineView` that lets a hop go without its edge, its dots straight across: for a `.loadmap` stamped before
 * loadmap 1.1, which warns about the hop instead, so a file that drew before still draws.
 */
export function defineViewUnjoined(model: Model, def: ViewDef<string, string, string>): View {
  return checked(model, def, false)
}

function checked<F extends string, S extends string, N extends string, T extends string>(
  model: Model<any, F, any, S>,
  def: ViewDef<F, S, N, T>,
  hops: boolean,
): View<F, S, N> {
  const nodes = def.nodes as Record<string, AnyNodeDef>
  for (const e of def.edges)
    for (const end of [e.from, e.to]) if (!(end in nodes)) throw new Error(`loadmap: edge to unknown node "${end}"`)
  for (const [f, fv] of Object.entries(def.flows) as [string, FlowView][])
    if (!(fv.from in nodes)) throw new Error(`loadmap: flow "${f}" starts at unknown node "${fv.from}"`)
  const tiers: Readonly<Record<string, TierDef>> = def.tiers ?? {}
  for (const [id, n] of Object.entries(nodes))
    if (n.tier != null && !Object.hasOwn(tiers, n.tier))
      throw new Error(`loadmap: node "${id}" stands in unknown tier "${n.tier}"`)
  const subsystems: Readonly<Record<string, SubsystemDef>> = def.subsystems ?? {}
  for (const [id, n] of Object.entries(nodes))
    if (n.subsystem != null && !Object.hasOwn(subsystems, n.subsystem))
      throw new Error(`loadmap: node "${id}" stands in unknown subsystem "${n.subsystem}"`)
  for (const [id, s] of Object.entries(subsystems)) {
    if (s.in != null && !Object.hasOwn(subsystems, s.in))
      throw new Error(`loadmap: subsystem "${id}" stands in unknown subsystem "${s.in}"`)
    const seen = new Set([id])
    for (let up = s.in; up != null; up = subsystems[up]?.in) {
      if (seen.has(up)) throw new Error(`loadmap: subsystem "${id}" stands in itself`)
      seen.add(up)
    }
  }
  if (def.layout != null && def.layout !== 'compact' && def.layout !== 'stable')
    throw new Error(`loadmap: layout "${def.layout}" is not compact or stable`)
  for (const s of model.stageIds)
    if (!Object.values(nodes).some((n) => shows(n, s))) throw new Error(`loadmap: no node shows stage "${s}"`)
  // a dot moves only along an edge: one it would cross the diagram without is a mistake, not a shortcut
  const gap = hops && unjoined(model, def as ViewDef<string, string, string>)[0]
  if (gap)
    throw new Error(
      `loadmap: flow "${gap.flow}" goes from node "${gap.from}" to node "${gap.to}"${gap.edge === 'reversed' ? ', but their edge points the other way' : ' with no edge between them'}: add edge('${gap.from}', '${gap.to}')`,
    )
  return { model, def: withLostCounts(model, def) }
}

const LOST: Record<Loss, string> = { rejected: 'rejected', dropped: 'dropped', timedOut: 'timed out' }

/** A lost box says what reaches it, per second, on its second line, unless the view gives it one of its own. */
function withLostCounts<D extends ViewDef<any, any, any, any>>(model: Model, def: D): D {
  const stages = model.def.stages as Record<string, StageDef>
  let nodes: Record<string, AnyNodeDef> | undefined
  for (const [id, n] of Object.entries(def.nodes as Record<string, AnyNodeDef>)) {
    const st = n.kind === 'node' && n.stage != null ? stages[n.stage] : undefined
    if (st?.kind !== 'lost' || n.sub != null) continue
    const stage = n.stage as string
    const takes = st.takes ?? []
    const word = takes.length === 1 ? LOST[takes[0]!] : 'lost'
    const sub = (ctx: LooseValues) => {
      const at = (ctx.at as Record<string, Record<string, number>>)[stage] ?? {}
      return `${compact(Object.values(at).reduce((a, x) => a + x, 0))} ${word}/s`
    }
    nodes ??= { ...(def.nodes as Record<string, AnyNodeDef>) }
    nodes[id] = { ...n, sub }
  }
  return nodes ? { ...def, nodes } : def
}

const shows = (n: AnyNodeDef, s: string) => (Array.isArray(n.stage) ? n.stage.includes(s) : n.stage === s)

/** One step a flow's dots take from one box to the next. */
export interface Hop {
  flow: string
  /** The stages it joins, in the flow's direction; the first is null for the start (the flow's `from` node). */
  stages: readonly [string | null, string]
  /** The node each end is drawn in. */
  from: string
  to: string
  /** Whether an edge joins them in the flow's direction, only the other way, or not at all. */
  edge: 'yes' | 'reversed' | 'none'
  /** What makes the hop: the start, the route (with a split's ways), a fan-out's copies, a lost box's losses. */
  via: 'start' | 'route' | 'fanout' | 'lost'
  /** Whether any unit takes it at these values: a split's way of share 0 or a branch of 0 copies takes none. */
  used: boolean
}

/**
 * The hops no edge joins in the flow's direction, at the defaults and in each scenario and story step: a split's or a
 * fan-out's `to` may change its stages with the values. A phase whose values fail to resolve is left to whatever runs
 * it, which reports the failure where it belongs.
 */
export function unjoined<F extends string, S extends string>(
  model: Model<any, F, any, S>,
  def: ViewDef<F, S, string>,
): Hop[] {
  const out: Hop[] = []
  const phases = [...model.scenarios, ...model.story].map((s) => s.values as LooseValues)
  for (const [i, v] of [undefined, ...phases].entries()) {
    let hops: Hop[]
    try {
      hops = hopsOf(model, def, v)
    } catch (err) {
      if (i === 0) throw err
      continue
    }
    for (const h of hops)
      if (
        h.edge !== 'yes' &&
        !out.some((o) => o.flow === h.flow && o.stages[0] === h.stages[0] && o.stages[1] === h.stages[1])
      )
        out.push(h)
  }
  return out
}

/**
 * Every hop of every flow at these values, once: from its `from` node to its first stage, between the stages next to
 * each other on each of its ways (a split's ways included, and where one rejoins the route), and from a fan-out to each
 * stage it copies to. Two stages drawn in one box are no hop. A stage drawn by several nodes is in the last, as the
 * layout draws it.
 */
export function hopsOf<F extends string, S extends string>(
  model: Model<any, F, any, S>,
  def: ViewDef<F, S, string>,
  values?: LooseValues,
): Hop[] {
  const owner = new Map<string, string>()
  for (const [id, n] of Object.entries(def.nodes as Record<string, AnyNodeDef>))
    for (const st of n.stage == null ? [] : Array.isArray(n.stage) ? n.stage : [n.stage]) owner.set(st, id)
  const nodeOf = (s: string) => owner.get(s)
  const edges = new Set(def.edges.map((e) => `${e.from}\u0000${e.to}`))
  const { stages, paths } = model.stagesAt(values as never)
  const out: Hop[] = []
  const add = (flow: string, a: string | null, b: string, via: Hop['via'], used: boolean) => {
    const from = a == null ? (def.flows as Record<string, FlowView>)[flow]?.from : nodeOf(a)
    const to = nodeOf(b)
    const key = `${flow}\u0000${a}\u0000${b}`
    if (from == null || to == null || from === to) return
    const known = out.find((h) => `${h.flow}\u0000${h.stages[0]}\u0000${h.stages[1]}` === key)
    if (known) {
      known.used ||= used
      return
    }
    const edge = edges.has(`${from}\u0000${to}`) ? 'yes' : edges.has(`${to}\u0000${from}`) ? 'reversed' : 'none'
    out.push({ flow, stages: [a, b], from, to, edge, via, used })
  }
  for (const f of model.flowIds) {
    for (const p of paths[f] ?? []) {
      const [first, ...rest] = p.stages
      if (first == null) continue
      const used = p.share > 0
      add(f, null, first, 'start', used)
      for (const [i, s] of rest.entries()) add(f, p.stages[i]!, s, 'route', used)
      const last = stages[p.stages.at(-1)!]
      if (last?.kind === 'fanout')
        for (const b of last.to[f] ?? []) add(f, last.id, b.stage, 'fanout', used && b.share > 0)
    }
    // what a stage on its ways loses goes to the lost box that takes it: a hop of its own
    const on = new Set<string>((paths[f] ?? []).flatMap((p) => p.stages))
    for (const d of Object.values(stages) as ResolvedStage[])
      if (d.kind === 'lost') for (const s of d.from) if (on.has(s)) add(f, s, d.id, 'lost', true)
  }
  return out
}

export function node<const S extends string = never, const T extends string = never>(o: {
  label: Label
  sub?: Label
  stage?: S
  component?: string
  shape?: NodeDef['shape']
  tier?: T
  subsystem?: string
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
