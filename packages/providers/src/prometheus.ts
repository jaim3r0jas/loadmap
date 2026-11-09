import type { TimeSeries } from '@loadmap/core'
import { endpoint, unreachable } from './http'
import type { Provider, ProviderQuery, ProviderResult } from './pull'

export interface PrometheusOptions {
  /** The server's address: "https://prometheus.example:9090", or a path behind a proxy. */
  url: string
  /** Sent as a bearer token. */
  token?: string
  /** Basic auth, when there is no token. */
  user?: string
  password?: string
  /** For tests and proxies; the global `fetch` by default. */
  fetch?: typeof fetch
}

interface QueryRange {
  status?: string
  error?: string
  errorType?: string
  data?: { resultType?: string; result?: { metric?: Record<string, string>; values?: [number, string][] }[] }
}

/**
 * Reads a PromQL query over a range (`/api/v1/query_range`). The query must give one series: several are an error
 * that says to sum them. Points Prometheus writes as NaN or ±Inf are left out. Errors never carry the address or the
 * credentials, so a snapshot or a log can be shared.
 */
export function prometheus(o: PrometheusOptions): Provider {
  const get = o.fetch ?? fetch
  const { base, headers } = endpoint('Prometheus', o.url, {
    ...(o.user != null && { user: o.user }),
    ...(o.password != null && { password: o.password }),
    ...(o.token && { header: `Bearer ${o.token}` }),
  })
  return {
    id: 'prometheus',
    async read(q: ProviderQuery): Promise<ProviderResult> {
      const url = new URL('api/v1/query_range', base)
      url.search = new URLSearchParams({ query: q.query, start: q.from, end: q.to, step: String(q.step) }).toString()
      let res: Response
      try {
        res = await get(url, { headers })
      } catch (err) {
        return unreachable('Prometheus', err)
      }
      let body: QueryRange | undefined
      try {
        body = (await res.json()) as QueryRange
      } catch {
        body = undefined
      }
      if (!res.ok || body?.status !== 'success') {
        const why = body?.error ? `: ${body.error}` : ''
        return { error: `Prometheus answered ${res.status}${why}` }
      }
      const result = body.data?.result ?? []
      if (body.data?.resultType !== 'matrix') return { error: `the query gave a ${body.data?.resultType}, not a range` }
      if (!result.length) return { error: 'the query returned no series' }
      if (result.length > 1) return { error: `the query returned ${result.length} series: sum them into one` }
      const points: [number, number][] = []
      for (const [t, v] of result[0]!.values ?? []) {
        const n = Number(v)
        if (Number.isFinite(t) && Number.isFinite(n)) points.push([t, n])
      }
      return { points: points as TimeSeries }
    },
  }
}
