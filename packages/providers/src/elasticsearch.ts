import type { TimeSeries } from '@loadmap/core'
import { endpoint, unreachable } from './http'
import type { Provider, ProviderQuery, ProviderResult } from './pull'

export interface ElasticsearchOptions {
  /** The cluster's address: "https://search.example:9200", or a path behind a proxy. */
  url: string
  /** Sent as `ApiKey …`. */
  apiKey?: string
  /** Basic auth, when there is no API key. */
  user?: string
  password?: string
  /** For tests and proxies; the global `fetch` by default. */
  fetch?: typeof fetch
}

/** What a metric's `elasticsearch` block asks, as `compile` writes it into the query. */
/** What it counts or aggregates at each step: the values a metric's `agg` takes. */
export const AGGS = ['rate', 'count', 'avg', 'sum', 'min', 'max'] as const

interface Spec {
  index: string
  time: string
  agg: (typeof AGGS)[number]
  field?: string
  query?: Record<string, unknown>
}

interface Search {
  timed_out?: boolean
  _shards?: { total?: number; failed?: number }
  aggregations?: { t?: { buckets?: { key?: number; doc_count?: number; v?: { value?: number | null } }[] } }
  error?: { type?: string; reason?: string } | string
}

/**
 * Reads an index over a range as a date histogram at the step: documents per second (`rate`), per step (`count`),
 * or the avg, sum, min or max of a field. OpenSearch answers the same request. A window where no document matches is
 * an error, not a series of zeros: a wrong query must not read as no traffic. Errors never carry the address or the
 * credentials.
 */
export function elasticsearch(o: ElasticsearchOptions): Provider {
  const get = o.fetch ?? fetch
  const { base, headers } = endpoint('Elasticsearch', o.url, {
    ...(o.user != null && { user: o.user }),
    ...(o.password != null && { password: o.password }),
    ...(o.apiKey && { header: `ApiKey ${o.apiKey}` }),
  })
  headers['content-type'] = 'application/json'
  return {
    id: 'elasticsearch',
    async read(q: ProviderQuery): Promise<ProviderResult> {
      const spec = specOf(q.query)
      if (!spec) return { error: 'the query is not an Elasticsearch request loadmap wrote' }
      // a part like ".." would walk out of the cluster's path
      if (spec.index.split(',').some((p) => !p || p === '.' || p === '..' || /[\s/?#]/.test(p)))
        return { error: 'the index is not a name or a pattern' }
      const from = Date.parse(q.from)
      const to = Date.parse(q.to)
      if (!(to - from >= q.step * 1000)) return { error: 'the window is shorter than a step' }
      const body = {
        size: 0,
        // the buckets say whether anything matched: no exact count of every hit
        track_total_hits: false,
        query: {
          bool: {
            filter: [
              { range: { [spec.time]: { gte: from, lt: to, format: 'epoch_millis' } } },
              ...(spec.query ? [spec.query] : []),
            ],
          },
        },
        aggs: {
          t: {
            date_histogram: {
              field: spec.time,
              fixed_interval: `${q.step}s`,
              min_doc_count: 0,
              // on the window's grid, not the epoch's: no short first step
              offset: `${(from / 1000) % q.step}s`,
              // every step of the window, the last one starting a step before its end
              extended_bounds: { min: from, max: to - q.step * 1000 },
            },
            ...(spec.field && { aggs: { v: { [spec.agg]: { field: spec.field } } } }),
          },
        },
      }
      // set as the path, never resolved as a URL: "cluster:logs-*" is an index, not a scheme
      const url = new URL(base)
      url.pathname = `${base.pathname}${encodeURIComponent(spec.index).replace(/%2C/g, ',').replace(/%3A/g, ':')}/_search`
      let res: Response
      try {
        res = await get(url, { method: 'POST', headers, body: JSON.stringify(body) })
      } catch (err) {
        return unreachable('Elasticsearch', err)
      }
      let r: Search | undefined
      try {
        r = (await res.json()) as Search
      } catch {
        r = undefined
      }
      if (!res.ok || !r || r.error) {
        const e = r?.error
        const why = typeof e === 'string' ? e : [e?.type, e?.reason].filter(Boolean).join(': ')
        return { error: `Elasticsearch answered ${res.status}${why ? `: ${why}` : ''}` }
      }
      // a part of the answer is not the answer: rates and averages would read low
      const failed = r._shards?.failed ?? 0
      if (failed) return { error: `${failed} of ${r._shards?.total ?? '?'} shards failed` }
      if (r.timed_out) return { error: 'the search timed out' }
      const buckets = r.aggregations?.t?.buckets ?? []
      if (!buckets.some((b) => (b.doc_count ?? 0) > 0)) return { error: 'no document matches the query in the window' }
      const points: [number, number][] = []
      for (const b of buckets) {
        const n = b.doc_count ?? 0
        const v = spec.agg === 'count' ? n : spec.agg === 'rate' ? n / q.step : b.v?.value
        if (typeof b.key === 'number' && typeof v === 'number' && Number.isFinite(v))
          points.push([Math.round(b.key / 1000), v])
      }
      return { points: points as TimeSeries }
    },
  }
}

function specOf(text: string): Spec | undefined {
  let s: unknown
  try {
    s = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof s !== 'object' || s === null) return undefined
  const { index, time, agg, field, query } = s as Record<string, unknown>
  if (
    typeof index !== 'string' ||
    typeof time !== 'string' ||
    typeof agg !== 'string' ||
    !(AGGS as readonly string[]).includes(agg)
  )
    return undefined
  if (field !== undefined && typeof field !== 'string') return undefined
  if (query !== undefined && (typeof query !== 'object' || query === null || Array.isArray(query))) return undefined
  return s as Spec
}
