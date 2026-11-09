import { dyn, type Evaluation, type LooseValues, type ResolvedStage } from '@loadmap/core'
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api'
import { directionOf, endsFlow } from './direction'
import { estimateText, type TextMeasure } from './text'
import type { AnyNodeDef, EdgeDef, Label, View } from './view'

export type Direction = 'RIGHT' | 'DOWN'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Where a piece of text sits; the text itself comes from `labelsAt`, since it changes with the values. */
export interface TextSpot {
  x: number
  y: number
  size: number
  weight: number
}

export interface Cell extends Box, Fading {
  stage: string
  flow: string
  /** The partition's index within its flow. */
  index: number
}

/** Set only while the diagram moves to a new structure (`morph`), on a part that enters or leaves: its opacity. */
export interface Fading {
  fade?: number
}

export interface SceneNode extends Box, Fading {
  id: string
  kind: AnyNodeDef['kind']
  shape: 'box' | 'cylinder'
  /** The stages this node shows: one, or several queues for a cluster that holds several topics. */
  stages: string[]
  component?: string
  title: TextSpot
  sub?: TextSpot
  /** Cluster members (brokers) and pods, with their own small labels. */
  members: (Box & Fading & { label: string; spot: TextSpot })[]
  /** Per member, the name of each flow above its partitions. */
  groups: (Fading & { flow: string; text: string; spot: TextSpot })[]
  cells: Cell[]
  /** Workers, indexed pod × workers per pod + worker, the index the sim's fill uses. */
  slots: (Box & Fading & { index: number })[]
}

export interface SceneEdge extends Fading {
  id: string
  from: string
  to: string
  points: [number, number][]
  /** The box reserved for the label, wide enough for its widest text across the load range. */
  label?: Box
  /** Set only while a new edge draws in: the share of it drawn. */
  draw?: number
}

export interface Scene {
  /**
   * Changes only when a box is reshaped, an edge comes or goes, or (in a compact layout) the phase's frame changes; the
   * load alone never does.
   */
  key: string
  direction: Direction
  width: number
  height: number
  nodes: SceneNode[]
  edges: SceneEdge[]
  /** The node that shows each stage, and the node each flow starts from. */
  stageNode: Readonly<Record<string, string>>
  flowFrom: Readonly<Record<string, string>>
  /** The bands across the flow, in their order; empty without tiers. */
  tiers: SceneTier[]
}

/** A tier's lane: its band, the whole board across the flow, and a header with its name before the boxes. */
export interface SceneTier extends Box {
  id: string
  /** A strip across the band's top running right, a column down its left running down. */
  head: Box
  /**
   * The name in capitals from the band's start: one line, or two where a name is wider than its band (then every
   * header on the board takes two), the last cut short with "…" past that.
   */
  lines: (TextSpot & Fading & { text: string })[]
  /** The room between letters, in px. */
  spacing: number
  /** Running down, each line reads up the band's left side, ending at its spot. */
  vertical: boolean
  /** The tier's own fills (`TierDef`), when it has them. */
  fill?: string
  fillDark?: string
}

export interface LayoutOptions {
  /** Default: from the view's shape (`directionOf`). */
  direction?: Direction
  measure?: TextMeasure
  /** Where ELK runs. Default: on this thread, loaded on first use. */
  elk?: ElkEngine
}

/**
 * Lays out an ELK graph: ELK on this thread, or in a worker. Every engine gives the same result for a graph. The graph
 * is typed loosely here so that our typings never pull in elkjs's (which fail a strict check without skipLibCheck).
 */
export interface ElkEngine {
  layout(graph: ElkGraph): Promise<ElkGraph>
}

/** An ELK JSON graph (elkjs's ElkNode). */
export type ElkGraph = { id: string } & Record<string, unknown>

let local: Promise<ElkEngine> | null = null

/** ELK on this thread, imported on first use: it is about 1.6 MB, so it stays out of a page's first load. */
export function localElk(): Promise<ElkEngine> {
  // a failed load (a network error, a chunk a deploy replaced) is not kept: the next layout tries again
  local ??= import('elkjs/lib/elk.bundled.js').then(
    (m) => new m.default() as unknown as ElkEngine,
    (err) => {
      local = null
      throw err
    },
  )
  return local
}

const T_TITLE = { size: 13, weight: 600 }
const T_SUB = { size: 11, weight: 400 }
const T_SMALL = { size: 9, weight: 400 }
/** A tier's name: capitals, 0.08em apart. */
const T_TIER = { size: 11.5, weight: 600 }
const TIER_SPACING = 0.92
/** The room ELK leaves around the boxes. */
const PADDING = 16
/** A tier's header across the flow, one more line where a name needs two, and the name's distance from the band's
 * start. */
const HEAD = 30
const HEAD_LINE = 14
const TIER_PAD = 10
const PAD = 8
const GAP = 6
const CELL = 9
const CELL_GAP = 2
const CELL_COLS = 6
const SLOT = 10
const SLOT_GAP = 3
const LABEL_H = 16

/** Ports on a side gather at its middle, this far apart, so a box drawn smaller than its slot keeps its edge ends. */
const PORT_GAP = 8
/** Every combination of the controls is reached up to this many; past it, each control's options one at a time. */
const MAX_COMBINATIONS = 256
/** The loads a label is sized at in a combination of controls that no scenario, step or preset names. */
const FEW_LOADS = 5
/** A range control is reached at every step up to this many; past it, at this many points across it. */
const RANGE_STEPS = 32
const RANGE_POINTS = 9

// per measurer and view: the room each box gets depends on how wide its text measures
const scenes = new WeakMap<TextMeasure, WeakMap<View, Map<string, Promise<Scene>>>>()
const frames = new WeakMap<View, Map<string, Promise<Laid>>>()
// per measurer and view, per combination of values other than the load (a phase): the contexts labels are sized
// against, and the phase's compact frame in each direction
const sampleCache = new WeakMap<TextMeasure, WeakMap<View, Map<string, Sampled>>>()
const reserveCache = new WeakMap<TextMeasure, WeakMap<View, Map<Direction, Frame>>>()
const textWidths = new WeakMap<TextMeasure, Map<string, number>>()

interface Sampled {
  contexts: LooseValues[]
  widths: Map<Label, Map<string, number>>
  frames: Map<Direction, Frame>
}

/** What a drawing reads from an evaluation. */
type Drawn = Pick<Evaluation, 'values' | 'ctx' | 'stages'>

type Widest = (l: Label | undefined, size: number, weight: number) => number

/** The room each box and each edge label gets: the largest it takes anywhere the model reaches. */
interface Frame {
  key: string
  direction: Direction
  nodes: { id: string; w: number; h: number }[]
  /** Every edge drawn somewhere, in the definition's order. */
  edges: { id: string; from: string; to: string; labelW?: number }[]
  /** Each box's tier, as an index into `tiers`, or the layer it is held to without tiers. */
  order?: Record<string, number | 'FIRST' | 'LAST'>
  tiers?: string[]
}

/** A frame laid out: each box's slot and each edge's route, whatever the values. */
interface Laid {
  width: number
  height: number
  slots: Map<string, Box>
  routes: Map<string, { points: [number, number][]; label?: Box }>
}

/** The current text of every label. Cheap: call it on every change of values; the layout stays put. */
export function labelsAt(view: View, ev: Evaluation) {
  const ctx = ev.ctx
  const nodes: Record<string, { title: string; sub?: string }> = {}
  for (const [id, n] of Object.entries(view.def.nodes) as [string, AnyNodeDef][])
    nodes[id] = { title: text(n.label, ctx), sub: n.sub == null ? undefined : text(n.sub, ctx) }
  const edges: Record<string, string> = {}
  visibleEdges(view, ctx).forEach(({ e, id }) => {
    if (e.label != null) edges[id] = text(e.label, ctx)
  })
  return { nodes, edges }
}

/**
 * Lays the view out for the current values: grids inside clusters and pools are packed here; ELK places the boxes,
 * routes the edges and places the edge labels so that none overlaps another or a node. ELK lays out every box at the
 * largest size it takes over every load the slider reaches, and each box is drawn at its own size in the middle of that
 * slot: the load never moves a box. A compact layout (the default) lays out each phase, the values other than the load,
 * on its own; a stable one lays out every box at its largest anywhere the model reaches (its scenarios, story steps,
 * presets and controls), so no change of values the model reaches moves a box. Results are cached by the structure, so
 * a call after a load change returns the same scene.
 */
export function layout(view: View, ev: Evaluation, o: LayoutOptions = {}): Promise<Scene> {
  const direction = o.direction ?? directionOf(view)
  const measure = o.measure ?? estimateText
  const prep = prepare(view, ev, direction, measure)
  const base = baseFrame(view, ev, direction, measure)
  const key = sceneKey(prep, base)
  const byView = scenes.get(measure) ?? new WeakMap<View, Map<string, Promise<Scene>>>()
  scenes.set(measure, byView)
  const cache = byView.get(view) ?? new Map<string, Promise<Scene>>()
  byView.set(view, cache)
  return kept(cache, key, 32, () => {
    // values nothing declared reaches grow the frame: a key of its own, laid out again
    const frame = ordered(view, widen(base ?? reserve(view, direction, measure), prep))
    const byFrame = frames.get(view) ?? new Map<string, Promise<Laid>>()
    frames.set(view, byFrame)
    return kept(byFrame, frame.key, 32, () => run(frame, o.elk)).then((l) => place(prep, l, key, frame, view, measure))
  })
}

/** A compact layout's frame for this phase; null for a stable layout, whose frame waits until it is laid out. */
function baseFrame(view: View, ev: Drawn, direction: Direction, measure: TextMeasure): Frame | null {
  return view.def.layout === 'stable' ? null : phase(view, ev, direction, measure)
}

/** Two phases with the same shapes can stand in different compact frames: each frame is a structure of its own. */
function sceneKey(prep: Prepared, base: Frame | null): string {
  return base ? JSON.stringify([prep.key, base.key]) : prep.key
}

/** A promise kept by key, the oldest let go past `limit`; one that fails is let go, so the next call tries again. */
function kept<T>(cache: Map<string, Promise<T>>, key: string, limit: number, make: () => Promise<T>): Promise<T> {
  let hit = cache.get(key)
  if (!hit) {
    hit = Promise.resolve()
      .then(make)
      .catch((err) => {
        cache.delete(key)
        throw err
      })
    if (cache.size > limit) cache.delete(cache.keys().next().value!)
    cache.set(key, hit)
  }
  return hit
}

/** The structure key for the current values: equal keys give equal scenes. */
export function structureKey(view: View, ev: Evaluation, o: LayoutOptions = {}): string {
  const direction = o.direction ?? directionOf(view)
  const measure = o.measure ?? estimateText
  return sceneKey(prepare(view, ev, direction, measure), baseFrame(view, ev, direction, measure))
}

/**
 * Each box's shape at these values, by id, and the edges drawn: two calls tell which boxes a change of values reshapes
 * (pods, brokers, a wider label) and which edges come or go, before anything is laid out.
 */
export function shapesOf(view: View, ev: Evaluation, o: LayoutOptions = {}) {
  const prep = prepare(view, ev, o.direction ?? directionOf(view), o.measure ?? estimateText)
  return {
    nodes: Object.fromEntries(prep.nodes.map((n) => [n.id, JSON.stringify(n.inner)])) as Record<string, string>,
    edges: prep.edges.map((e) => ({ id: e.id, from: e.from, to: e.to })),
  }
}

type Inner = Omit<SceneNode, 'x' | 'y' | 'id' | 'kind' | 'shape' | 'stages' | 'component'>

interface Prepared {
  key: string
  direction: Direction
  nodes: { id: string; def: AnyNodeDef; inner: Inner }[]
  edges: { id: string; from: string; to: string; labelW?: number }[]
  stageNode: Record<string, string>
  flowFrom: Record<string, string>
}

function prepare(view: View, ev: Evaluation, direction: Direction, measure: TextMeasure): Prepared {
  const { nodes, edges, stageNode } = shapes(view, ev, direction, measure, labelWidths(view, ev.values, measure))
  const flowFrom: Record<string, string> = {}
  for (const [f, fv] of Object.entries(view.def.flows) as [string, { from: string }][]) flowFrom[f] = fv.from
  // everything the scene is built from, so two different structures never share a scene
  const key = JSON.stringify({ direction, nodes: nodes.map((n) => [n.id, n.def.kind, n.inner]), edges, flowFrom })
  return { key, direction, nodes, edges, stageNode, flowFrom }
}

/** Each box packed and each edge drawn at these values, its labels sized by `widest`. */
function shapes(view: View, ev: Drawn, direction: Direction, measure: TextMeasure, widest: Widest) {
  const stageNode: Record<string, string> = {}
  const nodes = (Object.entries(view.def.nodes) as [string, AnyNodeDef][]).map(([id, def]) => {
    const own = stagesOf(def)
    for (const st of own) stageNode[st] = id
    const titleW = widest(def.label, T_TITLE.size, T_TITLE.weight)
    const subW = widest(def.sub, T_SUB.size, T_SUB.weight)
    const resolved = own.map((st) => (ev.stages as Record<string, ResolvedStage>)[st]!)
    const stage = resolved[0]
    const queues = resolved.filter((r) => r.kind === 'queue')
    const inner =
      def.kind === 'cluster' && queues.length
        ? clusterInner(def, queues, ev.ctx, direction, titleW, subW, measure, view)
        : def.kind === 'pool' && stage?.kind === 'workers'
          ? poolInner(def, stage, direction, titleW, subW)
          : boxInner(titleW, subW, def.sub != null, def.kind === 'node' && def.shape === 'cylinder' ? 8 : 0)
    return { id, def, inner }
  })
  const edges = visibleEdges(view, ev.ctx).map(({ e, id }) => ({
    id,
    from: e.from,
    to: e.to,
    labelW: e.label == null ? undefined : widest(e.label, T_SUB.size, T_SUB.weight) + 8,
  }))
  return { nodes, edges, stageNode }
}

/**
 * The combinations of values the model reaches: the defaults, each scenario, story step and declared preset, and
 * every combination of the controls (a range at each step, or at points across it); past `MAX_COMBINATIONS`, each
 * control's options one at a time from each of the others. Each is evaluated over every load where a scenario, step or
 * preset stands, and at a few loads elsewhere, and handed to `f` with its labels sized over those loads: a box, a label
 * or an edge that comes out at any of them grows the frame. Each is let go: hundreds of evaluations are too many to
 * keep. A combination or a load the model cannot evaluate is left out: only the values shown can fail the layout.
 */
function reach(view: View, measure: TextMeasure, f: (evs: Drawn[], widest: Widest) => void): void {
  const model = view.model
  const base = model.defaults() as LooseValues
  const anchors: LooseValues[] = [
    base,
    ...model.scenarios.map((s) => ({ ...base, ...s.values })),
    ...model.story.map((s) => s.values as LooseValues),
    ...Object.values((model.def.presets ?? {}) as Record<string, LooseValues>).map((v) => ({ ...base, ...v })),
  ]
  const controls = model.params.flatMap(({ id, def }) => {
    if (def.kind === 'select') return [{ id, options: [...def.options] as unknown[] }]
    if (def.kind === 'switch') return [{ id, options: [false, true] as unknown[] }]
    if (def.kind === 'range') return [{ id, options: rangePoints(def) }]
    return []
  })
  const count = controls.reduce((n, c) => n * c.options.length, 1)
  const others =
    count <= MAX_COMBINATIONS
      ? controls.reduce<LooseValues[]>(
          (all, c) => all.flatMap((v) => c.options.map((o) => ({ ...v, [c.id]: o }))),
          [base],
        )
      : anchors.flatMap((a) => controls.flatMap((c) => c.options.map((o) => ({ ...a, [c.id]: o }))))
  const seen = new Set<string>()
  const fresh = (v: LooseValues) => {
    const { load: _, ...rest } = v
    const key = JSON.stringify(rest)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }
  const few = fewLoads(model.load)
  const tried = (g: () => void) => {
    try {
      g()
    } catch {}
  }
  const over = (v: LooseValues, loads: number[]) =>
    tried(() => {
      // the values themselves must evaluate; a load past what the model can take is left out
      const evs = [...atLoads(view, v, loads), model.stagesAt(v)]
      const contexts = evs.map((e) => e.ctx)
      f(evs, widestOver(contexts, new Map(), measure))
    })
  // swept over every load, outside the cache the values on screen keep theirs in
  for (const v of anchors.filter(fresh)) over(v, sweep(model))
  for (const v of others.filter(fresh)) over(v, few)
}

/** A few loads across the slider, and its default. */
function fewLoads({ min, max, step, default: at }: { min: number; max: number; step: number; default: number }) {
  const snap = (x: number) => Math.min(max, min + Math.round((x - min) / step) * step)
  return [
    ...new Set(Array.from({ length: FEW_LOADS - 1 }, (_, i) => snap(min + ((max - min) * i) / (FEW_LOADS - 2)))),
  ].concat(at)
}

function rangePoints(def: { min: number; max: number; step: number; default: number }): unknown[] {
  const n = Math.floor((def.max - def.min) / def.step)
  const points =
    n <= RANGE_STEPS
      ? Array.from({ length: n + 1 }, (_, i) => def.min + i * def.step)
      : Array.from({ length: RANGE_POINTS }, (_, i) => def.min + Math.round((n * i) / (RANGE_POINTS - 1)) * def.step)
  return [...new Set([...points, def.max, def.default])]
}

/**
 * The loads a phase is sized over: every load the slider stops at, and every load the model names (its default, a story
 * step's or a preset's), which can stand between two stops. The same for every phase, so a phase's frame depends on
 * nothing but its own values.
 */
function sweep(model: View['model']): number[] {
  const named = [
    model.load.default,
    ...[...model.story.map((s) => s.values), ...Object.values(model.def.presets ?? {})].map((v) => v.load),
  ]
  return [...new Set([...everyLoad(model.load), ...named.filter((l): l is number => typeof l === 'number')])]
}

/** Every load the slider stops at, or 401 points across a slider with more. */
function everyLoad({ min, max, step }: { min: number; max: number; step: number }): number[] {
  const n = Math.floor((max - min) / step)
  return n <= 400
    ? [...Array.from({ length: n + 1 }, (_, i) => min + i * step), max]
    : Array.from({ length: 401 }, (_, i) => min + ((max - min) * i) / 400)
}

/** The largest each box and edge label is anywhere the model reaches, in this direction. */
function reserve(view: View, direction: Direction, measure: TextMeasure): Frame {
  const byView = reserveCache.get(measure) ?? new WeakMap<View, Map<Direction, Frame>>()
  reserveCache.set(measure, byView)
  const byDirection = byView.get(view) ?? new Map<Direction, Frame>()
  byView.set(view, byDirection)
  let frame = byDirection.get(direction)
  if (!frame) {
    let grown = widen({ key: '', direction, nodes: [], edges: [] })
    reach(view, measure, (evs, widest) => {
      grown = widen(grown, ...sized(view, evs, direction, measure, widest))
    })
    frame = grown
    byDirection.set(direction, frame)
  }
  return frame
}

/**
 * The largest each box and edge label is over every load the slider reaches at these values, and every edge drawn
 * anywhere along it, with each range control across its points (at a few loads, as `reach` takes a control): a phase's
 * frame, which depends on nothing but its own values other than the load and the ranges. A load the model cannot
 * evaluate is left out, as `reach` leaves out a combination.
 */
function phase(view: View, ev: Drawn, direction: Direction, measure: TextMeasure): Frame {
  const model = view.model
  // a range control is dragged like the load: the phase is the values without either
  const ranges = model.params.flatMap(({ id, def }) => (def.kind === 'range' ? [{ id, def }] : []))
  const values: LooseValues = { ...ev.values, ...Object.fromEntries(ranges.map(({ id, def }) => [id, def.default])) }
  const { frames } = sample(view, values, measure)
  let frame = frames.get(direction)
  if (!frame) {
    const adds = sized(
      view,
      atLoads(view, values, sweep(model)),
      direction,
      measure,
      labelWidths(view, values, measure),
    )
    // each range at each of its points, the others at their defaults
    for (const { id, def } of ranges)
      for (const o of rangePoints(def)) {
        const evs = atLoads(view, { ...values, [id]: o }, fewLoads(model.load))
        adds.push(
          ...sized(
            view,
            evs,
            direction,
            measure,
            widestOver(
              evs.map((e) => e.ctx),
              new Map(),
              measure,
            ),
          ),
        )
      }
    frame = widen({ key: '', direction, nodes: [], edges: [] }, ...adds)
    frames.set(direction, frame)
  }
  return frame
}

/** The model at these values at each of these loads; a load it cannot evaluate is left out. */
function atLoads(view: View, values: LooseValues, loads: number[]): Drawn[] {
  return loads.flatMap((load) => {
    try {
      return [view.model.stagesAt({ ...values, load })]
    } catch {
      return []
    }
  })
}

/** The shapes at each of these evaluations; a box whose size is not a number (no pods at all) reserves nothing. */
function sized(view: View, evs: Drawn[], direction: Direction, measure: TextMeasure, widest: Widest) {
  return evs.map((ev) => {
    const s = shapes(view, ev, direction, measure, widest)
    return { nodes: s.nodes.filter((n) => Number.isFinite(n.inner.w) && Number.isFinite(n.inner.h)), edges: s.edges }
  })
}

/** The frame grown to hold these shapes too. */
function widen(frame: Frame, ...adds: Pick<Prepared, 'nodes' | 'edges'>[]): Frame {
  const nodes = new Map(frame.nodes.map((n) => [n.id, { ...n }]))
  const edges = new Map(frame.edges.map((e) => [e.id, { ...e }]))
  for (const add of adds) grow(nodes, edges, add)
  const index = (id: string) => Number(id.slice(1))
  const out = {
    direction: frame.direction,
    nodes: [...nodes.values()],
    edges: [...edges.values()].sort((a, b) => index(a.id) - index(b.id)),
  }
  return { key: JSON.stringify(out), ...out }
}

/**
 * Where each box stands along the flow. With tiers, each box in its own, a box without one in the latest tier of the
 * boxes that feed it, else the earliest of those it feeds: every layer then belongs to one tier. Without tiers, the
 * boxes nothing feeds come first, and a sink or store that feeds nothing comes last.
 */
function ordered(view: View, frame: Frame): Frame {
  const defs = view.def.nodes as Record<string, AnyNodeDef>
  const ids = frame.nodes.map((n) => n.id)
  const into = new Map(ids.map((id) => [id, [] as string[]]))
  const outOf = new Map(ids.map((id) => [id, [] as string[]]))
  for (const e of frame.edges) {
    into.get(e.to)?.push(e.from)
    outOf.get(e.from)?.push(e.to)
  }
  const tiers = Object.keys(view.def.tiers ?? {})
  const order: NonNullable<Frame['order']> = {}
  if (tiers.length) {
    const tier = new Map<string, number>()
    for (const id of ids) if (defs[id]?.tier != null) tier.set(id, tiers.indexOf(defs[id].tier))
    // whatever order the boxes come in: a box takes the latest tier of all that feed it, settled until nothing moves
    // (a tier only rises), then a box nothing settled the earliest of those it feeds (a tier only falls)
    const settle = (from: Map<string, string[]>, pick: (xs: number[]) => number) => {
      const open = ids.filter((id) => !tier.has(id))
      for (let changed = true; changed; ) {
        changed = false
        for (const id of open) {
          const known = from.get(id)!.flatMap((n) => (tier.has(n) ? [tier.get(n)!] : []))
          if (known.length && tier.get(id) !== pick(known)) {
            tier.set(id, pick(known))
            changed = true
          }
        }
      }
    }
    settle(into, (xs) => Math.max(...xs))
    settle(outOf, (xs) => Math.min(...xs))
    for (const id of ids) order[id] = tier.get(id) ?? 0
  } else {
    for (const id of ids) {
      if (!into.get(id)!.length && outOf.get(id)!.length) order[id] = 'FIRST'
      else if (!outOf.get(id)!.length && endsFlow(view, id)) order[id] = 'LAST'
    }
  }
  const out = { direction: frame.direction, nodes: frame.nodes, edges: frame.edges, order, tiers }
  return { key: JSON.stringify(out), ...out }
}

function grow(
  nodes: Map<string, Frame['nodes'][number]>,
  edges: Map<string, Frame['edges'][number]>,
  add: Pick<Prepared, 'nodes' | 'edges'>,
) {
  for (const n of add.nodes) {
    const r = nodes.get(n.id)
    if (r) {
      r.w = Math.max(r.w, n.inner.w)
      r.h = Math.max(r.h, n.inner.h)
    } else nodes.set(n.id, { id: n.id, w: n.inner.w, h: n.inner.h })
  }
  for (const e of add.edges) {
    const r = edges.get(e.id)
    if (!r) edges.set(e.id, { ...e })
    else if (e.labelW != null) r.labelW = Math.max(r.labelW ?? 0, e.labelW)
  }
}

/**
 * Labels are sized for their widest text over every load the slider can reach, so moving the load never moves the
 * layout. Text width does not grow steadily with a number ("9.9k" is wider than "10k"), hence every step, not a few.
 */
function labelWidths(view: View, values: LooseValues, measure: TextMeasure): Widest {
  const sampled = sample(view, values, measure)
  return widestOver(sampled.contexts, sampled.widths, measure)
}

/** What a phase keeps: its contexts over the load range, its labels' widths and its compact frames. */
function sample(view: View, values: LooseValues, measure: TextMeasure): Sampled {
  const { load: _, ...rest } = values
  const key = JSON.stringify(rest)
  const byView = sampleCache.get(measure) ?? new WeakMap<View, Map<string, Sampled>>()
  sampleCache.set(measure, byView)
  const byValues = byView.get(view) ?? new Map<string, Sampled>()
  byView.set(view, byValues)
  let sampled = byValues.get(key)
  if (!sampled) {
    sampled = {
      contexts: atLoads(view, values, sweep(view.model)).map((e) => e.ctx),
      widths: new Map(),
      frames: new Map(),
    }
    if (byValues.size > 32) byValues.delete(byValues.keys().next().value!)
    byValues.set(key, sampled)
  }
  return sampled
}

function widestOver(contexts: LooseValues[], widths: Sampled['widths'], measure: TextMeasure): Widest {
  const known = textWidths.get(measure) ?? new Map<string, number>()
  textWidths.set(measure, known)
  // most texts come back many times over (a label that does not follow the load, the same number at other values)
  const width = (t: string, size: number, weight: number) => {
    const key = `${size}/${weight}/${t}`
    let w = known.get(key)
    if (w == null) {
      if (known.size > 10_000) known.clear()
      w = measure(t, size, weight)
      known.set(key, w)
    }
    return w
  }
  return (l, size, weight) => {
    if (l == null) return 0
    if (typeof l === 'string') return width(l, size, weight)
    const byFont = widths.get(l) ?? new Map<string, number>()
    widths.set(l, byFont)
    const font = `${size}/${weight}`
    let w = byFont.get(font)
    if (w == null) {
      w = Math.max(0, ...[...new Set(contexts.map((ctx) => text(l, ctx)))].map((t) => width(t, size, weight)))
      byFont.set(font, w)
    }
    return w
  }
}

async function run(frame: Frame, elk?: ElkEngine): Promise<Laid> {
  const [out, into] = frame.direction === 'DOWN' ? ['SOUTH', 'NORTH'] : ['EAST', 'WEST']
  const port = (id: string, side: string) => ({ id, width: 0, height: 0, layoutOptions: { 'elk.port.side': side } })
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': frame.direction,
      'elk.edgeRouting': 'ORTHOGONAL',
      // tier headers stand in the margin before the boxes: above them running right, to their left running down
      'elk.padding': padding(frame),
      ...(frame.tiers?.length ? { 'elk.partitioning.activate': 'true' } : {}),
      'elk.spacing.nodeNode': '28',
      'elk.spacing.edgeNode': '16',
      'elk.spacing.edgeEdge': '12',
      'elk.spacing.edgeLabel': '4',
      'elk.layered.spacing.nodeNodeBetweenLayers': '48',
      'elk.layered.spacing.edgeNodeBetweenLayers': '16',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
      'elk.layered.edgeLabels.sideSelection': 'ALWAYS_UP',
    },
    children: frame.nodes.map((n) => ({
      id: n.id,
      width: n.w,
      height: n.h,
      // every edge leaves on the side the flow runs to and arrives on the other, its ends gathered at the middle
      layoutOptions: {
        'elk.portConstraints': 'FIXED_SIDE',
        'elk.portAlignment.default': 'CENTER',
        'elk.spacing.portPort': String(PORT_GAP),
        ...layerOf(frame.order?.[n.id]),
      },
      ports: frame.edges.flatMap((e) => [
        ...(e.from === n.id ? [port(`${e.id}:out`, out)] : []),
        ...(e.to === n.id ? [port(`${e.id}:in`, into)] : []),
      ]),
    })),
    edges: frame.edges.map(
      (e): ElkExtendedEdge => ({
        id: e.id,
        sources: [`${e.id}:out`],
        targets: [`${e.id}:in`],
        labels: e.labelW
          ? [
              {
                id: `${e.id}:label`,
                text: e.id,
                width: e.labelW,
                height: LABEL_H,
                layoutOptions: { 'elk.edgeLabels.placement': 'CENTER' },
              },
            ]
          : [],
      }),
    ),
  }
  const done = (await (elk ?? (await localElk())).layout(graph as ElkGraph)) as ElkNode

  const slots = new Map(
    (done.children ?? []).map((c): [string, Box] => [
      c.id,
      { x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? 0, h: c.height ?? 0 },
    ]),
  )
  const routes: Laid['routes'] = new Map()
  for (const e of (done.edges ?? []) as ElkExtendedEdge[]) {
    const points: [number, number][] = []
    for (const s of e.sections ?? []) {
      points.push([s.startPoint.x, s.startPoint.y])
      for (const b of s.bendPoints ?? []) points.push([b.x, b.y])
      points.push([s.endPoint.x, s.endPoint.y])
    }
    const l = e.labels?.[0]
    routes.set(e.id, {
      points,
      label: l ? { x: l.x ?? 0, y: l.y ?? 0, w: l.width ?? 0, h: l.height ?? 0 } : undefined,
    })
  }
  return { width: Math.ceil(done.width ?? 0), height: Math.ceil(done.height ?? 0), slots, routes }
}

function layerOf(o: number | 'FIRST' | 'LAST' | undefined): Record<string, string> {
  if (o == null) return {}
  if (typeof o === 'number') return { 'elk.partitioning.partition': String(o) }
  return { 'elk.layered.layering.layerConstraint': o }
}

/**
 * The scene at these values on a laid-out frame: each box at its own size in the middle of its slot, each edge drawn
 * at these values, its ends moved along their last straight run to the sides of the boxes as drawn.
 */
function place(prep: Prepared, laid: Laid, key: string, frame: Frame, view: View, measure: TextMeasure): Scene {
  const down = prep.direction === 'DOWN'
  const { l, tiers } = lanes(laid, frame, view, measure)
  const across = (p: [number, number]) => (down ? p[0] : p[1])
  const ends = new Map<string, number[]>()
  const end = (id: string, p: [number, number] | undefined) => {
    if (p) ends.set(id, [...(ends.get(id) ?? []), across(p)])
  }
  for (const e of prep.edges) {
    const points = l.routes.get(e.id)?.points
    end(e.from, points?.[0])
    end(e.to, points?.at(-1))
  }
  const nodes: SceneNode[] = prep.nodes.map(({ id, def, inner }) => {
    const slot = l.slots.get(id)!
    const n = offset(
      {
        id,
        kind: def.kind,
        shape: def.kind === 'node' ? def.shape : 'box',
        stages: stagesOf(def),
        component: def.kind === 'node' ? def.component : undefined,
        ...inner,
        x: 0,
        y: 0,
      },
      slot.x + (slot.w - inner.w) / 2,
      slot.y + (slot.h - inner.h) / 2,
    )
    // a box narrower across the flow than its gathered edge ends reaches out to them
    const mid = down ? slot.x + slot.w / 2 : slot.y + slot.h / 2
    const span = Math.min(
      down ? slot.w : slot.h,
      2 * Math.max(0, ...(ends.get(id) ?? []).map((c) => Math.abs(c - mid) + PORT_GAP / 2)),
    )
    if (down && span > n.w) return { ...n, x: mid - span / 2, w: span }
    // the header stays at the top, the room below the contents
    if (!down && span > n.h) return { ...offset(n, 0, mid - span / 2 - n.y), x: n.x, y: mid - span / 2, h: span }
    return n
  })
  const at = new Map(nodes.map((n) => [n.id, n]))
  const edges: SceneEdge[] = prep.edges.flatMap((e) => {
    const r = l.routes.get(e.id)
    if (!r) return []
    const points = r.points.map(([x, y]): [number, number] => [x, y])
    const a = at.get(e.from)!
    const b = at.get(e.to)!
    const first = points[0]
    const last = points.at(-1)
    if (first && last && points.length > 1) {
      if (down) {
        first[1] = a.y + a.h
        last[1] = b.y
      } else {
        first[0] = a.x + a.w
        last[0] = b.x
      }
    }
    return [{ id: e.id, from: e.from, to: e.to, points, label: r.label && { ...r.label } }]
  })
  return {
    key,
    direction: prep.direction,
    width: l.width,
    height: l.height,
    nodes,
    edges,
    stageNode: prep.stageNode,
    flowFrom: prep.flowFrom,
    tiers,
  }
}

/**
 * Each tier's lane: its band from halfway to the tier before it to halfway to the tier after, the first and last to
 * the board's edges, the whole board across the flow; its header in the margin ELK leaves before the boxes. Where a
 * name needs two lines, every header takes them: the frame moves that much across the flow, the board grows with it.
 */
function lanes(laid: Laid, frame: Frame, view: View, measure: TextMeasure): { l: Laid; tiers: SceneTier[] } {
  const ids = frame.tiers ?? []
  if (!ids.length) return { l: laid, tiers: [] }
  const down = frame.direction === 'DOWN'
  const along = (b: Box): [number, number] => (down ? [b.y, b.y + b.h] : [b.x, b.x + b.w])
  const spans = ids.map((_, i) => {
    const mine = frame.nodes.filter((n) => frame.order?.[n.id] === i).map((n) => along(laid.slots.get(n.id)!))
    return mine.length ? ([Math.min(...mine.map((s) => s[0])), Math.max(...mine.map((s) => s[1]))] as const) : null
  })
  const length = down ? laid.height : laid.width
  const named = ids.flatMap((id, i) => {
    const span = spans[i]
    if (!span) return []
    const before = spans.slice(0, i).findLast((x) => x != null)
    const after = spans.slice(i + 1).find((x) => x != null)
    const a = before ? (before[1] + span[0]) / 2 : 0
    const b = after ? (span[1] + after[0]) / 2 : length
    const def = view.def.tiers?.[id]
    const lines = wrap((def?.label ?? id).toUpperCase(), b - a - 2 * TIER_PAD, measure)
    return [
      {
        id,
        a,
        b,
        lines,
        paint: { ...(def?.fill && { fill: def.fill }), ...(def?.fillDark && { fillDark: def.fillDark }) },
      },
    ]
  })
  if (!named.length) return { l: laid, tiers: [] }
  const count = Math.max(...named.map((t) => t.lines.length))
  const head = HEAD + (count - 1) * HEAD_LINE
  const l = moved(laid, head - HEAD, down)
  const tiers = named.map(({ id, a, b, lines, paint }): SceneTier => {
    const box = down ? { x: 0, y: a, w: l.width, h: b - a } : { x: a, y: 0, w: b - a, h: l.height }
    return {
      id,
      ...box,
      head: down ? { x: 0, y: a, w: head, h: b - a } : { x: a, y: 0, w: b - a, h: head },
      // centred across the header, a capital's middle 0.35em above its baseline; at the board's outer edge, clear
      // of a limit's tag above a box and of its glow beside one
      lines: lines.map((text, k) => {
        const across = head / 2 + (k - (lines.length - 1) / 2) * HEAD_LINE + 0.35 * T_TIER.size
        return { text, ...T_TIER, ...(down ? { x: across, y: a + TIER_PAD } : { x: a + TIER_PAD, y: across }) }
      }),
      spacing: TIER_SPACING,
      vertical: down,
      ...paint,
    }
  })
  return { l, tiers }
}

/** The laid-out frame moved `d` across the flow, the board that much larger. */
function moved(l: Laid, d: number, down: boolean): Laid {
  if (!d) return l
  const [dx, dy] = down ? [d, 0] : [0, d]
  const box = (b: Box): Box => ({ ...b, x: b.x + dx, y: b.y + dy })
  return {
    width: l.width + dx,
    height: l.height + dy,
    slots: new Map([...l.slots].map(([id, b]) => [id, box(b)])),
    routes: new Map(
      [...l.routes].map(([id, r]) => [
        id,
        { points: r.points.map(([x, y]): [number, number] => [x + dx, y + dy]), label: r.label && box(r.label) },
      ]),
    ),
  }
}

/** A tier's name as drawn: in capitals, its letters spaced. */
const nameWidth = (text: string, measure: TextMeasure) =>
  measure(text, T_TIER.size, T_TIER.weight) + TIER_SPACING * text.length

/** The name on one line, or on two broken at a space; past that, each line cut short with "…". */
function wrap(name: string, room: number, measure: TextMeasure): string[] {
  const words = name.trim().split(/\s+/)
  const whole = words.join(' ')
  if (words.length < 2 || nameWidth(whole, measure) <= room) return [fit(whole, room, measure)]
  // the most words that fit the first line, or the first alone
  let n = words.length - 1
  while (n > 1 && nameWidth(words.slice(0, n).join(' '), measure) > room) n--
  const lines = [words.slice(0, n), words.slice(n)].map((w) => fit(w.join(' '), room, measure)).filter(Boolean)
  return lines.length ? lines : ['']
}

/** The text cut short with "…" to fit `room`. */
function fit(text: string, room: number, measure: TextMeasure): string {
  const cut = (n: number) => `${text.slice(0, n).trimEnd()}…`
  if (nameWidth(text, measure) <= room) return text
  // the longest start that fits, found by halves
  let [lo, hi] = [0, text.length - 1]
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (nameWidth(cut(mid), measure) <= room) lo = mid
    else hi = mid - 1
  }
  return lo > 0 ? cut(lo) : ''
}

/** The room around the boxes, and the margin before them that a tier's header takes (one line: two move the frame). */
function padding(frame: Frame): string {
  const room = frame.tiers?.length ? HEAD : 0
  const [top, left] = frame.direction === 'DOWN' ? [PADDING, PADDING + room] : [PADDING + room, PADDING]
  return `[top=${top},left=${left},bottom=${PADDING},right=${PADDING}]`
}

/** A plain box; `top` makes room for a cylinder's lid. */
function boxInner(titleW: number, subW: number, hasSub: boolean, top: number): Inner {
  const w = Math.max(110, titleW + 24, subW + 24)
  const h = (hasSub ? 48 : 36) + top
  return {
    w,
    h,
    title: { x: w / 2, y: (hasSub ? 20 : 23) + top, ...T_TITLE },
    sub: hasSub ? { x: w / 2, y: 36 + top, ...T_SUB } : undefined,
    members: [],
    groups: [],
    cells: [],
    slots: [],
  }
}

function header(titleW: number, subW: number, hasSub: boolean) {
  return { h: hasSub ? 40 : 26, minW: Math.max(titleW, subW) + 2 * PAD }
}

function clusterInner(
  def: Extract<AnyNodeDef, { kind: 'cluster' }>,
  stages: Extract<ResolvedStage, { kind: 'queue' }>[],
  ctx: LooseValues,
  direction: Direction,
  titleW: number,
  subW: number,
  measure: TextMeasure,
  view: View,
): Inner {
  const m = Math.max(1, dyn(def.members, ctx))
  const hd = header(titleW, subW, def.sub != null)
  const flowName = (f: string) => (view.def.flows as Record<string, { label?: string }>)[f]?.label ?? f
  // one group of cells per stage and flow; with several stages the stage names the group (a topic name)
  const flows = stages.flatMap((st) => {
    const parts = Object.entries(st.partitions).filter(([, n]) => n > 0)
    return parts.map(([f, n]) => ({
      stage: st.id,
      f,
      n,
      text: stages.length > 1 ? (parts.length > 1 ? `${st.label} · ${flowName(f)}` : st.label) : flowName(f),
    }))
  })
  const gridW = CELL_COLS * (CELL + CELL_GAP) - CELL_GAP
  const memberW =
    Math.max(gridW, ...flows.map((g) => measure(g.text, T_SMALL.size)), measure('member 00', T_SMALL.size)) + 2 * GAP
  const rowsOf = (n: number, k: number) => Math.ceil(Math.ceil((n - k) / m) / CELL_COLS)
  const memberH = (k: number) => 14 + flows.reduce((h, g) => h + 12 + rowsOf(g.n, k) * (CELL + CELL_GAP), 0) + 4
  const mh = Math.max(...Array.from({ length: m }, (_, k) => memberH(k)))
  const down = direction === 'DOWN'
  const innerW = down ? m * memberW + (m - 1) * GAP : memberW
  const w = Math.max(innerW + 2 * PAD, hd.minW)
  const h = hd.h + (down ? mh : m * mh + (m - 1) * GAP) + PAD
  const x0 = (w - innerW) / 2

  const members: Inner['members'] = []
  const groups: Inner['groups'] = []
  const cells: Cell[] = []
  for (let k = 0; k < m; k++) {
    const bx = down ? x0 + k * (memberW + GAP) : x0
    const by = down ? hd.h : hd.h + k * (mh + GAP)
    members.push({
      x: bx,
      y: by,
      w: memberW,
      h: mh,
      label: def.memberLabel?.(k) ?? `member ${k}`,
      spot: { x: bx + GAP, y: by + 11, ...T_SMALL },
    })
    let cy = by + 14
    for (const { stage, f, n, text } of flows) {
      groups.push({ flow: f, text, spot: { x: bx + GAP, y: cy + 9, ...T_SMALL } })
      cy += 12
      for (let i = k, j = 0; i < n; i += m, j++)
        cells.push({
          stage,
          flow: f,
          index: i,
          x: bx + GAP + (j % CELL_COLS) * (CELL + CELL_GAP),
          y: cy + Math.floor(j / CELL_COLS) * (CELL + CELL_GAP),
          w: CELL,
          h: CELL,
        })
      cy += rowsOf(n, k) * (CELL + CELL_GAP)
    }
  }
  return {
    w,
    h,
    title: { x: w / 2, y: 17, ...T_TITLE },
    sub: def.sub != null ? { x: w / 2, y: 32, ...T_SUB } : undefined,
    members,
    groups,
    cells,
    slots: [],
  }
}

function poolInner(
  def: Extract<AnyNodeDef, { kind: 'pool' }>,
  stage: Extract<ResolvedStage, { kind: 'workers' }>,
  direction: Direction,
  titleW: number,
  subW: number,
): Inner {
  const { pods, perPod } = stage
  const hd = header(titleW, subW, def.sub != null)
  const cols = Math.min(perPod, 4)
  const rows = Math.ceil(perPod / cols)
  const podW = Math.max(cols * (SLOT + SLOT_GAP) - SLOT_GAP + 2 * GAP, 44)
  const podH = 14 + rows * (SLOT + SLOT_GAP) - SLOT_GAP + GAP
  const podCols = direction === 'DOWN' ? Math.min(pods, 3) : Math.ceil(pods / 3)
  const podRows = Math.ceil(pods / podCols)
  const innerW = podCols * podW + (podCols - 1) * GAP
  const w = Math.max(innerW + 2 * PAD, hd.minW)
  const h = hd.h + podRows * podH + (podRows - 1) * GAP + PAD
  const x0 = (w - innerW) / 2

  const members: Inner['members'] = []
  const slots: Inner['slots'] = []
  for (let p = 0; p < pods; p++) {
    const bx = x0 + (p % podCols) * (podW + GAP)
    const by = hd.h + Math.floor(p / podCols) * (podH + GAP)
    members.push({
      x: bx,
      y: by,
      w: podW,
      h: podH,
      label: def.podLabel?.(p) ?? `pod ${p}`,
      spot: { x: bx + GAP, y: by + 11, ...T_SMALL },
    })
    const gx = bx + (podW - (cols * (SLOT + SLOT_GAP) - SLOT_GAP)) / 2
    for (let t = 0; t < perPod; t++)
      slots.push({
        index: p * perPod + t,
        x: gx + (t % cols) * (SLOT + SLOT_GAP),
        y: by + 14 + Math.floor(t / cols) * (SLOT + SLOT_GAP),
        w: SLOT,
        h: SLOT,
      })
  }
  return {
    w,
    h,
    title: { x: w / 2, y: 17, ...T_TITLE },
    sub: def.sub != null ? { x: w / 2, y: 32, ...T_SUB } : undefined,
    members,
    groups: [],
    cells: [],
    slots,
  }
}

function offset(n: SceneNode, dx: number, dy: number): SceneNode {
  const box = <B extends Box>(b: B): B => ({ ...b, x: b.x + dx, y: b.y + dy })
  const spot = (s: TextSpot): TextSpot => ({ ...s, x: s.x + dx, y: s.y + dy })
  return {
    ...n,
    x: dx,
    y: dy,
    title: spot(n.title),
    sub: n.sub && spot(n.sub),
    members: n.members.map((m) => ({ ...box(m), spot: spot(m.spot) })),
    groups: n.groups.map((g) => ({ ...g, spot: spot(g.spot) })),
    cells: n.cells.map(box),
    slots: n.slots.map(box),
  }
}

function stagesOf(def: AnyNodeDef): string[] {
  const st = def.stage
  return st == null ? [] : typeof st === 'string' ? [st] : [...st]
}

function visibleEdges(view: View, ctx: LooseValues): { e: EdgeDef; id: string }[] {
  return view.def.edges
    .map((e, i) => ({ e: e as EdgeDef, id: `e${i}` }))
    .filter(({ e }) => (e.when ? Boolean(e.when(ctx)) : true))
}

function text(l: Label, ctx: LooseValues): string {
  return typeof l === 'function' ? l(ctx) : l
}
