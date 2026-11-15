import type { DrainReason, SplitBranch, StageDef } from './stages'

/** What `lossesOf` and the drain checks read of a model definition: its stages, routes and flows' rules. */
interface Shape {
  stages: Readonly<Record<string, StageDef>>
  routes: Readonly<Record<string, readonly string[]>>
  flows: Readonly<Record<string, { overload?: unknown; timeout?: unknown }>>
}

/**
 * The ways a flow goes, as far as they are known without the values: its route, and each way of a split whose `to` is
 * fixed. `open` is true when a split works its ways out from the values, so they could lead anywhere.
 */
export function waysOf(def: Shape, f: string): { ways: string[][]; open: boolean } {
  const route = def.routes[f] ?? []
  const ways: string[][] = [[...route]]
  let open = false
  for (const s of route) {
    const st = def.stages[s]
    if (st?.kind !== 'split') continue
    if (typeof st.to === 'function') {
      open = true
      continue
    }
    for (const b of Array.isArray(st.to) ? st.to : ((st.to as Record<string, readonly SplitBranch[]>)[f] ?? []))
      ways.push([...b.stages])
  }
  return { ways, open }
}

/**
 * The losses a stage can have, so a drain may take them: a pass, limit, cache or split turns units away past capacity;
 * a queue drops what is too old for a flow with a drop rule; the last stage of a way times out what is too slow for a
 * flow with a timeout. A rule worked out from the values counts as there.
 */
export function lossesOf(def: Shape, stage: string): DrainReason[] {
  const st = def.stages[stage]
  if (!st) return []
  const out: DrainReason[] = []
  const flows = Object.keys(def.flows)
  const known = new Map(flows.map((f) => [f, waysOf(def, f)]))
  // a stage reached only as a fan-out's copy is on no way: what it turns away is a copy, not a unit
  const on = (f: string) => known.get(f)!.open || known.get(f)!.ways.some((w) => w.includes(stage))
  const passes = flows.some(on)
  if (passes && (st.kind === 'pass' || st.kind === 'limit' || st.kind === 'cache' || st.kind === 'split'))
    out.push('rejected')
  // a queue drops what its reader cannot drain: a stage after it with a component
  const read = (w: readonly string[]) => {
    const next = def.stages[w[w.indexOf(stage) + 1] ?? '']
    return next != null && 'component' in next && next.component != null
  }
  if (st.kind === 'queue')
    for (const f of flows) {
      const o = def.flows[f]!.overload
      const drops = typeof o === 'function' || (o as { drop?: unknown } | undefined)?.drop != null
      const { ways, open } = known.get(f)!
      if (drops && (open || ways.some((w) => w.includes(stage) && read(w)))) {
        out.push('dropped')
        break
      }
    }
  for (const f of flows) {
    if (def.flows[f]!.timeout == null) continue
    const { ways, open } = known.get(f)!
    // too slow at the end of its way, or answered too slowly by a cache on it
    if (open || ways.some((w) => w.at(-1) === stage || (st.kind === 'cache' && w.includes(stage)))) {
      out.push('timedout')
      break
    }
  }
  return out
}

/** Every rule a drain must keep, checked once the stages and routes are known; throws naming the first it breaks. */
export function checkDrains(def: Shape): void {
  const taken = new Map<string, string>()
  for (const [id, st] of Object.entries(def.stages)) {
    if (st.kind !== 'drain') continue
    if (!st.from.length) throw new Error(`loadmap: drain "${id}" takes from no stage: name them with from`)
    for (const f of Object.keys(def.flows))
      if (waysOf(def, f).ways.some((w) => w.includes(id)))
        throw new Error(`loadmap: drain "${id}" is on the way of "${f}": it takes only what other stages lose`)
    for (const s of st.from) {
      const src = def.stages[s]
      if (!src) throw new Error(`loadmap: drain "${id}" takes from unknown stage "${s}"`)
      const can = lossesOf(def, s)
      const wanted = st.reason ?? can
      const counted = wanted.filter((r) => can.includes(r))
      if (!counted.length)
        throw new Error(
          `loadmap: drain "${id}" takes from "${s}", which loses nothing it counts: ${
            st.reason
              ? `"${s}" never has ${st.reason.join(' or ')} units`
              : `"${s}" turns nothing away, drops nothing and times nothing out`
          }`,
        )
      for (const r of counted) {
        const other = taken.get(`${s}\u0000${r}`)
        if (other) throw new Error(`loadmap: what "${s}" loses as ${r} goes to two drains, "${other}" and "${id}"`)
        taken.set(`${s}\u0000${r}`, id)
      }
    }
  }
}
