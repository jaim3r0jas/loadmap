import { readFileSync } from 'node:fs'
import { fromSnapshot, parseSnapshot } from '@loadmap/core/measure'
import { describe, expect, it } from 'vitest'
import { compile, completions, format, hover, problems, rename } from '../src'

const SRC = `loadmap 1
title: "Shop"
load { max: 50 }

metric served "Requests served" {
  prometheus { query: 'max_over_time(sum(rate(http_requests_total{job="{{ args.job }}"}[5m]))[7d:5m])' }
  stat: max
  min: 30
}
metric rate "Jobs per second" {
  prometheus { query: "sum(rate(jobs_done_total[5m]))" }
}
metric cpu "Worker CPU" {
  prometheus { query: 'sum(rate(container_cpu_usage_seconds_total{pod=~"worker-.*"}[5m]))' }
}

measure apiCapacity served { job: "api"; fallback: estimated(1_000, "req/s", "vendor benchmark") }
measure requests rate { fallback: 40; unit: "req/s" }
measure cores cpu { fallback: 0.5; unit: "cores" }

fit workerCores "Worker CPU per request" {
  x: requests
  y: cores
  points rate cores {
    100 0.3
    200 0.4
  }
}

flow req "requests" { rate: requests * load; from: users; route: api }

node users "Users"
node api "API" {
  pass
  demand: flows.req
  capacity: apiCapacity
  over: "clients get 503s"
}

users -> api
`

const errors = (src: string) =>
  compile(src).diagnostics.map((d) => `${d.severity}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)
const swap = (a: string, b: string) => SRC.replace(a, b)
const fixture = readFileSync(new URL('../../core/test/fixtures/snapshot.json', import.meta.url), 'utf8')
const snapshot = parseSnapshot(fixture)

describe('metric and measure', () => {
  it('compiles to the fallbacks without a snapshot, and lists each query filled in', () => {
    const r = compile(SRC)
    expect(r.diagnostics).toEqual([])
    const ev = r.definition!.model.evaluate()
    expect(ev.components.api!.capacity).toMatchObject({ value: 1000, provenance: 'estimated' })
    expect(ev.flows.req).toBe(40)
    expect(r.definition!.model.def.calibration!['Worker CPU per request']!.b).toBeCloseTo(0.001)
    expect(ev.assumptions.some((a) => a.kind === 'measurement')).toBe(false)
    expect(r.measures).toEqual([
      {
        id: 'apiCapacity',
        metric: 'served',
        label: 'Requests served',
        provider: 'prometheus',
        query: 'max_over_time(sum(rate(http_requests_total{job="api"}[5m]))[7d:5m])',
        stat: 'max',
        min: 30,
        unit: 'req/s',
      },
      {
        id: 'requests',
        metric: 'rate',
        label: 'Jobs per second',
        provider: 'prometheus',
        query: 'sum(rate(jobs_done_total[5m]))',
        unit: 'req/s',
      },
      {
        id: 'cores',
        metric: 'cpu',
        label: 'Worker CPU',
        provider: 'prometheus',
        query: 'sum(rate(container_cpu_usage_seconds_total{pod=~"worker-.*"}[5m]))',
        unit: 'cores',
      },
    ])
  })

  it('reads a snapshot: measured capacities and rates, a fit from two series, each with its origin', () => {
    // the fixture names its series rate and cores; this definition reads them as requests and cores
    const text = fixture.replace('"rate": {', '"requests_series": {').replace('"requests": {', '"rate_old": {')
    const s = parseSnapshot(text.replace('"requests_series": {', '"requests": {'))
    const r = compile(SRC, { snapshot: fromSnapshot(s) })
    expect(r.diagnostics).toEqual([])
    const model = r.definition!.model
    const ev = model.evaluate()
    expect(ev.components.api!.capacity).toMatchObject({ value: 1200, provenance: 'measured' })
    expect(ev.components.api!.capacity!.source).toMatch(/^prometheus: max_over_time/)
    expect(ev.flows.req).toBe(350)
    const fit = model.def.calibration!['Worker CPU per request']!
    expect(fit.n).toBe(6)
    expect(fit.origin?.y.query).toContain('container_cpu_usage_seconds_total')
    // listed once: the capacity and the fit show their readings, and what no measure declares is left out
    const listed = ev.assumptions.flatMap((a) => (a.kind === 'measurement' ? [a.name] : []))
    expect(listed).toEqual([])
  })

  it('falls back, with why, for what the snapshot lacks', () => {
    const r = compile(SRC, { snapshot: fromSnapshot(snapshot) })
    const ev = r.definition!.model.evaluate()
    // "requests" in the fixture has no series: the fit stays on its points
    const fit = r.definition!.model.def.calibration!['Worker CPU per request']!
    expect([fit.n, fit.unread]).toEqual([2, '"requests" has no series'])
    expect(ev.flows.req).toBe(110)
    const other = swap('measure apiCapacity served { job: "api"', 'measure apiPeak served { job: "api"').replace(
      'capacity: apiCapacity',
      'capacity: apiPeak',
    )
    const cap = compile(other, { snapshot: fromSnapshot(snapshot) }).definition!.model.evaluate().components.api!
      .capacity!
    expect([cap.value, cap.unread]).toEqual([1000, '"apiPeak" is not in the snapshot'])
  })

  it('says what is wrong with a metric or a measure', () => {
    expect(errors(swap('measure requests rate {', 'measure requests rates {'))).toContain(
      'error: no metric "rates" | did you mean "rate"?',
    )
    expect(errors(swap('measure apiCapacity served { job: "api"; ', 'measure apiCapacity served { '))).toContain(
      'error: the query of "served" needs {{ args.job }} | job: "…"',
    )
    expect(errors(swap('{ job: "api"; fallback', '{ job: "api"; region: "eu"; fallback'))).toContain(
      'error: the query of "served" has no {{ args.region }}',
    )
    expect(errors(swap('measure requests rate { fallback: 40; unit: "req/s" }', 'measure requests rate {}'))).toEqual(
      expect.arrayContaining([expect.stringMatching(/fallback/)]),
    )
    expect(errors(swap('fallback: 40;', 'fallback: "forty";'))).toContain(
      'error: a fallback is a capacity or a number | fallback: estimated(1_000, "req/s", "…")',
    )
    expect(errors(swap('"vendor benchmark") }', '"vendor benchmark"); unit: "x" }'))).toContain(
      'error: a capacity has its own unit | "req/s"',
    )
    expect(errors(swap('  prometheus { query: "sum(rate(jobs_done_total[5m]))" }\n', ''))[0]).toMatch(
      /^error: a metric needs a provider to read from/,
    )
    expect(errors(swap('{{ args.job }}', '{{ job }}'))).toContain(
      'error: "{{ job }}" is not an argument | write {{ args.name }}: each measure gives name',
    )
    expect(errors(swap('  min: 30', '  min: 2.5'))).toContain('error: min is a whole number of samples from 0')
    expect(errors(swap('  y: cores\n', ''))).toContain(
      'error: a fit reads its series from two measures: x and y | x: rate; y: cores',
    )
    expect(errors(swap('  y: cores', '  y: workerCores'))).toContain('error: "workerCores" is not a measure')
    expect(errors(swap('{{ args.job }}', '{{ {{ args.job }}'))).toContain(
      'error: "{{ {{ args.job }}" is not an argument | write {{ args.name }}: each measure gives name',
    )
    // a metric no measure uses yet is checked all the same
    expect(errors(`${SRC}metric unused { min: -3 }\n`)).toEqual([
      'error: a metric needs a provider to read from | e.g. prometheus { query: "sum(rate(http_requests_total[5m]))" }',
    ])
  })

  it('lists a number the snapshot lacks as missing, with why', () => {
    const src = swap('measure cores cpu', 'measure coresNow cpu').replace('  y: cores', '  y: coresNow')
    const ev = compile(src, { snapshot: fromSnapshot(snapshot) }).definition!.model.evaluate()
    const cores = ev.assumptions.find((a) => a.kind === 'measurement' && a.name === 'coresNow')
    expect(cores?.kind === 'measurement' && cores.measurement).toEqual({
      unit: 'cores',
      missing: '"coresNow" is not in the snapshot',
    })
  })

  it('is laid out by format, renamed everywhere, completed and hovered', () => {
    expect(format(SRC).text).toBe(SRC)
    const at = SRC.indexOf('requests rate')
    const renamed = rename(SRC, at, 'jobs')
    expect('source' in renamed && renamed.source).toContain('rate: jobs * load')
    expect('source' in renamed && renamed.source).toContain('x: jobs')
    const metricAt = SRC.indexOf('metric rate') + 'metric '.length
    const m = rename(SRC, metricAt, 'jobRate')
    expect('source' in m && m.source).toContain('measure requests jobRate {')

    const inArgs = SRC.indexOf('job: "api"')
    expect(completions(SRC, inArgs).options.map((c) => c.label)).toContain('job')
    const inX = SRC.indexOf('x: requests') + 3
    expect(completions(SRC, inX).options.map((c) => c.label)).toEqual(expect.arrayContaining(['requests', 'cores']))
    expect(hover(SRC, inArgs)?.body.join(' ')).toMatch(/fills `\{\{ args\.job \}\}`/)
    const r = compile(SRC)
    const onCapacity = hover(SRC, SRC.indexOf('capacity: apiCapacity') + 12, r.definition)
    expect(onCapacity?.body.at(-1)).toBe('1,000 req/s, its fallback.')
    expect(hover(SRC, SRC.indexOf('x: requests') + 4, r.definition)?.body.at(-1)).toBe('40 at the defaults.')
    expect(hover(SRC, SRC.indexOf('metric served') + 8)?.body.at(-1)).toBe('Measured by `apiCapacity`.')
  })
})

describe('an elasticsearch metric', () => {
  const ES = `loadmap 1
load { max: 50 }

metric logins "Logins" {
  elasticsearch { index: "auth-*"; query: '{"term": {"service": "{{ args.service }}"}}'; agg: rate }
  stat: p95
}
metric latency "Latency" {
  elasticsearch { index: "traces"; agg: avg; field: "duration_ms"; time: "ts" }
}

measure loginRate logins { service: "web \\"edge\\""; fallback: 12; unit: "logins/s" }
measure slow latency { fallback: 40; unit: "ms" }

flow req "logins" { rate: loginRate * load; from: users; route: api }

node users "Users"
node api "API" {
  pass
  demand: flows.req
  capacity: estimated(100, "logins/s")
  over: "logins wait"
}

users -> api
`
  const esErrors = (a: string, b: string) =>
    compile(ES.replace(a, b)).diagnostics.map((d) => `${d.severity}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)

  it('writes its request as one JSON text, an argument escaped inside the query', () => {
    const r = compile(ES)
    expect(r.diagnostics).toEqual([])
    expect(r.measures.map((m) => [m.id, m.provider, JSON.parse(m.query)])).toEqual([
      [
        'loginRate',
        'elasticsearch',
        { index: 'auth-*', time: '@timestamp', agg: 'rate', query: { term: { service: 'web "edge"' } } },
      ],
      ['slow', 'elasticsearch', { index: 'traces', time: 'ts', agg: 'avg', field: 'duration_ms' }],
    ])
    expect(format(ES).text).toBe(ES)
  })

  it('says what is wrong with its request', () => {
    expect(esErrors('agg: avg; field: "duration_ms"; ', 'agg: avg; ')).toContain(
      'error: avg reads a field | field: "duration_ms"',
    )
    expect(esErrors('agg: rate }', 'agg: rate; field: "x" }')).toContain(
      'error: rate counts documents: it takes no field',
    )
    expect(esErrors(`'{"term": {"service": "{{ args.service }}"}}'`, `'{"term": {{ args.service }}}'`)[0]).toMatch(
      /^error: the query is Elasticsearch query JSON/,
    )
    expect(esErrors('index: "traces"', 'index: "traces/../x"')).toContain(
      'error: an index is a name or a pattern | "logs-*", or names joined by commas',
    )
    expect(esErrors('agg: avg', 'agg: median')[0]).toMatch(/median/)
    expect(esErrors('index: "traces"', 'index: "a,,b"')).toContain(
      'error: an index is a name or a pattern | "logs-*", or names joined by commas',
    )
    // an argument in the index is a pattern
    const env = ES.replace('index: "traces"', 'index: "traces-{{ args.env }}"').replace(
      'measure slow latency {',
      'measure slow latency { env: "prod";',
    )
    expect(compile(env).diagnostics).toEqual([])
    expect(JSON.parse(compile(env).measures[1]!.query).index).toBe('traces-prod')
    expect(esErrors('  stat: p95\n', '  stat: p95\n  prometheus { query: "x" }\n')).toContain(
      'error: a metric reads from one provider | e.g. prometheus { query: "sum(rate(http_requests_total[5m]))" }',
    )
  })
})

describe('expect outcomes in the language', () => {
  const src = (expectLine: string) =>
    SRC.replace('flow req "requests"', `${expectLine}\nflow req "requests"`).replace(
      'fallback: estimated(1_000, "req/s", "vendor benchmark")',
      'fallback: estimated(1_000 ± 30%, "req/s", "vendor benchmark")',
    )
  const lines = (text: string, failed: 'warning' | 'error' = 'error', unsure: 'warning' | 'error' = 'warning') =>
    problems(compile(text), failed, unsure).map((d) => `${d.severity}: ${d.message}`)

  it('marks a warning-level expect as a warning, and an inconclusive one with why', () => {
    // 40 req/s against 1,000 ± 30 %: the target between 8.75× and 16.25×
    expect(lines(src('expect "Soft" { target: 30; severity: warn }'))).toEqual([
      'warning: "Soft" fails: expected at least 30×, but the 50 % target holds up to between 8.7× and 16×, limited by API (capacity estimated ±30 %)',
    ])
    expect(lines(src('expect "Edge" { target: 10 }'))).toEqual([
      'warning: "Edge" is inconclusive: holds at 10× only at the high edge of a ±; expected at least 10×, but the 50 % target holds up to between 8.7× and 16×, limited by API (capacity estimated ±30 %)',
    ])
    expect(lines(src('expect "Edge" { target: 10 }'), 'error', 'error')[0]).toMatch(/^error: "Edge" is inconclusive/)
    expect(errors(src('expect { target: 5; severity: maybe }'))[0]).toMatch(/maybe/)
    expect(lines(src('expect { target: 10 }'))[0]).toMatch(/^warning: inconclusive: holds at 10× only at the high edge/)
  })
})
