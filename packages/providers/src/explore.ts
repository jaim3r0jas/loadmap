import { endpoint, unreachable } from './http'

/**
 * What a metrics store answers about itself, read only: the metrics it has (`search`), a metric's labels and their
 * most common values (`labels`), and what a query gives over a window (`try`). An assistant proposes these calls; the
 * reader runs them; the answers go back to the model as data, capped, never the address or the credentials.
 */
export interface Explorer {
  id: string
  search(words: string): Promise<{ metrics: MetricInfo[] } | { error: string }>
  /** `capped`: there may be more series than were read (`EXPLORE_LIMITS.series`). */
  labels(
    metric: string,
    window: Window,
  ): Promise<{ series: number; capped?: boolean; labels: LabelInfo[] } | { error: string }>
  try(query: string, window: Window & { step: number }): Promise<TryResult | { error: string }>
}

export interface MetricInfo {
  name: string
  type?: string
  help?: string
  unit?: string
}

export interface LabelInfo {
  name: string
  /** The most common values first, with how many series have each. */
  values: { value: string; series: number }[]
}

export interface TryResult {
  series: number
  samples: number
  /** Over every point of the first series; the others are counted, not read. */
  mean: number | null
  max: number | null
  p95: number | null
}

/** ISO 8601 instants. */
export interface Window {
  from: string
  to: string
}

/** How much one call may bring back: a model reads all of it. */
export const EXPLORE_LIMITS = { metrics: 50, labels: 12, values: 20, series: 2000, window: 24 * 3600 } as const

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1)

/** The metric names that hold the most of the words (every word, when any name holds them all), shortest first. */
function rank(names: readonly string[], query: string): string[] {
  const want = words(query)
  if (!want.length) return []
  const scored = names.map((n) => ({ n, hits: want.filter((w) => n.toLowerCase().includes(w)).length }))
  const most = Math.max(0, ...scored.map((x) => x.hits))
  if (!most) return []
  const best = scored.filter((x) => x.hits === most)
  best.sort((a, b) => a.n.length - b.n.length || (a.n < b.n ? -1 : 1))

  return best.slice(0, EXPLORE_LIMITS.metrics).map((x) => x.n)
}

function quantile(sorted: readonly number[], q: number): number | null {
  if (!sorted.length) return null
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[i]!
}

/** The Prometheus HTTP API, read only: names, metadata, series and ranges. */
export function prometheusExplorer(o: {
  url: string
  token?: string
  user?: string
  password?: string
  fetch?: typeof fetch
}): Explorer {
  const get = o.fetch ?? fetch
  const { base, headers } = endpoint('Prometheus', o.url, {
    ...(o.user != null && { user: o.user }),
    ...(o.password != null && { password: o.password }),
    ...(o.token && { header: `Bearer ${o.token}` }),
  })
  const call = async <T>(path: string, q: Record<string, string | string[]>): Promise<T | { error: string }> => {
    const url = new URL(path, base)
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(q)) for (const x of Array.isArray(v) ? v : [v]) params.append(k, x)
    url.search = params.toString()
    let res: Response
    try {
      // a store that takes the connection and never answers must not hold the reader or the model forever
      res = await get(url, { headers, signal: AbortSignal.timeout(30_000) })
    } catch (err) {
      if ((err as Error)?.name === 'TimeoutError') return { error: 'Prometheus did not answer within 30 s' }
      return unreachable('Prometheus', err)
    }
    let body: { status?: string; error?: string; data?: unknown } | undefined
    try {
      body = (await res.json()) as typeof body
    } catch {
      body = undefined
    }
    if (!res.ok || body?.status !== 'success')
      return { error: `Prometheus answered ${res.status}${body?.error ? `: ${String(body.error).slice(0, 200)}` : ''}` }
    return body.data as T
  }
  const window = (w: Window): { error: string } | { start: string; end: string } => {
    const from = Date.parse(w.from)
    const to = Date.parse(w.to)
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return { error: 'the window is no window' }
    if ((to - from) / 1000 > EXPLORE_LIMITS.window) return { error: 'a window is at most 24 h' }
    return { start: w.from, end: w.to }
  }
  return {
    id: 'prometheus',
    async search(query) {
      // both at once: on a large store each is a long answer
      const [names, meta] = await Promise.all([
        call<string[]>('api/v1/label/__name__/values', {}),
        call<Record<string, { type?: string; help?: string; unit?: string }[]>>('api/v1/metadata', {
          limit_per_metric: '1',
        }),
      ])
      if ('error' in names) return names
      const picked = rank(names, query)
      const m = 'error' in meta ? {} : meta
      return {
        metrics: picked.map((name) => {
          const info = Object.hasOwn(m, name) ? m[name]?.[0] : undefined
          return {
            name,
            ...(info?.type && { type: info.type }),
            ...(info?.help && { help: info.help.slice(0, 200) }),
            ...(info?.unit && { unit: info.unit }),
          }
        }),
      }
    },
    async labels(metric, w) {
      if (!/^[A-Za-z_:][\w:]*$/.test(metric)) return { error: `"${metric.slice(0, 80)}" is no metric name` }
      const span = window(w)
      if ('error' in span) return span
      const series = await call<Record<string, string>[]>('api/v1/series', {
        'match[]': metric,
        ...span,
        limit: String(EXPLORE_LIMITS.series),
      })
      if ('error' in series) return series
      // a store too old for `limit` gives every series: only the first are read
      const read = series.slice(0, EXPLORE_LIMITS.series)
      const counts = new Map<string, Map<string, number>>()
      for (const s of read)
        for (const [k, v] of Object.entries(s)) {
          if (k === '__name__') continue
          const c = counts.get(k) ?? new Map<string, number>()
          c.set(v, (c.get(v) ?? 0) + 1)
          counts.set(k, c)
        }
      // the labels with the fewest values first: the ones a query selects on (job, service), not pod or instance
      const labels = [...counts]
        .sort((a, b) => a[1].size - b[1].size || (a[0] < b[0] ? -1 : 1))
        .slice(0, EXPLORE_LIMITS.labels)
        .map(([name, c]) => ({
          name,
          values: [...c]
            .sort((a, b) => b[1] - a[1])
            .slice(0, EXPLORE_LIMITS.values)
            .map(([value, n]) => ({ value: value.slice(0, 120), series: n })),
        }))
      return { series: read.length, capped: series.length >= EXPLORE_LIMITS.series, labels }
    },
    async try(query, w) {
      const span = window(w)
      if ('error' in span) return span
      // Prometheus answers at most 11 000 points a series: a long window takes a longer step
      const seconds = (Date.parse(w.to) - Date.parse(w.from)) / 1000
      const step = Math.max(1, Math.round(w.step), Math.ceil(seconds / 10_000))
      const r = await call<{ resultType?: string; result?: { values?: [number, string][] }[] }>('api/v1/query_range', {
        query,
        ...span,
        step: String(step),
      })
      if ('error' in r) return r
      if (r.resultType !== 'matrix') return { error: `the query gave a ${r.resultType}, not a range` }
      const result = r.result ?? []
      const values = (result[0]?.values ?? []).map(([, v]) => Number(v)).filter(Number.isFinite)
      const sorted = [...values].sort((a, b) => a - b)
      return {
        series: result.length,
        samples: values.length,
        mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
        max: sorted.at(-1) ?? null,
        p95: quantile(sorted, 0.95),
      }
    },
  }
}

export interface ExploreCall {
  tool: 'search' | 'labels' | 'try'
  arg: string
  window?: string
}

const SPAN: Readonly<Record<string, number>> = { m: 60, h: 3600, d: 86_400 }

/**
 * The calls run, one after the other, and their answers as text a model reads: what each call was, then what came
 * back. At most `max` calls; the window is the last hour unless a call says another (at most 24 h).
 */
export async function runExplore(
  explorer: Explorer,
  calls: readonly ExploreCall[],
  o: { now: Date; max?: number } = { now: new Date() },
): Promise<string> {
  const out: string[] = []
  const fmt = (n: number | null) => (n == null ? 'none' : Number(n.toPrecision(4)).toString())
  for (const c of calls.slice(0, o.max ?? 5)) {
    const m = /^(\d+)([mhd])$/.exec(c.window ?? '1h')
    if (!m) {
      out.push(`${c.tool} ${c.arg}:`, `  "${String(c.window).slice(0, 20)}" is no window: write 30m, 6h or 1d`)
      continue
    }
    // the window as asked: the explorer refuses one over a day, rather than read less than it says
    const seconds = Number(m[1]) * SPAN[m[2]!]!
    const to = o.now.toISOString()
    const from = new Date(o.now.getTime() - seconds * 1000).toISOString()
    if (c.tool === 'search') {
      const r = await explorer.search(c.arg)
      out.push(`search ${c.arg}:`)
      if ('error' in r) out.push(`  ${r.error}`)
      else if (!r.metrics.length) out.push('  no metric matches')
      else
        for (const x of r.metrics)
          out.push(
            `  ${x.name}${x.type ? ` (${x.type})` : ''}${x.unit ? ` [${x.unit}]` : ''}${x.help ? `: ${x.help}` : ''}`,
          )
    } else if (c.tool === 'labels') {
      const r = await explorer.labels(c.arg, { from, to })
      out.push(`labels ${c.arg}:`)
      if ('error' in r) out.push(`  ${r.error}`)
      else {
        out.push(`  ${r.series} series${r.capped ? ' or more (the first ones read)' : ''}`)
        for (const l of r.labels) out.push(`  ${l.name}: ${l.values.map((v) => `${v.value} (${v.series})`).join(', ')}`)
      }
    } else {
      const step = Math.max(15, Math.round(Math.min(seconds, EXPLORE_LIMITS.window) / 240))
      const r = await explorer.try(c.arg, { from, to, step })
      out.push(`try over ${c.window ?? '1h'} ${c.arg}:`)
      if ('error' in r) out.push(`  ${r.error}`)
      else
        out.push(
          `  ${r.series} series${r.series > 1 ? ' (sum them into one for a measure)' : ''}, ${r.samples} samples, mean ${fmt(r.mean)}, max ${fmt(r.max)}, p95 ${fmt(r.p95)}`,
        )
    }
  }
  if (calls.length > (o.max ?? 5))
    out.push(`(${calls.length - (o.max ?? 5)} more calls were not run: at most ${o.max ?? 5} a round)`)
  return out.join('\n')
}
