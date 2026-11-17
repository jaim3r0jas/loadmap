import type { Frame, Laid, SceneSubsystem } from './layout'
import type { TextMeasure } from './text'
import type { View } from './view'

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
      const minW = Math.ceil(measure(defs[id]!.label, T_FRAME.size, T_FRAME.weight)) + 2 * FRAME_PAD
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
