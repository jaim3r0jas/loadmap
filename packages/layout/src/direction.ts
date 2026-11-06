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
