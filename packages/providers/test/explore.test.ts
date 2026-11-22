import { describe, expect, it } from 'vitest'
import { explorersFromEnv, prometheusExplorer, runExplore } from '../src'

/** A Prometheus that answers from a table: path → the `data` it returns. */
function fake(table: Record<string, unknown>, seen: URL[] = []) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    seen.push(url)
    expect((init?.headers as Record<string, string>)?.authorization).toBe('Bearer t0k3n')
    const data = table[url.pathname]
    if (data === undefined) return new Response(JSON.stringify({ status: 'error', error: 'not here' }), { status: 400 })
    return new Response(JSON.stringify({ status: 'success', data }), { status: 200 })
  }
}

const NAMES = ['http_requests_total', 'shop_requests_total', 'shop_worker_cpu_cores', 'node_cpu_seconds_total', 'up']
const now = new Date('2026-11-21T12:00:00Z')

describe('exploring a metrics store', () => {
  it('finds the metric names that hold the most of the words, shortest first', async () => {
    const explorer = prometheusExplorer({
      url: 'http://prom.example:9090',
      token: 't0k3n',
      fetch: fake({ '/api/v1/label/__name__/values': NAMES, '/api/v1/metadata': {} }),
    })
    const names = async (w: string) => {
      const r = await explorer.search(w)
      return 'error' in r ? r : r.metrics.map((m) => m.name)
    }
    expect(await names('shop requests')).toEqual(['shop_requests_total'])
    expect(await names('cpu')).toEqual(['shop_worker_cpu_cores', 'node_cpu_seconds_total'])
    expect(await names('!')).toEqual([])
  })

  it('searches, reads labels and tries a query, read only, and says it as a model reads it', async () => {
    const seen: URL[] = []
    const explorer = prometheusExplorer({
      url: 'http://prom.example:9090',
      token: 't0k3n',
      fetch: fake(
        {
          '/api/v1/label/__name__/values': NAMES,
          '/api/v1/metadata': {
            shop_requests_total: [{ type: 'counter', help: 'Requests the shop served', unit: '' }],
          },
          '/api/v1/series': [
            { __name__: 'shop_requests_total', service: 'web', pod: 'a' },
            { __name__: 'shop_requests_total', service: 'web', pod: 'b' },
            { __name__: 'shop_requests_total', service: 'checkout', pod: 'c' },
          ],
          '/api/v1/query_range': {
            resultType: 'matrix',
            result: [
              {
                values: [
                  [1, '10'],
                  [2, '20'],
                  [3, '30'],
                  [4, 'NaN'],
                ],
              },
            ],
          },
        },
        seen,
      ),
    })
    const text = await runExplore(
      explorer,
      [
        { tool: 'search', arg: 'shop requests' },
        { tool: 'labels', arg: 'shop_requests_total' },
        { tool: 'try', arg: 'sum(rate(shop_requests_total[1m]))', window: '6h' },
      ],
      { now },
    )
    expect(text).toBe(
      [
        'search shop requests:',
        '  shop_requests_total (counter): Requests the shop served',
        'labels shop_requests_total:',
        '  3 series',
        // the labels a query selects on first: the fewest values
        '  service: web (2), checkout (1)',
        '  pod: a (1), b (1), c (1)',
        'try over 6h sum(rate(shop_requests_total[1m])):',
        '  1 series, 3 samples, mean 20, max 30, p95 30',
      ].join('\n'),
    )
    // nothing but reads, and never the address in what the model reads
    expect(seen.every((u) => u.pathname.startsWith('/api/v1/'))).toBe(true)
    expect(text).not.toContain('prom.example')
    const range = seen.find((u) => u.pathname === '/api/v1/query_range')!
    expect(range.searchParams.get('start')).toBe('2026-11-21T06:00:00.000Z')
  })

  it('refuses what is no metric name, a window over a day, and more than five calls a round', async () => {
    const explorer = prometheusExplorer({ url: 'http://prom.example:9090', token: 't0k3n', fetch: fake({}) })
    expect(await explorer.labels('up{job="x"}', { from: '2026-11-21T11:00:00Z', to: '2026-11-21T12:00:00Z' })).toEqual({
      error: '"up{job="x"}" is no metric name',
    })
    expect(await explorer.try('up', { from: '2026-11-19T00:00:00Z', to: '2026-11-21T12:00:00Z', step: 60 })).toEqual({
      error: 'a window is at most 24 h',
    })
    const many = Array.from({ length: 7 }, () => ({ tool: 'search' as const, arg: 'x' }))
    expect(await runExplore(explorer, many, { now })).toContain('(2 more calls were not run: at most 5 a round)')
    // a week is refused, never read as a day and called a week; a window that is none says so
    const long = await runExplore(explorer, [{ tool: 'try', arg: 'up', window: '7d' }], { now })
    expect(long).toBe('try over 7d up:\n  a window is at most 24 h')
    const odd = await runExplore(explorer, [{ tool: 'try', arg: 'up', window: '6 hours' }], { now })
    expect(odd).toBe('try up:\n  "6 hours" is no window: write 30m, 6h or 1d')
  })

  it('reads the store `loadmap pull` reads from the environment', () => {
    expect(Object.keys(explorersFromEnv({}))).toEqual([])
    expect(Object.keys(explorersFromEnv({ LOADMAP_PROMETHEUS_URL: 'http://p:9090' }))).toEqual(['prometheus'])
    // a store that never answers is given up on, not waited for
    const stalled = prometheusExplorer({
      url: 'http://p:9090',
      fetch: async () => {
        throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
      },
    })
    return expect(stalled.search('x')).resolves.toEqual({ error: 'Prometheus did not answer within 30 s' })
  })
})
