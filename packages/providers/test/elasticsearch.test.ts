import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { elasticsearch, providersFromEnv, pull } from '../src'

const recorded = (name: string) => readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')

/** A cluster that answers from recorded responses, by the index asked; every request is kept with its body. */
function cluster(answers: Record<string, { status?: number; body: string }>) {
  const asked: { url: URL; init: RequestInit; body: any }[] = []
  const fetch = (async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input))
    asked.push({ url, init, body: JSON.parse(String(init.body)) })
    const index = decodeURIComponent(url.pathname.split('/').at(-2) ?? '')
    const a = answers[index]
    if (!a)
      throw Object.assign(new TypeError(`fetch failed: ${url.href}`), {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
      })
    return new Response(a.body, { status: a.status ?? 200, headers: { 'content-type': 'application/json' } })
  }) as typeof globalThis.fetch
  return { fetch, asked }
}

const WINDOW = { from: '2026-11-05T10:00:00Z', to: '2026-11-05T10:20:00Z', step: 300 }
const request = (o: Record<string, unknown>) =>
  JSON.stringify({ index: 'logs-*', time: '@timestamp', agg: 'rate', ...o })

describe('elasticsearch', () => {
  it('reads documents per second as a date histogram at the step, with an API key', async () => {
    const c = cluster({ 'logs-*': { body: recorded('search-counts') } })
    const es = elasticsearch({ url: 'https://search.example/es', apiKey: 'k3y', fetch: c.fetch })
    const filter = { term: { service: 'api' } }
    expect(await es.read({ query: request({ query: filter }), ...WINDOW })).toEqual({
      points: [
        [1793872800, 1],
        [1793873100, 2],
        [1793873400, 0],
        [1793873700, 2],
      ],
    })
    const { url, init, body } = c.asked[0]!
    expect(url.href).toBe('https://search.example/es/logs-*/_search')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('ApiKey k3y')
    const from = Date.parse(WINDOW.from)
    const to = Date.parse(WINDOW.to)
    expect(body).toEqual({
      size: 0,
      track_total_hits: false,
      query: { bool: { filter: [{ range: { '@timestamp': { gte: from, lt: to, format: 'epoch_millis' } } }, filter] } },
      aggs: {
        t: {
          date_histogram: {
            field: '@timestamp',
            fixed_interval: '300s',
            min_doc_count: 0,
            offset: '0s',
            extended_bounds: { min: from, max: to - 300_000 },
          },
        },
      },
    })
  })

  it('counts per step, or aggregates a field, leaving out the steps with no value', async () => {
    const c = cluster({ 'logs-*': { body: recorded('search-counts') }, traces: { body: recorded('search-avg') } })
    const es = elasticsearch({ url: 'http://es:9200', user: 'ops', password: 'pw', fetch: c.fetch })
    const count = await es.read({ query: request({ agg: 'count' }), ...WINDOW })
    expect('points' in count && count.points.map((p) => p[1])).toEqual([300, 600, 0, 600])
    const avg = await es.read({
      query: request({ index: 'traces', agg: 'avg', field: 'duration_ms', time: 'ts' }),
      ...WINDOW,
    })
    expect(avg).toEqual({
      points: [
        [1793872800, 41.5],
        [1793873400, 52.25],
      ],
    })
    const body = c.asked[1]!.body
    expect(body.aggs.t.aggs).toEqual({ v: { avg: { field: 'duration_ms' } } })
    expect(body.aggs.t.date_histogram.field).toBe('ts')
    expect((c.asked[0]!.init.headers as Record<string, string>).authorization).toBe(`Basic ${btoa('ops:pw')}`)
  })

  it('answers with why, never throws, and never repeats the address or a credential', async () => {
    const c = cluster({
      quiet: { body: recorded('search-none') },
      partial: { body: recorded('search-partial') },
      'logs-x': { status: 404, body: recorded('index-missing') },
      denied: { status: 401, body: '{"error":"unauthorized"}' },
    })
    const es = elasticsearch({ url: 'https://ops:secret@search.example', fetch: c.fetch })
    const read = (index: string) => es.read({ query: request({ index }), ...WINDOW })
    const answers = await Promise.all(['quiet', 'partial', 'logs-x', 'denied', 'gone', '..', 'a/b'].map(read))
    expect(answers).toEqual([
      { error: 'no document matches the query in the window' },
      { error: '3 of 6 shards failed' },
      { error: 'Elasticsearch answered 404: index_not_found_exception: no such index [logs-x]' },
      { error: 'Elasticsearch answered 401: unauthorized' },
      { error: 'Elasticsearch cannot be reached (ENOTFOUND)' },
      { error: 'the index is not a name or a pattern' },
      { error: 'the index is not a name or a pattern' },
    ])
    expect(JSON.stringify(answers)).not.toMatch(/secret|search\.example/)
    // the user and password went into the header, out of the URL asked
    expect(c.asked[0]!.url.href).toBe('https://search.example/quiet/_search')
    expect(await es.read({ query: 'sum(x)', ...WINDOW })).toEqual({
      error: 'the query is not an Elasticsearch request loadmap wrote',
    })
  })

  it('lines its steps up with the window, and refuses a window shorter than a step', async () => {
    const c = cluster({ 'logs-*': { body: recorded('search-counts') } })
    const es = elasticsearch({ url: 'https://search.example', fetch: c.fetch })
    // 10:03 is 180 s past the 7-minute grid of the epoch
    await es.read({ query: request({}), from: '2026-11-05T10:03:00Z', to: '2026-11-05T11:03:00Z', step: 420 })
    expect(c.asked[0]!.body.aggs.t.date_histogram.offset).toBe(`${(Date.parse('2026-11-05T10:03:00Z') / 1000) % 420}s`)
    expect(await es.read({ query: request({}), from: WINDOW.from, to: '2026-11-05T10:01:00Z', step: 300 })).toEqual({
      error: 'the window is shorter than a step',
    })
  })

  it('keeps an index across clusters as the path, never as a URL of its own', async () => {
    const c = cluster({ 'remote:logs-*': { body: recorded('search-counts') } })
    await elasticsearch({ url: 'https://search.example', fetch: c.fetch }).read({
      query: request({ index: 'remote:logs-*' }),
      ...WINDOW,
    })
    expect(c.asked[0]!.url.href).toBe('https://search.example/remote:logs-*/_search')
  })

  it('pulls beside Prometheus, each from its own environment', async () => {
    const c = cluster({ 'logs-*': { body: recorded('search-counts') } })
    const providers = providersFromEnv(
      { LOADMAP_ELASTICSEARCH_URL: 'https://search.example', LOADMAP_ELASTICSEARCH_API_KEY: 'k3y' },
      { fetch: c.fetch },
    )
    expect(Object.keys(providers)).toEqual(['elasticsearch'])
    // an address set for a provider this pull does not use cannot fail it
    expect(() => providersFromEnv({ LOADMAP_ELASTICSEARCH_URL: 'not a url' })).toThrow(/not a URL/)
    expect(providersFromEnv({ LOADMAP_ELASTICSEARCH_URL: 'not a url' }, { only: ['prometheus'] })).toEqual({})
    const snap = await pull(
      [
        { id: 'logins', provider: 'elasticsearch', query: request({}), stat: 'max', unit: 'logins/s' },
        { id: 'requests', provider: 'prometheus', query: 'sum(x)', unit: 'req/s' },
      ],
      { ...WINDOW, fetched: '2026-11-08T06:00:00Z', providers },
    )
    expect(snap.measurements.logins).toMatchObject({ value: 2, origin: { provider: 'elasticsearch', samples: 4 } })
    expect(snap.measurements.requests?.missing).toBe('no prometheus is configured')
  })
})
