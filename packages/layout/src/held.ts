import type { Box, Direction, Frame, Held, Laid } from './layout'
import type { View } from './view'

/**
 * A layout held to a drawn scene (`LayoutOptions.from`): what an editor asks for after an edit, so the boxes the edit
 * did not touch stay where they are drawn. A chunk of its own, loaded with the first held layout: a page never asks.
 */

/** Where the boxes of a drawn scene are, each by its middle: what a held layout starts from. */
export interface Places {
  key: string
  at: Map<string, [number, number]>
  /** Each drawn edge label's middle, under its edge's ends (`edgeKey`): an edge's number changes when one is written above it. */
  labels: Map<string, [number, number]>
  /** How ELK is told of them for this frame; null when the frame has none of the boxes, and is laid out as ever. */
  plan(frame: Frame, kit: Kit): Plan | null
}

/** What the graph builder (`run` in layout.ts) lends: its ports, its sides and its sizes. */
export interface Kit {
  labelH: number
  into: string
  out: string
  port(id: string, side: string): unknown
  layerOf(o: number | 'FIRST' | 'LAST' | undefined): Record<string, string>
}

type Edge = Frame['edges'][number]
type GraphNode = Record<string, unknown>
type GraphEdge = { id: string; sources: string[]; targets: string[] }

/** A frame's graph held to its places: the strategies, each box's place, and the labels as boxes of their own. */
export interface Plan {
  options: Record<string, string>
  /** A box's corner, for the boxes that have a place. */
  at(n: Frame['nodes'][number]): { x: number; y: number } | undefined
  labelBoxes: GraphNode[]
  /** An edge with a label, in two halves through its label's box; null for an edge without one. */
  halves(e: Edge): GraphEdge[] | null
  /** After ELK: an edge in two halves is one edge again, its label in its box. */
  join(routes: Laid['routes'], slots: Map<string, Box>): void
}

/**
 * ELK's interactive strategies, all four: it reads each box's layer, its order in the layer and its place from where
 * the box is put. With fewer of them (the layers and the order alone) the placement balances the whole diagram again
 * and most boxes move.
 */
const HELD = {
  'elk.layered.cycleBreaking.strategy': 'INTERACTIVE',
  'elk.layered.layering.strategy': 'INTERACTIVE',
  'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
  'elk.layered.nodePlacement.strategy': 'INTERACTIVE',
  // a box nothing ties to the rest is laid out with them, where it is put: on its own ELK packs it before the others
  // and moves them all
  'elk.separateConnectedComponents': 'false',
}
const LABEL_GAP = 4

/** Each edge under its two ends, the second between the same two boxes apart from the first. */
function edgeKeys<E extends { from: string; to: string }>(edges: readonly E[]): Map<E, string> {
  const seen = new Map<string, number>()
  return new Map(
    edges.map((e) => {
      const pair = `${e.from}>${e.to}`
      const n = seen.get(pair) ?? 0
      seen.set(pair, n + 1)
      return [e, `${pair}#${n}`]
    }),
  )
}

/**
 * The places a layout holds on to; null where it lays out as ever: no scene, one that runs the other way or was
 * folded into rows (its rows share their layers' places), a layout folded into rows, a view with subsystems.
 */
export function heldBy(view: View, from: Held | undefined, direction: Direction, rows: number): Places | null {
  if (!from || from.direction !== direction || rows > 1 || (from.rows ?? 1) > 1) return null
  if (Object.keys(view.def.subsystems ?? {}).length) return null
  const ids = view.def.nodes as Record<string, unknown>
  // a box no edge reached was put anywhere: it is placed by its first edge, as a new box is
  const tied = from.edges && new Set(from.edges.flatMap((e) => [e.from, e.to]))
  const at = new Map<string, [number, number]>()
  // whole pixels: a place a morph left a hair off is the same place
  for (const n of from.nodes)
    if (Object.hasOwn(ids, n.id) && (!tied || tied.has(n.id) || from.nodes.length === 1))
      at.set(n.id, [Math.round(n.x + n.w / 2), Math.round(n.y + n.h / 2)])
  if (!at.size) return null
  const labels = new Map<string, [number, number]>()
  for (const [e, k] of edgeKeys(from.edges ?? []))
    if (e.label && at.has(e.from) && at.has(e.to))
      labels.set(k, [Math.round(e.label.x + e.label.w / 2), Math.round(e.label.y + e.label.h / 2)])
  const places: Places = {
    key: JSON.stringify([[...at], [...labels]]),
    at,
    labels,
    plan: (frame, kit) => planOf(frame, places, kit),
  }
  return places
}

function planOf(frame: Frame, held: Places, kit: Kit): Plan | null {
  const down = frame.direction === 'DOWN'
  const size = new Map(frame.nodes.map((n) => [n.id, n]))
  const drawn = frame.nodes.filter((n) => held.at.has(n.id))
  if (!drawn.length) return null
  // from the board's corner: ELK keeps the places and adds its own margins, which the drawn ones already had, so
  // without this every held layout would stand that much further in and the board grow with each edit
  const left = Math.min(...drawn.map((n) => held.at.get(n.id)![0] - n.w / 2))
  const top = Math.min(...drawn.map((n) => held.at.get(n.id)![1] - n.h / 2))
  const at = new Map(drawn.map((n) => [n.id, held.at.get(n.id)!] as const))
  // a new box beside the first placed box an edge ties it to: after the one that feeds it, before the one it feeds,
  // a row further. Round by round, so a chain of new boxes follows its first
  for (let placed = true; placed; ) {
    placed = false
    for (const n of frame.nodes) {
      if (at.has(n.id)) continue
      const e = frame.edges.find((x) => (x.from === n.id && at.has(x.to)) || (x.to === n.id && at.has(x.from)))
      if (!e) continue
      const near = e.to === n.id ? e.from : e.to
      const [x, y] = at.get(near)!
      const by = size.get(near)!
      const step = e.to === n.id ? 1 : -1
      const along = step * ((down ? by.h + n.h : by.w + n.w) / 2 + 48)
      const across = (down ? by.w + n.w : by.h + n.h) / 2 + 28
      at.set(n.id, down ? [x + across, y + along] : [x + along, y + across])
      placed = true
    }
  }
  // a box nothing ties to the rest stands past them across the flow, not on the first box
  const far = Math.max(...drawn.map((n) => held.at.get(n.id)![down ? 0 : 1] + (down ? n.w : n.h) / 2))
  for (const n of frame.nodes)
    if (!at.has(n.id)) at.set(n.id, down ? [far + 28 + n.w / 2, top + n.h / 2] : [left + n.w / 2, far + 28 + n.h / 2])

  // a label is a box of its own in the graph, with its edge in two halves through it: the interactive strategies read
  // a box's place, and know nothing of where a label was (ELK's own label node goes to the first row, and the edge
  // with it). The box holds the label's layer, so the boxes after it keep their distance. The line passes its middle,
  // the label over it (beside it, running down)
  const keys = edgeKeys(frame.edges)
  const labelled = frame.edges.filter((e) => e.labelW)
  const boxOf = (e: Edge) =>
    down ? { w: 2 * (e.labelW! + LABEL_GAP), h: kit.labelH } : { w: e.labelW!, h: 2 * (kit.labelH + LABEL_GAP) }
  const labelBoxes = labelled.map((e): GraphNode => {
    const { w, h } = boxOf(e)
    const was = held.labels.get(keys.get(e)!)
    const [a, b] = [at.get(e.from)!, at.get(e.to)!]
    // where it is drawn, its middle half a label and the gap off the line; a new one halfway between its ends
    const mid = was
      ? down
        ? [was[0] - e.labelW! / 2 - LABEL_GAP, was[1]]
        : [was[0], was[1] + kit.labelH / 2 + LABEL_GAP]
      : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const tier = frame.order?.[e.from]
    return {
      id: `${e.id}:label`,
      width: w,
      height: h,
      x: mid[0]! - left - w / 2,
      y: mid[1]! - top - h / 2,
      layoutOptions: {
        'elk.portConstraints': 'FIXED_SIDE',
        'elk.portAlignment.default': 'CENTER',
        ...(typeof tier === 'number' ? kit.layerOf(tier) : {}),
      },
      ports: [kit.port(`${e.id}:label:in`, kit.into), kit.port(`${e.id}:label:out`, kit.out)],
    }
  })
  return {
    options: HELD,
    at: (n) => {
      const p = at.get(n.id)
      return p && { x: p[0] - left - n.w / 2, y: p[1] - top - n.h / 2 }
    },
    labelBoxes,
    halves: (e) =>
      e.labelW
        ? [
            { id: `${e.id}:a`, sources: [`${e.id}:out`], targets: [`${e.id}:label:in`] },
            { id: `${e.id}:b`, sources: [`${e.id}:label:out`], targets: [`${e.id}:in`] },
          ]
        : null,
    join: (routes, slots) => {
      for (const e of labelled) {
        const [a, b, box] = [routes.get(`${e.id}:a`), routes.get(`${e.id}:b`), slots.get(`${e.id}:label`)]
        routes.delete(`${e.id}:a`)
        routes.delete(`${e.id}:b`)
        slots.delete(`${e.id}:label`)
        if (!a || !b || !box) continue
        const label: Box = down
          ? { x: box.x + box.w / 2 + LABEL_GAP, y: box.y, w: e.labelW!, h: kit.labelH }
          : { x: box.x, y: box.y, w: e.labelW!, h: kit.labelH }
        routes.set(e.id, { points: [...a.points, ...b.points], label })
      }
    },
  }
}
