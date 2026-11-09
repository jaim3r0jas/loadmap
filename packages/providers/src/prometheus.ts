import type { TimeSeries } from '@loadmap/core'
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
  // a user and password in the address go in the header: fetch refuses them in a URL, and repeats the URL saying so
  let base: URL
  try {
    base = new URL(o.url.endsWith('/') ? o.url : `${o.url}/`)
  } catch {
    // never the text itself: it may hold a password
    throw new Error('loadmap: the Prometheus address is not a URL')
  }
  const user = o.user ?? (base.username ? decodeURIComponent(base.username) : undefined)
  const password = o.password ?? decodeURIComponent(base.password)
  base.username = ''
  base.password = ''
  const headers: Record<string, string> = { accept: 'application/json' }
  if (o.token) headers.authorization = `Bearer ${o.token}`
  else if (user != null) headers.authorization = `Basic ${btoa(`${user}:${password}`)}`
  return {
    id: 'prometheus',
    async read(q: ProviderQuery): Promise<ProviderResult> {
      const url = new URL('api/v1/query_range', base)
      url.search = new URLSearchParams({ query: q.query, start: q.from, end: q.to, step: String(q.step) }).toString()
      let res: Response
      try {
        res = await get(url, { headers })
      } catch (err) {
        // the code, never the message: a message may name the host or worse
        const code = (err as { cause?: { code?: unknown } })?.cause?.code
        return { error: `Prometheus cannot be reached${typeof code === 'string' ? ` (${code})` : ''}` }
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
