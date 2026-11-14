import type { Capacity } from './capacity'
import { pct } from './format'
import type { Dyn, StageDef } from './stages'

/**
 * shared: any member of the stage takes any unit (the default, and what a stage does without a connection).
 * exclusive: each part (a partition of the queue in front, or one of `parts`) is read by one member only: a Kafka
 * consumer group, a single active consumer. Members beyond the parts read nothing.
 * key: each unit goes to the part its key hashes to (a partition of the queue it reaches, or one of `parts`), and part
 * i of each flow sits on member i mod `members` of that stage: a producer's key, a cluster's slots or shards.
 * leader: every unit goes to one member of that stage: a Raft leader, a primary, a queue's one node.
 */
export type Assign = 'shared' | 'exclusive' | 'key' | 'leader'

/** One member of a pool: a worker, or a pod with its workers. */
export type Member = 'worker' | 'pod'

/**
 * How a stage reaches the next one on a route, and through which part of it. It never changes what reaches a stage,
 * a demand or a capacity: it says how unevenly the work lands on the members of `to`, and the component of `to` runs
 * out when its busiest member does.
 */
export interface ConnectionDef<S extends string = string, F extends string = string> {
  /** The stage in front: a queue's partitions of each flow are its parts. */
  from: S
  /** The stage whose members take the parts. */
  to: S
  assign?: Assign
  /** What owns a part when `to` is a pool: one worker (the default) or one pod. */
  owner?: Member
  /**
   * What the capacity of `to`'s component divides over evenly: per worker (each worker handles one unit at a time) or
   * per pod (a CPU limit the pod's workers share). The owner by default; never finer than it.
   */
  capacityPer?: Member
  /** The parts of each flow, when `from` is not a queue: shards, slots, ranges. */
  parts?: Dyn<number>
  /** The members of `to` when it is not a pool. */
  members?: Dyn<number>
  /** The flows it covers; by default every flow that goes from `from` straight to `to`. */
  flows?: readonly F[]
  /**
   * The connections each member of the pool on the hop keeps open to the stage on the other side: a pod's pool of
   * database connections (`owner: 'pod'`), a consumer's to its brokers.
   */
  open?: Dyn<number>
  /**
   * The most connections the stage on the other side accepts, from every connection into it: `max_connections`. It
   * makes a limit of its own, named by this connection's id: the connections open against it.
   */
  max?: Capacity | ((ctx: any) => Capacity)
  /** With key: the share of a flow on its hottest part, measured or estimated: a hot key, a hot tenant. */
  skew?: Capacity | ((ctx: any) => Capacity)
}

/** How unevenly the work lands on a component's members. */
export interface Spread {
  /** The busiest member's share of the work over its share of the capacity: 1 when the work lands evenly. */
  factor: number
  /** "The busiest pod reads 2 of 6 partitions: the consumer runs out at 75 % of its capacity." */
  text: string
}

/** Who takes the parts: owners are dealt parts in turn; units are what the capacity divides over. */
export interface Shape {
  owners: number
  units: number
  /** The unit an owner belongs to. */
  unitOf: (owner: number) => number
  /** The worker an owner is drawn as (pod × workers per pod + its place); a pod's first worker stands for the pod. */
  cellOf: (owner: number) => number
  owner: 'worker' | 'pod' | 'member'
  unit: 'worker' | 'pod' | 'member'
}

/**
 * A pool's shape: owners alternate pods (owner r sits in pod r mod pods), so parts dealt in turn spread over the pods
 * as evenly as they can. Kafka orders members by id, which may be less even: this is the even case.
 */
export function poolShape(pods: number, perPod: number, owner: Member, per: Member): Shape {
  const owners = owner === 'pod' ? pods : pods * perPod
  // owner r of the workers sits in pod r mod pods, place r ÷ pods in it
  const cellOf = (r: number) => (owner === 'pod' ? r * perPod : (r % pods) * perPod + Math.floor(r / pods))
  if (per === owner) return { owners, units: owners, unitOf: (r) => r, cellOf, owner, unit: per }
  return { owners, units: pods, unitOf: (r) => r % pods, cellOf, owner, unit: 'pod' }
}

export function memberShape(members: number): Shape {
  return { owners: members, units: members, unitOf: (r) => r, cellOf: (r) => r, owner: 'member', unit: 'member' }
}

/** One flow's work at the stage: its share of everything that reaches it, and its parts (null: shared). */
export interface Work {
  flow: string
  weight: number
  parts: number | null
  /** The stage whose parts these are: the queue in front, for an exclusive flow. */
  from?: string
  /** The share on part 0, the hottest; the others share the rest evenly. Without one, every part is even. */
  skew?: number
  /** Part 0 of this flow goes to owner 0 again (partition i on member i mod n), instead of dealing on in turn. */
  restart?: boolean
}

export interface Spreading {
  factor: number
  /** The busiest unit's parts of each exclusive flow. */
  busiest: ReadonlyMap<string, number>
  /** Owners dealt no part. */
  idle: number
  /** Each unit's share of the work, adding up to 1. */
  share: readonly number[]
  /** Each unit's parts of each exclusive flow. */
  counts: readonly ReadonlyMap<string, number>[]
  /** The owner of each part of each exclusive flow, in the order the parts are numbered. */
  owners: ReadonlyMap<string, readonly number[]>
  /** Each owner's share of the work of the exclusive flows, of all the work. */
  owned: readonly number[]
  /** Each unit's share of each flow: the parts it has of an exclusive one, an even share of a shared one. */
  flows: readonly ReadonlyMap<string, number>[]
}

/**
 * Parts are dealt to the owners in turn, flow after flow (Kafka's round-robin assignor; for one flow range and sticky
 * give the same counts). A shared flow lands evenly on every unit.
 */
export function spreadOver(shape: Shape, work: readonly Work[]): Spreading {
  const { owners, units, unitOf } = shape
  const share = new Array<number>(units).fill(0)
  const owned = new Array<number>(owners).fill(0)
  const counts = Array.from({ length: units }, () => new Map<string, number>())
  const flows = Array.from({ length: units }, () => new Map<string, number>())
  const of = new Map<string, number[]>()
  const total = work.reduce((a, w) => a + w.weight, 0)
  let dealt = 0
  for (const w of work) {
    const weight = total > 0 ? w.weight / total : 1 / work.length
    if (w.parts == null) {
      for (let u = 0; u < units; u++) {
        share[u]! += weight / units
        flows[u]!.set(w.flow, 1 / units)
      }
      continue
    }
    const list: number[] = []
    for (let p = 0; p < w.parts; p++) {
      const o = (w.restart ? p : dealt++) % owners
      const u = unitOf(o)
      // the hottest part takes the skew, the rest share what is left
      const part = w.skew == null || w.parts === 1 ? 1 / w.parts : p === 0 ? w.skew : (1 - w.skew) / (w.parts - 1)
      list.push(o)
      owned[o]! += weight * part
      share[u]! += weight * part
      counts[u]!.set(w.flow, (counts[u]!.get(w.flow) ?? 0) + 1)
      flows[u]!.set(w.flow, (flows[u]!.get(w.flow) ?? 0) + part)
    }
    of.set(w.flow, list)
  }
  let busiest = 0
  for (let u = 1; u < units; u++) if (share[u]! > share[busiest]!) busiest = u
  // a hair above 1 is rounding, not a spread
  const factor = Math.max(1, share[busiest]! * units)
  return {
    factor: factor < 1 + 1e-9 ? 1 : factor,
    busiest: counts[busiest] ?? new Map(),
    idle: dealt > 0 ? Math.max(0, owners - dealt) : 0,
    share,
    counts,
    owners: of,
    owned,
    flows,
  }
}

/** The line under a component in the limits list; null when the work lands evenly and every owner reads. */
export function spreadText(
  s: Spreading,
  shape: Shape,
  work: readonly Work[],
  o: { short: string; plural: boolean; part: string; mode?: 'read' | 'key' | 'leader' },
): string | null {
  if (s.factor === 1 && s.idle === 0) return null
  const exclusive = work.filter((w) => w.parts != null)
  const out: string[] = []
  if (s.factor > 1) {
    const runs = `${o.short} ${o.plural ? 'run' : 'runs'} out at ${pct(1 / s.factor)} of ${o.plural ? 'their' : 'its'} capacity`
    const only = exclusive.length === 1 && exclusive.length === work.length ? exclusive[0]! : null
    const skewed = only?.skew != null
    out.push(
      o.mode === 'leader'
        ? `Every unit goes to the leader, one of ${shape.units} ${plural(shape.unit, shape.units)}: ${runs}.`
        : only && !skewed
          ? `The busiest ${shape.unit} ${o.mode === 'key' ? 'holds' : 'reads'} ${s.busiest.get(only.flow) ?? 0} of ${only.parts} ${plural(o.part, only.parts!)}: ${runs}.`
          : `The busiest ${shape.unit} carries ${Math.round(s.factor * 100) / 100} × its share: ${runs}.`,
    )
    for (const w of exclusive) if (w.skew != null) out.push(`The hottest key carries ${pct(w.skew)} of ${w.flow}.`)
  }
  if (s.idle > 0) {
    const none = `${s.idle} of ${shape.owners} ${plural(shape.owner, shape.owners)} read no ${o.part}`
    out.push(s.factor > 1 ? `${none}.` : `${none}: every ${shape.unit} still reads its share.`)
  }
  return out.join(' ')
}

const plural = (word: string, n: number) => (n === 1 ? word : `${word}s`)

/** The pool on a hop that opens connections (`from` when it is one, else `to`), and the stage they are opened to. */
export function opener(
  stages: Readonly<Record<string, StageDef>>,
  cn: ConnectionDef,
): { pool: string; target: string } | undefined {
  if (stages[cn.from]?.kind === 'workers') return { pool: cn.from, target: cn.to }
  if (stages[cn.to]?.kind === 'workers') return { pool: cn.to, target: cn.from }
  return undefined
}
