import type { Explorer } from '@loadmap/providers'
import { describe, expect, it } from 'vitest'
import { explore } from '../src/explore'

const store: Explorer = {
  id: 'prometheus',
  search: async () => ({ metrics: [{ name: 'http_requests_total', type: 'counter', help: 'Requests served' }] }),
  labels: async () => ({ series: 3, labels: [{ name: 'job', values: [{ value: 'checkout', series: 2 }] }] }),
  try: async () => ({ series: 1, samples: 240, mean: 12.5, max: 30, p95: 28 }),
}

async function run(argv: string[], o: { explorer?: Explorer } = { explorer: store }) {
  const lines: string[] = []
  const code = await explore(argv, {
    log: (s) => lines.push(s),
    env: {},
    now: () => new Date('2026-11-22T00:00:00Z'),
    ...o,
  })
  return { code, out: lines.join('\n') }
}

describe('loadmap explore', () => {
  it('searches, reads labels and tries a query, as an assistant would read them', async () => {
    expect((await run(['search', 'http', 'requests'])).out).toContain('http_requests_total (counter): Requests served')
    expect((await run(['labels', 'http_requests_total'])).out).toContain('job: checkout (2)')
    const t = await run(['try', 'sum(rate(http_requests_total[5m]))', '--window', '6h'])
    expect(t.out).toContain('try over 6h sum(rate(http_requests_total[5m])):')
    expect(t.out).toContain('mean 12.5, max 30, p95 28')
  })

  it('says how it is used, and that a store must be set', async () => {
    expect((await run(['look', 'x'])).code).toBe(2)
    expect((await run(['try', 'up', '--window', '6 hours'])).out).toContain('--window is minutes, hours or days')
    expect((await run(['search', 'x', '--provider', 'elasticsearch'])).out).toBe(
      '--provider is prometheus: the one store that can be explored yet',
    )
    // a refusal is printed, and the exit code says it came
    const refusing: Explorer = { ...store, search: async () => ({ error: 'Prometheus cannot be reached' }) }
    const refused = await run(['search', 'x'], { explorer: refusing })
    expect([refused.code, refused.out]).toEqual([1, 'search x:\n  Prometheus cannot be reached'])
    const none = await run(['search', 'x'], {})
    expect([none.code, none.out]).toEqual([
      2,
      'loadmap explore: no prometheus to read: set LOADMAP_PROMETHEUS_URL (and its token or user)',
    ])
  })
})
