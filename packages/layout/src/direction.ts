import type { Direction } from './layout'
import type { AnyNodeDef, View } from './view'

const shaped = new WeakMap<View, Direction>()

/**
 * Which way a view runs where there is room: right when its longest chain of boxes is at least as long as its widest
 * layer has boxes side by side, else down (a wide fan-out). Every edge counts, whatever its `when`, so neither the load
 * nor a phase turns it.
 */
export function directionOf(view: View): Direction {
  let d = shaped.get(view)
  if (!d) {
    d = fromShape(view)
    shaped.set(view, d)
  }
  return d
}

/** A sink or store: without tiers, one that feeds nothing stands in the last layer. */
export function endsFlow(view: View, id: string): boolean {
  const def = (view.def.nodes as Record<string, AnyNodeDef>)[id]
  const st = def?.stage == null ? [] : typeof def.stage === 'string' ? [def.stage] : [...def.stage]
  const stages = view.model.def.stages as Record<string, { kind: string } | undefined>
  return st.length > 0 && st.every((s) => stages[s]?.kind === 'sink' || stages[s]?.kind === 'store')
}

function fromShape(view: View): Direction {
  const next = new Map<string, string[]>()
  const fed = new Set<string>()
  for (const e of view.def.edges)
    if (e.from !== e.to) {
      next.set(e.from, [...(next.get(e.from) ?? []), e.to])
      next.set(e.to, next.get(e.to) ?? [])
      fed.add(e.to)
    }
  // a box with no edge is packed beside the rest, never in one of its layers
  const ids = Object.keys(view.def.nodes).filter((id) => next.has(id))
  // the layers are counted as ELK draws them: a loop is cut where the flow comes back, so the search starts from the
  // boxes nothing feeds; each box then stands one after the longest chain before it
  const order: string[] = []
  const open = new Set<string>()
  const done = new Set<string>()
  const forward = new Map(ids.map((id) => [id, [] as string[]]))
  const walk = (id: string) => {
    open.add(id)
    for (const to of next.get(id)!)
      if (!open.has(to)) {
        forward.get(id)!.push(to)
        if (!done.has(to)) walk(to)
      }
    open.delete(id)
    done.add(id)
    order.push(id)
  }
  for (const id of [...ids.filter((id) => !fed.has(id)), ...ids]) if (!done.has(id)) walk(id)
  const layer = new Map(ids.map((id) => [id, 0]))
  for (const id of order.reverse())
    for (const to of forward.get(id)!) layer.set(to, Math.max(layer.get(to)!, layer.get(id)! + 1))
  // without tiers, a sink or store that feeds nothing is held to the last layer (see `ordered` in layout.ts)
  const last = Math.max(0, ...layer.values())
  if (!Object.keys(view.def.tiers ?? {}).length)
    for (const id of ids) if (!next.get(id)!.length && endsFlow(view, id)) layer.set(id, last)
  const sizes = new Map<number, number>()
  for (const l of layer.values()) sizes.set(l, (sizes.get(l) ?? 0) + 1)
  return sizes.size >= Math.max(0, ...sizes.values()) ? 'RIGHT' : 'DOWN'
}

/** The room a diagram is drawn in, in pixels. */
export interface Room {
  w: number
  h: number
}

/** A way to arrange a diagram: the way it runs and the rows it is folded into (1: one row). */
export interface Arrangement {
  direction: Direction
  rows: number
}

/** How large an arrangement lays a view out (`extent`). */
export interface Sized extends Arrangement {
  width: number
  height: number
}

/** How much better another arrangement must fit before the diagram changes: a drag near the edge changes nothing. */
const TURN = 1.15
/** The scale under which a box's title is no longer read with ease: 10 px of its 13. Only then is a diagram folded. */
const LEGIBLE = 10 / 13

/**
 * How a diagram is arranged in a room, among the arrangements it may take (`sizes`: one direction or both, one row
 * count or several). It stays as it stands (`keep`: as it is now, or as its shape runs) unless another fits the room
 * clearly larger, and no scale past full size counts: a diagram that reads well does not change to be drawn larger
 * still. It is folded only where its titles would be hard to read in one row, and then into the fewest rows that fit
 * about as large as the best.
 */
export function arrangementFor(sizes: readonly Sized[], room: Room, keep: Arrangement): Arrangement {
  const fit = (s: Sized) => Math.min(room.w / s.width, room.h / s.height, 1)
  const out = ({ direction, rows }: Arrangement): Arrangement => ({ direction, rows })
  const fewest = Math.min(...sizes.map((s) => s.rows))
  const flat = sizes.filter((s) => s.rows === fewest)
  const first = flat.find((s) => s.direction === keep.direction) ?? flat[0]
  if (!first) return out(keep)
  // in one row: the way it runs unless the other fits clearly larger
  const plain = flat.reduce((b, s) => (fit(s) > fit(b) * TURN ? s : b), first)
  const kept = sizes.find((s) => s.direction === keep.direction && s.rows === keep.rows)
  // a folded diagram unfolds only once one row reads with ease by the same margin
  if (fit(plain) >= LEGIBLE * (kept && kept.rows > plain.rows ? TURN : 1)) return out(plain)
  const stands = kept ?? plain
  const best = sizes.reduce((b, s) => (fit(s) > fit(b) ? s : b), stands)
  if (fit(best) <= fit(stands) * TURN) return out(stands)
  const near = sizes.filter((s) => fit(s) * TURN >= fit(best))
  const turned = (s: Sized) => (s.direction === stands.direction ? 0 : 1)
  return out(near.reduce((b, s) => ((s.rows - b.rows || turned(s) - turned(b) || fit(b) - fit(s)) < 0 ? s : b)))
}
