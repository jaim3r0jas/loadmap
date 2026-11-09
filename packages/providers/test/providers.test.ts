import { readFileSync } from 'node:fs'
import { fromSnapshot } from '@loadmap/core/measure'
import { describe, expect, it } from 'vitest'
import { type PullRequest, prometheus, providersFromEnv, pull } from '../src'

const recorded = (name: string) => readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')

/** A Prometheus that answers from recorded responses, by the query asked; every request is kept. */
function server(answers: Record<string, { status?: number; body: string }>) {
  const asked: { url: URL; headers: Record<string, string> }[] = []
  const fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input))
    asked.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    const a = answers[url.searchParams.get('query') ?? '']
    // as Node's fetch fails: a generic message, the reason in its cause
    if (!a)
      throw Object.assign(new TypeError(`fetch failed: ${url.href}`), {
        cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      })
    return new Response(a.body, { status: a.status ?? 200, headers: { 'content-type': 'application/json' } })
  }) as typeof globalThis.fetch
  return { fetch, asked }
}

const WINDOW = { from: '2026-11-05T10:00:00Z', to: '2026-11-05T10:25:00Z', step: 300 }

describe('prometheus', () => {
  it('reads a range as one series, leaving out NaN and Inf, with a bearer token', async () => {
    const s = server({ 'sum(x)': { body: recorded('matrix') } })
    const p = prometheus({ url: 'https://prom.example/sub', token: 't0ken', fetch: s.fetch })
    expect(await p.read({ query: 'sum(x)', ...WINDOW })).toEqual({
      points: [
        [1793872800, 100],
        [1793873100, 200],
        [1793873700, 400],
        [1793874300, 600],
      ],
    })
    const { url, headers } = s.asked[0]!
    expect(url.origin + url.pathname).toBe('https://prom.example/sub/api/v1/query_range')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: 'sum(x)',
      start: WINDOW.from,
      end: WINDOW.to,
      step: '300',
    })
    expect(headers.authorization).toBe('Bearer t0ken')
  })

  it('moves a user and password in the address into the header, out of every URL it asks', async () => {
    const s = server({ q: { body: recorded('matrix') } })
    await prometheus({ url: 'https://ops:p%40ss@prom.example/', fetch: s.fetch }).read({ query: 'q', ...WINDOW })
    expect(s.asked[0]!.url.href).toMatch(/^https:\/\/prom\.example\/api\/v1\/query_range\?/)
    expect(s.asked[0]!.headers.authorization).toBe(`Basic ${btoa('ops:p@ss')}`)
  })

  it('takes basic auth without a token', async () => {
    const s = server({ q: { body: recorded('matrix') } })
    await prometheus({ url: 'http://prom:9090', user: 'ops', password: 'pw', fetch: s.fetch }).read({
      query: 'q',
      ...WINDOW,
    })
    expect(s.asked[0]!.headers.authorization).toBe(`Basic ${btoa('ops:pw')}`)
  })

  it('answers with why, never throws, and never repeats the address or a credential', async () => {
    const s = server({
      empty: { body: recorded('empty') },
      several: { body: recorded('several') },
      bad: { status: 400, body: recorded('bad-query') },
      denied: { status: 401, body: 'Unauthorized' },
    })
    const p = prometheus({ url: 'https://user:secret@prom.example', token: 'secret', fetch: s.fetch })
    const read = (query: string) => p.read({ query, ...WINDOW })
    const answers = await Promise.all(['empty', 'several', 'bad', 'denied', 'unreachable'].map(read))
    expect(answers).toEqual([
      { error: 'the query returned no series' },
      { error: 'the query returned 2 series: sum them into one' },
      { error: "Prometheus answered 400: 1:5: parse error: unexpected right parenthesis ')'" },
      { error: 'Prometheus answered 401' },
      { error: 'Prometheus cannot be reached (ECONNREFUSED)' },
    ])
    expect(JSON.stringify(answers)).not.toMatch(/secret|prom\.example/)
  })
})

describe('pull', () => {
  const requests: PullRequest[] = [
    { id: 'requests', metric: 'rate', provider: 'prometheus', query: 'sum(x)', stat: 'max', unit: 'req/s' },
    { id: 'cores', provider: 'prometheus', query: 'cpu', unit: 'cores', label: 'Worker CPU' },
    { id: 'thin', provider: 'prometheus', query: 'sum(x)', min: 30, unit: 'req/s' },
    { id: 'none', provider: 'prometheus', query: 'empty', unit: 'req/s' },
    { id: 'elsewhere', provider: 'elasticsearch', query: '{}', unit: 'req/s' },
  ]
  const run = () => {
    const s = server({
      'sum(x)': { body: recorded('matrix') },
      cpu: { body: recorded('cpu') },
      empty: { body: recorded('empty') },
    })
    return pull(requests, {
      ...WINDOW,
      fetched: '2026-11-08T06:00:00Z',
      providers: providersFromEnv({ LOADMAP_PROMETHEUS_URL: 'https://prom.example' }, { fetch: s.fetch }),
    })
  }

  it('writes a snapshot: each value by its stat, its points and its origin, or why there is none', async () => {
    const snap = await run()
    const m = snap.measurements
    expect(m.requests).toMatchObject({ unit: 'req/s', value: 600, origin: { samples: 4, stat: 'max', metric: 'rate' } })
    expect(m.requests?.series).toHaveLength(4)
    expect(m.cores).toMatchObject({ label: 'Worker CPU', value: 0.555 })
    expect(m.thin).toMatchObject({ missing: '4 of at least 30 samples', origin: { samples: 4, min: 30 } })
    expect(m.none?.missing).toBe('the query returned no series')
    expect(m.elsewhere?.missing).toBe('no elasticsearch is configured')
    expect([snap.fetched, snap.from, snap.to]).toEqual(['2026-11-08T06:00:00Z', WINDOW.from, WINDOW.to])
    // the reader takes it as it is: a fit from the two series
    expect(fromSnapshot(snap).unread('cores')).toBeNull()
  })

  it('writes the same snapshot from the same answers', async () => {
    expect(JSON.stringify(await run())).toBe(JSON.stringify(await run()))
  })

  it('configures only what the environment names', () => {
    expect(Object.keys(providersFromEnv({}))).toEqual([])
    expect(Object.keys(providersFromEnv({ LOADMAP_PROMETHEUS_URL: 'http://p:9090' }))).toEqual(['prometheus'])
  })
})
