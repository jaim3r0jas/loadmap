import { flowError } from './blame'
import type { Loss, SplitBranch, StageDef } from './stages'

/** What `lossesIn` and the lost box checks read of a model definition: its stages, routes and flows' rules. */
interface Shape {
  stages: Readonly<Record<string, StageDef>>
  routes: Readonly<Record<string, readonly string[]>>
  flows: Readonly<Record<string, { overload?: unknown; timeout?: unknown }>>
  components?: Readonly<Record<string, { fails?: unknown }>>
}

/**
 * The ways a flow goes, as far as they are known without the values, each from its first stage to its last, as the
 * model walks them: a split's way that ends in a store, a sink or a fan-out ends there, any other rejoins the route
 * after the split. A flow with no split has its route as its one way. `open` is true when a split works its ways out
 * from the values, so they could lead anywhere; its ways are then taken as the route alone.
 */
export function waysOf(def: Shape, f: string): { ways: string[][]; open: boolean } {
  const ways: string[][] = []
  let open = false
  const walk = (done: string[], rest: readonly string[], depth: number) => {
    for (const [i, s] of rest.entries()) {
      const st = def.stages[s]
      if (st?.kind === 'split' && depth < 16) {
        if (typeof st.to === 'function') open = true
        else {
          const branches = Array.isArray(st.to) ? st.to : ((st.to as Record<string, readonly SplitBranch[]>)[f] ?? [])
          if (branches.length) {
            const after = rest.slice(i + 1)
            for (const b of branches as readonly SplitBranch[]) {
              const end = def.stages[b.stages.at(-1) ?? '']?.kind
              const ends = end === 'store' || end === 'sink' || end === 'fanout'
              walk([...done, s], [...b.stages, ...(ends ? [] : after)], depth + 1)
            }
            return
          }
        }
      }
      done.push(s)
    }
    ways.push(done)
  }
  walk([], def.routes[f] ?? [], 0)
  return { ways, open }
}

/**
 * The losses each stage can have, so a lost box may take them: a pass, limit, cache or split turns units away past
 * capacity; a queue drops what is too old for a flow with a drop rule; the last stage of a way times out what is too
 * slow for a flow with a timeout; a stage whose component `fails` fails a share of them. A rule worked out from the values counts as there. The ways are walked once, for
 * every stage asked after.
 */
export function lossesIn(def: Shape): (stage: string) => Loss[] {
  const flows = Object.keys(def.flows)
  const known = new Map(flows.map((f) => [f, waysOf(def, f)]))
  return (stage) => {
    const st = def.stages[stage]
    if (!st) return []
    const out: Loss[] = []
    // a stage reached only as a fan-out's copy is on no way: what it turns away is a copy, not a unit
    // and a fallback's stages are reached by what their flow fails for good
    const on = (f: string) =>
      known.get(f)!.open ||
      known.get(f)!.ways.some((w) => w.includes(stage)) ||
      ((def.flows[f] as { fallback?: { route: readonly string[] } }).fallback?.route.includes(stage) ?? false)
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
    // a stage whose component fails a share of its units, whatever the load
    const of = (st as { component?: string }).component
    if (passes && of != null && def.components?.[of]?.fails != null) out.push('failed')
    for (const f of flows) {
      if (def.flows[f]!.timeout == null) continue
      const { ways, open } = known.get(f)!
      // too slow at the end of its way, or answered too slowly by a cache on it
      if (open || ways.some((w) => w.at(-1) === stage || (st.kind === 'cache' && w.includes(stage)))) {
        out.push('timedOut')
        break
      }
    }
    return out
  }
}

/** Every rule a lost box must keep, checked once the stages and routes are known; throws naming the first it breaks. */
export function checkLost(def: Shape): void {
  const taken = new Map<string, string>()
  const losses = lossesIn(def)
  for (const [id, st] of Object.entries(def.stages)) {
    if (st.kind !== 'lost') continue
    if (!st.from.length) throw new Error(`loadmap: lost "${id}" takes from no stage: name them with from`)
    for (const f of Object.keys(def.flows))
      if (waysOf(def, f).ways.some((w) => w.includes(id)))
        throw flowError(
          `loadmap: lost "${id}" is on the way of "${f}": it takes only what other stages lose`,
          f,
          'route',
          id,
        )
    for (const s of st.from) {
      const src = def.stages[s]
      if (!src) throw new Error(`loadmap: lost "${id}" takes from unknown stage "${s}"`)
      const can = losses(s)
      const wanted = st.takes ?? can
      const counted = wanted.filter((r) => can.includes(r))
      if (!counted.length)
        throw new Error(
          `loadmap: lost "${id}" takes from "${s}", which loses nothing it counts: ${
            st.takes
              ? `"${s}" never has ${st.takes.join(' or ')} units`
              : `"${s}" turns nothing away, drops nothing and times nothing out`
          }`,
        )
      for (const r of counted) {
        const other = taken.get(`${s}\u0000${r}`)
        if (other) throw new Error(`loadmap: what "${s}" loses as ${r} goes to two lost boxes, "${other}" and "${id}"`)
        taken.set(`${s}\u0000${r}`, id)
      }
    }
  }
}
