import { dyn, type Evaluation, type LooseValues, type ResolvedStage } from '@loadmap/core'
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api'
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
  /** Changes only when something that moves the layout changes; the load alone never does. */
  key: string
  direction: Direction
  width: number
  height: number
  nodes: SceneNode[]
  edges: SceneEdge[]
  /** The node that shows each stage, and the node each flow starts from. */
  stageNode: Readonly<Record<string, string>>
  flowFrom: Readonly<Record<string, string>>
}

export interface LayoutOptions {
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
const PAD = 8
const GAP = 6
const CELL = 9
const CELL_GAP = 2
const CELL_COLS = 6
const SLOT = 10
const SLOT_GAP = 3
const LABEL_H = 16

const scenes = new WeakMap<View, Map<string, Promise<Scene>>>()
// per measurer and view, per combination of values other than the load: the contexts labels are sized against
const sampleCache = new WeakMap<TextMeasure, WeakMap<View, Map<string, Sampled>>>()

interface Sampled {
  contexts: LooseValues[]
  widths: Map<Label, Map<string, number>>
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
 * routes the edges and places the edge labels so that none overlaps another or a node. Results are cached by the
 * structure, so a call after a load change returns the same scene.
 */
export function layout(view: View, ev: Evaluation, o: LayoutOptions = {}): Promise<Scene> {
  const direction = o.direction ?? 'RIGHT'
  const measure = o.measure ?? estimateText
  const prep = prepare(view, ev, direction, measure)
  const cache = scenes.get(view) ?? new Map<string, Promise<Scene>>()
  scenes.set(view, cache)
  let hit = cache.get(prep.key)
  if (!hit) {
    hit = run(prep, o.elk).catch((err) => {
      cache.delete(prep.key)
      throw err
    })
    if (cache.size > 32) cache.delete(cache.keys().next().value!)
    cache.set(prep.key, hit)
  }
  return hit
}

/** The structure key for the current values: equal keys give equal scenes. */
export function structureKey(view: View, ev: Evaluation, o: LayoutOptions = {}): string {
  return prepare(view, ev, o.direction ?? 'RIGHT', o.measure ?? estimateText).key
}

/**
 * Each box's shape at these values, by id, and the edges drawn: two calls tell which boxes a change of values reshapes
 * (pods, brokers, a wider label) and which edges come or go, before anything is laid out.
 */
export function shapesOf(view: View, ev: Evaluation, o: LayoutOptions = {}) {
  const prep = prepare(view, ev, o.direction ?? 'RIGHT', o.measure ?? estimateText)
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
  const widest = labelWidths(view, ev, measure)

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
  const flowFrom: Record<string, string> = {}
  for (const [f, fv] of Object.entries(view.def.flows) as [string, { from: string }][]) flowFrom[f] = fv.from
  // everything the scene is built from, so two different structures never share a scene
  const key = JSON.stringify({ direction, nodes: nodes.map((n) => [n.id, n.def.kind, n.inner]), edges, flowFrom })
  return { key, direction, nodes, edges, stageNode, flowFrom }
}

/**
 * Labels are sized for their widest text over every load the slider can reach, so moving the load never moves the
 * layout. Text width does not grow steadily with a number ("9.9k" is wider than "10k"), hence every step, not a few.
 */
function labelWidths(view: View, ev: Evaluation, measure: TextMeasure) {
  const { load: _, ...rest } = ev.values
  const key = JSON.stringify(rest)
  const byView = sampleCache.get(measure) ?? new WeakMap<View, Map<string, Sampled>>()
  sampleCache.set(measure, byView)
  const byValues = byView.get(view) ?? new Map<string, Sampled>()
  byView.set(view, byValues)
  let sampled = byValues.get(key)
  if (!sampled) {
    const { min, max, step } = view.model.load
    const n = Math.floor((max - min) / step)
    const loads =
      n <= 400
        ? [...Array.from({ length: n + 1 }, (_, i) => min + i * step), max]
        : Array.from({ length: 401 }, (_, i) => min + ((max - min) * i) / 400)
    sampled = { contexts: loads.map((load) => view.model.evaluate({ ...ev.values, load }).ctx), widths: new Map() }
    if (byValues.size > 32) byValues.delete(byValues.keys().next().value!)
    byValues.set(key, sampled)
  }
  const { contexts, widths } = sampled
  return (l: Label | undefined, size: number, weight: number) => {
    if (l == null) return 0
    if (typeof l === 'string') return measure(l, size, weight)
    const byFont = widths.get(l) ?? new Map<string, number>()
    widths.set(l, byFont)
    const font = `${size}/${weight}`
    let w = byFont.get(font)
    if (w == null) {
      w = Math.max(...contexts.map((ctx) => measure(text(l, ctx), size, weight)))
      byFont.set(font, w)
    }
    return w
  }
}

async function run(prep: Prepared, elk?: ElkEngine): Promise<Scene> {
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': prep.direction,
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.padding': '[top=16,left=16,bottom=16,right=16]',
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
    children: prep.nodes.map((n) => ({ id: n.id, width: n.inner.w, height: n.inner.h })),
    edges: prep.edges.map(
      (e): ElkExtendedEdge => ({
        id: e.id,
        sources: [e.from],
        targets: [e.to],
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
  const out = (await (elk ?? (await localElk())).layout(graph as ElkGraph)) as ElkNode

  const placed = new Map((out.children ?? []).map((c) => [c.id, c]))
  const nodes: SceneNode[] = prep.nodes.map(({ id, def, inner }) => {
    const c = placed.get(id)!
    return offset(
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
      c.x ?? 0,
      c.y ?? 0,
    )
  })
  const edges: SceneEdge[] = ((out.edges ?? []) as ElkExtendedEdge[]).map((e) => {
    const p = prep.edges.find((x) => x.id === e.id)!
    const points: [number, number][] = []
    for (const s of e.sections ?? []) {
      points.push([s.startPoint.x, s.startPoint.y])
      for (const b of s.bendPoints ?? []) points.push([b.x, b.y])
      points.push([s.endPoint.x, s.endPoint.y])
    }
    const l = e.labels?.[0]
    return {
      id: e.id,
      from: p.from,
      to: p.to,
      points,
      label: l ? { x: l.x ?? 0, y: l.y ?? 0, w: l.width ?? 0, h: l.height ?? 0 } : undefined,
    }
  })
  return {
    key: prep.key,
    direction: prep.direction,
    width: Math.ceil(out.width ?? 0),
    height: Math.ceil(out.height ?? 0),
    nodes,
    edges,
    stageNode: prep.stageNode,
    flowFrom: prep.flowFrom,
  }
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
