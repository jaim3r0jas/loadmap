import { fitLinear, type LinearFit } from './calibrate'
import { type Capacity, measured } from './capacity'
import { fmt } from './format'

/**
 * Measured data: what a provider read from a metrics store, written to a snapshot file the model reads. A page and
 * its recordings say the same thing on any day: the dates come from the snapshot, never from the clock. Imported on
 * its own (`@loadmap/core/measure`), so no page loads it unless it reads a snapshot.
 */

/** How a window of points becomes one value. */
export type Stat = 'mean' | 'min' | 'max' | 'last' | 'p50' | 'p95' | 'p99'

/** Points over time, oldest first: [unix seconds, value]. */
export type TimeSeries = readonly (readonly [t: number, value: number])[]

/**
 * Where a measured value came from: the provider and the query that read it, over which window. The query is data
 * passed to the provider, never code loadmap runs; the address and the credentials are never part of it.
 */
export interface Origin {
  /** The provider's id: "prometheus", "elasticsearch". */
  provider: string
  /** The query as sent, its arguments filled in. */
  query: string
  /** The mapping that wrote the query, when one did. */
  metric?: string
  /** The window read, as ISO 8601 instants. */
  from: string
  to: string
  /** Seconds between points. */
  step?: number
  /** When it was read, ISO 8601. */
  fetched: string
  /** Points in the window. */
  samples: number
  /** Points it needs before it counts: with fewer, the definition's own value is used. */
  min?: number
  /** How the window became one value. */
  stat?: Stat
}

/**
 * One measurement of a snapshot: a value with the points it came from, or why there is none. `source` is the line its
 * origin shows, written by `parseSnapshot`.
 */
export type Measurement =
  | {
      label?: string
      unit: string
      value: number
      series?: TimeSeries
      origin: Origin
      source?: string
      missing?: undefined
    }
  | {
      label?: string
      unit?: string
      missing: string
      origin?: Origin
      source?: string
      value?: undefined
      series?: undefined
    }

/** What a pull wrote: every measurement by name, each with its origin. */
export interface Snapshot {
  format: 'loadmap-snapshot'
  version: 1
  /** When it was read, ISO 8601. */
  fetched: string
  /** The window it covers, ISO 8601: a measurement's origin may say otherwise. */
  from: string
  to: string
  measurements: Readonly<Record<string, Measurement>>
}

const STATS: readonly Stat[] = ['mean', 'min', 'max', 'last', 'p50', 'p95', 'p99']
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

/**
 * A snapshot read from a file, checked: an opened file is untrusted input, so anything that is not a snapshot is
 * refused with where it went wrong. Takes the text or the parsed JSON. A value with no samples, or fewer than its
 * `min`, comes back missing, with why: it does not count, and the definition's own value is used.
 */
export function parseSnapshot(input: unknown): Snapshot {
  const fail = (where: string, what: string): never => {
    throw new Error(`loadmap: not a snapshot: ${where} ${what}`)
  }
  let raw = input
  if (typeof input === 'string')
    try {
      raw = JSON.parse(input)
    } catch (err) {
      fail('the text', `is not JSON (${(err as Error).message})`)
    }
  const record = (v: unknown, where: string) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(where, 'is not an object')
    return v as Record<string, unknown>
  }
  const field = (o: Record<string, unknown>, k: string) => (Object.hasOwn(o, k) ? o[k] : undefined)
  const text = (o: Record<string, unknown>, k: string, where: string, optional = false) => {
    const v = field(o, k)
    if (v === undefined && optional) return undefined
    if (typeof v !== 'string') return fail(`${where}.${k}`, 'is not a text')
    return v
  }
  const instant = (o: Record<string, unknown>, k: string, where: string) => {
    const v = text(o, k, where)!
    if (!INSTANT.test(v) || Number.isNaN(Date.parse(v))) fail(`${where}.${k}`, `is not an ISO 8601 instant: "${v}"`)
    return v
  }
  const count = (o: Record<string, unknown>, k: string, where: string, optional = false) => {
    const v = field(o, k)
    if (v === undefined && optional) return undefined
    if (!Number.isInteger(v) || (v as number) < 0) fail(`${where}.${k}`, 'is not a whole number from 0')
    return v as number
  }

  const top = record(raw, 'the file')
  if (field(top, 'format') !== 'loadmap-snapshot') fail('format', 'is not "loadmap-snapshot"')
  if (field(top, 'version') !== 1) fail('version', `is ${JSON.stringify(field(top, 'version'))}, not 1`)
  const list = record(field(top, 'measurements'), 'measurements')
  const measurements: Record<string, Measurement> = Object.create(null)
  for (const name of Object.keys(list)) {
    const where = `measurements["${name}"]`
    const m = record(list[name], where)
    const label = text(m, 'label', where, true)
    const unit = text(m, 'unit', where, Object.hasOwn(m, 'missing'))
    let origin: Origin | undefined
    if (Object.hasOwn(m, 'origin')) {
      const ow = `${where}.origin`
      const o = record(m.origin, ow)
      const step = field(o, 'step')
      if (step !== undefined && !(typeof step === 'number' && step > 0 && Number.isFinite(step)))
        fail(`${ow}.step`, 'is not a number of seconds above 0')
      const stat = field(o, 'stat')
      if (stat !== undefined && !STATS.includes(stat as Stat)) fail(`${ow}.stat`, `is not one of ${STATS.join(', ')}`)
      const metric = text(o, 'metric', ow, true)
      const min = count(o, 'min', ow, true)
      origin = {
        provider: text(o, 'provider', ow)!,
        query: text(o, 'query', ow)!,
        ...(metric != null && { metric }),
        from: instant(o, 'from', ow),
        to: instant(o, 'to', ow),
        ...(step != null && { step: step as number }),
        fetched: instant(o, 'fetched', ow),
        samples: count(o, 'samples', ow)!,
        ...(min != null && { min }),
        ...(stat != null && { stat: stat as Stat }),
      }
    }
    if (Object.hasOwn(m, 'missing')) {
      const missing = text(m, 'missing', where)!
      measurements[name] = {
        ...(label != null && { label }),
        ...(unit != null && { unit }),
        missing,
        ...(origin && { origin, source: originText(origin) }),
      }
      continue
    }
    if (!origin) fail(where, 'has a value but no origin')
    const value = field(m, 'value')
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${where}.value`, 'is not a finite number')
    let series: TimeSeries | undefined
    if (Object.hasOwn(m, 'series')) {
      const s = field(m, 'series')
      if (!Array.isArray(s)) fail(`${where}.series`, 'is not a list of [time, value] points')
      series = (s as unknown[]).map((pt, i) => {
        if (!Array.isArray(pt) || pt.length !== 2 || !pt.every((x) => typeof x === 'number' && Number.isFinite(x)))
          fail(`${where}.series[${i}]`, 'is not a [time, value] pair of finite numbers')
        const [t, v] = pt as [number, number]
        return [t, v] as const
      })
    }
    const read: Measurement = {
      ...(label != null && { label }),
      unit: unit!,
      value: value as number,
      ...(series && { series }),
      origin: origin!,
      source: originText(origin!),
    }
    const why = unreadOf(read, name)
    measurements[name] =
      why == null
        ? read
        : { ...(label != null && { label }), unit: unit!, missing: why, origin: origin!, source: read.source! }
  }
  return {
    format: 'loadmap-snapshot',
    version: 1,
    fetched: instant(top, 'fetched', 'the file'),
    from: instant(top, 'from', 'the file'),
    to: instant(top, 'to', 'the file'),
    measurements,
  }
}

/**
 * "prometheus: sum(rate(http_requests_total[5m])), 2026-11-01 to 2026-11-08, every 5 min, 2016 samples, p95": the line
 * a measured value's source shows.
 */
export function originText(o: Origin): string {
  const day = (t: string) => t.slice(0, 10)
  const time = (t: string) => t.slice(11, 16)
  const window =
    day(o.from) === day(o.to) ? `${day(o.from)} ${time(o.from)}–${time(o.to)}` : `${day(o.from)} to ${day(o.to)}`
  const s = o.step
  const step =
    s == null
      ? ''
      : `, every ${s % 3600 === 0 ? `${fmt(s / 3600)} h` : s % 60 === 0 ? `${fmt(s / 60)} min` : `${fmt(s)} s`}`
  return `${o.provider}: ${o.query}, ${window}${step}, ${o.samples} ${o.samples === 1 ? 'sample' : 'samples'}${o.stat ? `, ${o.stat}` : ''}`
}

/** Why a measurement does not count (missing, no samples, too few); null when it does. */
export function unreadOf(m: Measurement | undefined, name: string): string | null {
  if (!m) return `"${name}" is not in the snapshot`
  if (m.missing != null) return m.missing
  const { samples, min } = m.origin
  if (!samples) return 'no samples in the window'
  if (min != null && samples < min) return `${samples} of at least ${min} samples`
  return null
}

/**
 * The window as one value. Percentiles interpolate between the two nearest points, as Prometheus's
 * `quantile_over_time` does; `last` is the latest point.
 */
export function summarize(series: TimeSeries, stat: Stat): number {
  if (!series.length) throw new Error('loadmap: summarize needs at least one point')
  const vs = series.map((pt) => pt[1])
  switch (stat) {
    case 'mean':
      return vs.reduce((s, v) => s + v, 0) / vs.length
    // a reduce: a long window has more points than a call takes arguments
    case 'min':
      return vs.reduce((a, b) => Math.min(a, b))
    case 'max':
      return vs.reduce((a, b) => Math.max(a, b))
    case 'last':
      return series.reduce((a, b) => (b[0] >= a[0] ? b : a))[1]
    default:
      return quantile(
        [...vs].sort((a, b) => a - b),
        Number(stat.slice(1)) / 100,
      )
  }
}

/** The q-quantile of a sorted sample, interpolating between the two nearest ranks. */
export function quantile(sorted: readonly number[], q: number): number {
  const rank = q * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo)
}

/** Reads a snapshot inside model functions: each read falls back to the definition's own value, with why. */
export interface SnapshotReader {
  readonly snapshot: Snapshot | undefined
  /** The measurement as a measured capacity with its origin; without one, the fallback marked with why. */
  capacity(name: string, fallback: Capacity): Capacity
  /** The measurement's value (a rate, a hit share, a count); without one, the fallback. */
  value(name: string, fallback: number): number
  /** cost = a + b × x fitted from two series on the same timestamps; without them, the fallback marked with why. */
  fit(x: string, y: string, fallback: LinearFit, o?: { through?: 'origin' }): LinearFit
  /** Why a measurement does not count; null when it does. */
  unread(name: string): string | null
}

/**
 * A reader for a snapshot, or for none: a check without fresh data (a pull request from a fork) still runs, on the
 * values the definition writes.
 *
 *     const read = fromSnapshot(snapshot)
 *     capacity: read.capacity('gatewayCapacity', estimated(20_000, 'req/s', 'vendor benchmark'))
 */
export function fromSnapshot(snapshot: Snapshot | undefined): SnapshotReader {
  const get = (name: string) =>
    snapshot && Object.hasOwn(snapshot.measurements, name) ? snapshot.measurements[name] : undefined
  const unread = (name: string) => (snapshot ? unreadOf(get(name), name) : 'no snapshot')
  const usable = (name: string) =>
    unread(name) == null ? (get(name) as Extract<Measurement, { value: number }>) : null
  return {
    snapshot,
    unread,
    capacity(name, fallback) {
      // no snapshot at all (a pull request from a fork): the definition's values stand, and nothing is missing
      if (!snapshot) return fallback
      const m = usable(name)
      if (!m) return { ...fallback, unread: unread(name)!, measure: name }
      // the file is data: a wrong unit is a measurement that does not count, not a page that fails
      if (m.unit !== fallback.unit)
        return { ...fallback, unread: `"${name}" is in ${m.unit}, not ${fallback.unit}`, measure: name }
      // the fallback's ± was about a guess, not about this reading
      return {
        ...measured(m.value, m.unit, { source: m.source ?? originText(m.origin), origin: m.origin }),
        measure: name,
      }
    },
    value(name, fallback) {
      return usable(name)?.value ?? fallback
    },
    fit(x, y, fallback, o = {}) {
      if (!snapshot) return fallback
      const mx = usable(x)
      const my = usable(y)
      const why = (n: string, m: typeof mx) => (m ? (m.series?.length ? null : `"${n}" has no series`) : unread(n))
      // a copy: the fallback may serve other reads
      const instead = (unread: string) => Object.assign((v: number) => fallback(v), fallback, { unread }) as LinearFit
      const reason = why(x, mx) ?? why(y, my)
      if (reason != null) return instead(reason)
      const at = new Map(my!.series!.map(([t, v]) => [t, v]))
      const points = mx!.series!.flatMap(([t, v]) => (at.has(t) ? [{ [fallback.x]: v, [fallback.y]: at.get(t)! }] : []))
      if (new Set(points.map((pt) => pt[fallback.x])).size < 2)
        return instead(`"${x}" and "${y}" share fewer than two distinct points`)
      const fit = fitLinear(points, {
        x: fallback.x,
        y: fallback.y,
        source: `${originText(mx!.origin)}; ${originText(my!.origin)}`,
        ...(o.through && { through: o.through }),
      })
      return Object.assign(fit, { origin: { x: mx!.origin, y: my!.origin } })
    },
  }
}

/**
 * What a measurement is about: `rate` (units per second through), `capacity` (the most it handles), `limit` (a set
 * maximum), `latency`, `cost` (a resource used, fitted against a rate), `share` (0 to 1), `count`, `duration` or `size`.
 * capacity, limit, latency and cost mean what a catalog figure's `measure` means, so a published and a measured p99
 * land in the same place.
 */
export type MeasureRole = 'rate' | 'capacity' | 'limit' | 'latency' | 'cost' | 'share' | 'count' | 'duration' | 'size'

export interface MeasureSpec {
  role: MeasureRole
  /**
   * What kind of unit: "per second", "ms", "share", "count", "seconds", "bytes", "bytes per second", "cores". A
   * measurement's own unit is the one the model uses ("req/s"), and a capacity takes it only when the two are equal.
   */
  dimension: string
  doc: string
  /** What of the model it sets, when it sets one: `rate`, `capacity`, `hit`, `pods`, `perPod`, `partitions`, `share`. */
  sets?: string
  /** Kept for a part of the model that is not built yet: read and listed, but nothing uses it. */
  later?: true
}

/**
 * The standard measurements per kind: what loadmap expects to know about a flow and each stage, so every provider
 * maps its query results onto the same names. `split` and `slots` are kinds the model does not have yet.
 */
export const MEASURES = {
  flow: {
    rate: { role: 'rate', dimension: 'per second', sets: 'rate', doc: 'Units per second at the source.' },
  },
  pass: {
    served: { role: 'rate', dimension: 'per second', doc: 'Units handled per second.' },
    rejected: { role: 'rate', dimension: 'per second', doc: 'Units turned away per second (429, 503).' },
    capacity: {
      role: 'capacity',
      dimension: 'per second',
      sets: 'capacity',
      doc: 'The most it handled: a load test or a saturated peak.',
    },
    instances: { role: 'count', dimension: 'count', doc: 'Instances serving.' },
    latencyP50: { role: 'latency', dimension: 'ms', later: true, doc: 'Median response time.' },
    latencyP95: { role: 'latency', dimension: 'ms', later: true, doc: '95th percentile response time.' },
    latencyP99: { role: 'latency', dimension: 'ms', later: true, doc: '99th percentile response time.' },
  },
  queue: {
    produced: { role: 'rate', dimension: 'per second', sets: 'rate', doc: 'Messages written per second.' },
    consumed: { role: 'rate', dimension: 'per second', doc: 'Messages read per second.' },
    lag: { role: 'count', dimension: 'count', doc: 'Messages waiting.' },
    lagSeconds: { role: 'duration', dimension: 'seconds', doc: 'How old the oldest waiting message is.' },
    partitions: { role: 'count', dimension: 'count', sets: 'partitions', doc: 'Partitions of the topic.' },
    bytesIn: { role: 'rate', dimension: 'bytes per second', doc: 'Bytes written per second.' },
    bytesOut: { role: 'rate', dimension: 'bytes per second', doc: 'Bytes read per second.' },
  },
  workers: {
    pods: { role: 'count', dimension: 'count', sets: 'pods', doc: 'Pods running.' },
    perPod: { role: 'count', dimension: 'count', sets: 'perPod', doc: 'Workers in each pod.' },
    busy: { role: 'share', dimension: 'share', doc: 'The share of workers busy.' },
    cores: { role: 'cost', dimension: 'cores', doc: 'CPU cores used: fitted against a rate, the cost per unit.' },
    coresLimit: { role: 'capacity', dimension: 'cores', sets: 'capacity', doc: 'CPU cores the pool may use.' },
  },
  cache: {
    ops: { role: 'rate', dimension: 'per second', doc: 'Lookups per second.' },
    hit: { role: 'share', dimension: 'share', sets: 'hit', doc: 'The share of lookups answered from the cache.' },
    evictions: { role: 'rate', dimension: 'per second', doc: 'Entries evicted per second.' },
    memory: { role: 'size', dimension: 'bytes', doc: 'Memory used.' },
    capacity: { role: 'capacity', dimension: 'per second', sets: 'capacity', doc: 'The most lookups it handled.' },
  },
  limit: {
    allowed: { role: 'rate', dimension: 'per second', doc: 'Units let through per second.' },
    rejected: { role: 'rate', dimension: 'per second', doc: 'Units rejected per second.' },
    limit: { role: 'limit', dimension: 'per second', sets: 'capacity', doc: 'The limit it is set to.' },
  },
  store: {
    queries: { role: 'rate', dimension: 'per second', doc: 'Queries per second.' },
    commits: { role: 'rate', dimension: 'per second', doc: 'Commits per second.' },
    capacity: {
      role: 'capacity',
      dimension: 'per second',
      sets: 'capacity',
      doc: 'The most commits (or queries) it handled.',
    },
    replicaLag: { role: 'duration', dimension: 'seconds', doc: 'How far the replicas are behind.' },
    writeLatency: { role: 'latency', dimension: 'ms', later: true, doc: 'Time a write takes.' },
    connections: { role: 'count', dimension: 'count', later: true, doc: 'Connections open: a pool of slots.' },
  },
  fanout: {
    copies: { role: 'share', dimension: 'per unit', sets: 'share', doc: 'Copies sent per unit, per branch.' },
    deliveries: { role: 'rate', dimension: 'per second', doc: 'Copies delivered per second, per branch.' },
  },
  split: {
    share: { role: 'share', dimension: 'share', later: true, doc: 'The share of units sent to each branch.' },
  },
  slots: {
    inUse: {
      role: 'count',
      dimension: 'count',
      later: true,
      doc: 'Slots in use: connections, sessions, in-flight requests.',
    },
    available: { role: 'capacity', dimension: 'count', later: true, doc: 'Slots there are.' },
    held: { role: 'duration', dimension: 'seconds', later: true, doc: 'How long each is held.' },
    wait: { role: 'duration', dimension: 'seconds', later: true, doc: 'The wait for a free slot.' },
  },
} as const satisfies Readonly<Record<string, Readonly<Record<string, MeasureSpec>>>>
