import type { LooseValues } from '@loadmap/core'
import { pct } from '@loadmap/core/format'
import type { Frame, Laid, SceneSubsystem } from './layout'
import type { TextMeasure } from './text'
import type { AnyNodeDef, EdgeDef, FlowView, View } from './view'

// Nothing here is imported from the layout but types, as in fold.ts: a page loads this file with the first diagram that
// has a subsystem, and a page without one never does.

/** A subsystem's name, the room it takes above the boxes, and the room around them. */
const T_FRAME = { size: 11.5, weight: 600 }
const FRAME_HEAD = 28
const FRAME_PAD = 12

/**
 * A subsystem's frame among the slots, under a key no box has: whatever moves the slots (the lanes, the fold) moves the
 * frames with them.
 */
const frameKey = (id: string) => `\nsubsystem ${id}`

/**
 * The subsystems that get a frame, and each box's: one that holds a box, and with tiers one whose boxes all stand in
 * one tier (a lane runs the whole board across the flow, so a frame cannot cross one). A subsystem that is not framed
 * leaves the ones in it to be framed on their own.
 */
export function framed(
  view: View,
  ids: string[],
  order: NonNullable<Frame['order']>,
  tiered: boolean,
  measure: TextMeasure,
): Pick<Frame, 'subsystems' | 'within' | 'outer'> {
  const defs = view.def.subsystems ?? {}
  // the subsystem a box or a subsystem stands in, by its name: the longest `<id>.` it starts with
  const up = (id: string): string | undefined => {
    for (let dot = id.lastIndexOf('.'); dot > 0; dot = id.lastIndexOf('.', dot - 1))
      if (Object.hasOwn(defs, id.slice(0, dot))) return id.slice(0, dot)
    return undefined
  }
  // the subsystems around it, the outermost first
  const chain = (id: string): string[] => {
    const out: string[] = []
    for (let s = up(id); s != null; s = up(s)) out.unshift(s)
    return out
  }
  const boxes = new Map<string, string[]>()
  for (const id of ids) for (const s of chain(id)) boxes.set(s, [...(boxes.get(s) ?? []), id])
  const drawn = new Set(
    [...boxes].flatMap(([s, inside]) => (!tiered || new Set(inside.map((id) => order[id])).size === 1 ? [s] : [])),
  )
  if (!drawn.size) return {}
  const innermost = (among: string[]) => among.findLast((s) => drawn.has(s))
  const subsystems = [...drawn]
    .sort((a, b) => chain(a).length - chain(b).length || (a < b ? -1 : 1))
    .map((id) => {
      const around = innermost(chain(id))
      // with the mark the board draws before it (frames.tsx)
      const minW = Math.ceil(measure(`\u25BE ${defs[id]!.label}`, T_FRAME.size, T_FRAME.weight)) + 2 * FRAME_PAD
      return { id, ...(around != null ? { in: around } : {}), minW }
    })
  const within: Record<string, string> = {}
  const outer: Record<string, string> = {}
  for (const id of ids) {
    const mine = chain(id).filter((s) => drawn.has(s))
    if (mine.length) {
      within[id] = mine.at(-1)!
      outer[id] = frameKey(mine[0]!)
    }
  }
  return { subsystems, within, outer }
}

/** Frames in frames are laid out as one graph, and every place comes back measured from the board's corner. */
export const NESTED = {
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.json.shapeCoords': 'ROOT',
  'elk.json.edgeCoords': 'ROOT',
}

/**
 * The board's boxes and frames as ELK reads them, frames in frames: a frame stands among the boxes where its first box
 * would, takes the tier of its boxes on the board itself, and is never shorter than its name along it. `box` makes a box's
 * node, `layered` is what the board is laid out with, `layerOf` the options that hold a box in its tier.
 */
export function nest(
  frame: Frame,
  box: (n: Frame['nodes'][number], top: boolean) => object,
  layered: Record<string, string>,
  layerOf: (o: number | 'FIRST' | 'LAST' | undefined) => Record<string, string>,
): object[] {
  const subsystems = frame.subsystems ?? []
  const down = frame.direction === 'DOWN'
  const first = new Map<string, number>()
  frame.nodes.forEach((n, i) => {
    for (let s = frame.within?.[n.id]; s != null; s = subsystems.find((x) => x.id === s)?.in)
      if (!first.has(s)) first.set(s, i)
  })
  const inside = (parent: string | undefined): object[] =>
    [
      ...frame.nodes.flatMap((n, i) =>
        frame.within?.[n.id] === parent ? [{ at: i, node: box(n, parent == null) }] : [],
      ),
      ...subsystems.flatMap((s) => {
        const at = first.get(s.id)
        if (s.in !== parent || at == null) return []
        const tier = frame.order?.[frame.nodes[at]!.id]
        return [
          {
            at,
            node: {
              id: frameKey(s.id),
              layoutOptions: {
                ...layered,
                // its name stands clear of the edges that come in: above its boxes running right, up its left side
                // running down, as a tier's does
                'elk.padding': down
                  ? `[top=${FRAME_PAD},left=${FRAME_HEAD},bottom=${FRAME_PAD},right=${FRAME_PAD}]`
                  : `[top=${FRAME_HEAD},left=${FRAME_PAD},bottom=${FRAME_PAD},right=${FRAME_PAD}]`,
                'elk.nodeSize.constraints': 'MINIMUM_SIZE',
                'elk.nodeSize.minimum': down ? `(0,${s.minW})` : `(${s.minW},0)`,
                ...(parent == null && typeof tier === 'number' ? layerOf(tier) : {}),
              },
              children: inside(s.id),
            },
          },
        ]
      }),
    ]
      .sort((a, b) => a.at - b.at)
      .map((x) => x.node)
  return inside(undefined)
}

/** Each framed subsystem as it stands on the board: its frame, its name at the frame's top, the boxes inside. */
export function framesOf(l: Laid, view: View, frame: Frame): SceneSubsystem[] {
  const all = frame.subsystems ?? []
  const up = new Map(all.map((s) => [s.id, s.in]))
  const down = frame.direction === 'DOWN'
  const holds = (id: string, box: string) => {
    for (let s = frame.within?.[box]; s != null; s = up.get(s)) if (s === id) return true
    return false
  }
  return all.flatMap((s) => {
    const b = l.slots.get(frameKey(s.id))
    if (!b) return []
    let depth = 0
    for (let p = s.in; p != null; p = up.get(p)) depth++
    return [
      {
        id: s.id,
        ...(s.in != null ? { in: s.in } : {}),
        depth,
        label: view.def.subsystems?.[s.id]?.label ?? s.id,
        ...b,
        title: down ? { x: b.x + 18, y: b.y + FRAME_PAD, ...T_FRAME } : { x: b.x + FRAME_PAD, y: b.y + 18, ...T_FRAME },
        vertical: down,
        nodes: frame.nodes.flatMap((n) => (holds(s.id, n.id) ? [n.id] : [])),
      },
    ]
  })
}

/**
 * The frames a share of the way from one scene to the next: one that stays moves `k` of the way, one that is new is
 * `enter` there, one that goes is `out` of what it was.
 */
export function morph(
  from: SceneSubsystem[],
  to: SceneSubsystem[],
  k: number,
  enter: number,
  out: number,
): SceneSubsystem[] {
  const lerp = (a: number, b: number) => a + (b - a) * k
  return [
    ...to.map((s) => {
      const a = from.find((x) => x.id === s.id)
      if (!a) return { ...s, fade: enter }
      const title = { ...s.title, x: lerp(a.title.x, s.title.x), y: lerp(a.title.y, s.title.y) }
      return { ...s, x: lerp(a.x, s.x), y: lerp(a.y, s.y), w: lerp(a.w, s.w), h: lerp(a.h, s.h), title }
    }),
    ...from.filter((s) => !to.some((x) => x.id === s.id)).map((s) => ({ ...s, fade: (s.fade ?? 1) * out })),
  ]
}

const closedViews = new WeakMap<View, Map<string, View>>()

/**
 * The view with these subsystems closed: each drawn as one box that stands for everything inside it, a subsystem in a
 * closed one closed with it. The box shows every stage inside (dots pass through it, a limit inside is its limit), its
 * second line names the busiest component inside, and the edges that ended at a box inside end at it. An edge keeps
 * its place in the list, so it is the same edge open and closed; one that ran inside is never drawn. The same view
 * comes back for the same subsystems, and `view` itself when none of them is one of its own.
 */
export function closedView(view: View, closed: readonly string[]): View {
  const defs = view.def.subsystems ?? {}
  const known = [...new Set(closed)].filter((id) => Object.hasOwn(defs, id)).sort()
  // the outermost: one in a closed one is closed with it
  const ids = known.filter((id) => !known.some((o) => id.startsWith(`${o}.`)))
  if (!ids.length) return view
  const byKey = closedViews.get(view) ?? new Map<string, View>()
  closedViews.set(view, byKey)
  const key = ids.join('\n')
  const hit = byKey.get(key)
  if (hit) return hit

  const into = (id: string) => ids.find((c) => id.startsWith(`${c}.`))
  const stageDefs = view.model.def.stages as Record<string, { component?: string }>
  const names = view.model.def.components as Record<string, { name: string }>
  const nodes: Record<string, AnyNodeDef> = {}
  const held = new Map<string, { stages: string[]; tiers: Set<string | undefined> }>()
  for (const [id, n] of Object.entries(view.def.nodes as Record<string, AnyNodeDef>)) {
    const c = into(id)
    if (c == null) {
      nodes[id] = n
      continue
    }
    let h = held.get(c)
    if (!h) {
      h = { stages: [], tiers: new Set() }
      held.set(c, h)
      // where its first box stood
      nodes[c] = n
    }
    h.stages.push(...(n.stage == null ? [] : typeof n.stage === 'string' ? [n.stage] : n.stage))
    h.tiers.add(n.tier)
  }
  for (const [c, h] of held) {
    const [tier] = h.tiers
    const components = [...new Set(h.stages.flatMap((s) => stageDefs[s]?.component ?? []))]
    nodes[c] = {
      kind: 'node',
      shape: 'box',
      // the mark a closed folder wears: a click opens it
      label: `\u25B8 ${defs[c]!.label}`,
      // the busiest component inside, by name
      sub: (ctx) => {
        const util = ctx.util as Record<string, number | null>
        const worst = components.reduce<string | undefined>(
          (a, b) => (util[b] != null && (a == null || util[b] > util[a]!) ? b : a),
          undefined,
        )
        if (worst == null) return ''
        if (!util[worst]) return 'no traffic'
        // "EU region › Workers" reads "Workers" in the box that is the EU region
        const name = names[worst]?.name ?? worst
        const own = `${defs[c]!.label} › `
        return `${name.startsWith(own) ? name.slice(own.length) : name} ${pct(util[worst]!)}`
      },
      stage: h.stages,
      subsystem: c,
      // the tier its boxes share; one across several tiers stands where what feeds it does
      ...(h.tiers.size === 1 && tier != null ? { tier } : {}),
    }
  }
  // the edges that come to run between the same two boxes are one: drawn where any of them is, under the first's
  // place and label. One that ran inside the box is never drawn
  const all = view.def.edges as readonly EdgeDef[]
  const ends = (e: EdgeDef) => [into(e.from) ?? e.from, into(e.to) ?? e.to] as const
  const pair = (e: EdgeDef) => ends(e).join('\n')
  const first = new Map<string, EdgeDef>()
  const edges = all.map((e) => {
    const [from, to] = ends(e)
    if (from === e.from && to === e.to) return e
    if (from === to || first.has(pair(e))) return { ...e, from, to, when: () => false }
    first.set(pair(e), e)
    const same = all.filter((x) => pair(x) === pair(e))
    return { ...e, from, to, when: (ctx: LooseValues) => same.some((x) => !x.when || x.when(ctx)) }
  })
  const flows = Object.fromEntries(
    Object.entries(view.def.flows as Record<string, FlowView>).map(([f, fv]) => [
      f,
      { ...fv, from: into(fv.from) ?? fv.from },
    ]),
  )
  const subsystems = Object.fromEntries(Object.entries(defs).filter(([id]) => !ids.includes(id) && into(id) == null))
  const out: View = { model: view.model, def: { ...view.def, nodes, edges, flows, subsystems } }
  byKey.set(key, out)
  return out
}
