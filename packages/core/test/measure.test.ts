import { readFileSync, writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineModel, estimated, measured, p, pass } from '../src'
import { fitLinear } from '../src/calibrate'
import { fromSnapshot, MEASURES, type MeasureSpec, originText, parseSnapshot, summarize } from '../src/measure'

const text = readFileSync(new URL('./fixtures/snapshot.json', import.meta.url), 'utf8')
const snapshot = parseSnapshot(text)
const read = fromSnapshot(snapshot)
const raw = () => JSON.parse(text)

describe('parseSnapshot', () => {
  it('takes the text or the parsed JSON', () => {
    expect(parseSnapshot(raw())).toEqual(snapshot)
    expect(Object.keys(snapshot.measurements)).toEqual(['apiCapacity', 'requests', 'rate', 'cores', 'hit', 'lag'])
    expect(snapshot.measurements.hit).toEqual({ unit: 'share', missing: 'the query returned no series' })
    // too few samples: it does not count, and says why
    expect(snapshot.measurements.lag).toMatchObject({ unit: 'messages', missing: '3 of at least 30 samples' })
    expect(snapshot.measurements.lag?.value).toBeUndefined()
    expect(snapshot.measurements.requests?.source).toMatch(/^prometheus: sum\(rate/)
  })

  it('refuses what is not a snapshot, saying where', () => {
    const bad = (edit: (s: any) => void) => {
      const s = raw()
      edit(s)
      return () => parseSnapshot(s)
    }
    expect(() => parseSnapshot('{')).toThrow(/the text is not JSON/)
    expect(() => parseSnapshot([])).toThrow(/the file is not an object/)
    expect(bad((s) => (s.format = 'other'))).toThrow(/format is not "loadmap-snapshot"/)
    expect(bad((s) => (s.version = 2))).toThrow(/version is 2, not 1/)
    expect(bad((s) => (s.fetched = 'yesterday'))).toThrow(/fetched is not an ISO 8601 instant: "yesterday"/)
    expect(bad((s) => (s.measurements.requests.value = Number.NaN))).toThrow(
      /measurements\["requests"\].value is not a finite number/,
    )
    expect(bad((s) => (s.measurements.requests.value = '110'))).toThrow(/value is not a finite number/)
    expect(bad((s) => delete s.measurements.requests.origin)).toThrow(/has a value but no origin/)
    expect(bad((s) => (s.measurements.requests.origin.samples = -1))).toThrow(/samples is not a whole number from 0/)
    expect(bad((s) => (s.measurements.requests.origin.stat = 'p42'))).toThrow(/stat is not one of mean/)
    expect(bad((s) => (s.measurements.requests.origin.step = 0))).toThrow(/step is not a number of seconds above 0/)
    expect(bad((s) => (s.measurements.rate.series[2] = [1, 2, 3]))).toThrow(/series\[2\] is not a \[time, value\] pair/)
    expect(bad((s) => (s.measurements.rate.series[2] = [1, null]))).toThrow(/series\[2\]/)
  })

  it('keeps a name like __proto__ as data, and finds nothing by an inherited name', () => {
    const s = parseSnapshot(
      `{"format":"loadmap-snapshot","version":1,"fetched":"2026-11-08T06:00:00Z","from":"2026-11-01T00:00:00Z","to":"2026-11-08T00:00:00Z","measurements":{"__proto__":{"missing":"x","polluted":true}}}`,
    )
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.keys(s.measurements)).toEqual(['__proto__'])
    expect(fromSnapshot(s).unread('constructor')).toBe('"constructor" is not in the snapshot')
    expect(fromSnapshot(s).unread('__proto__')).toBe('x')
  })
})

describe('summarize', () => {
  const points = [
    [3, 30],
    [1, 10],
    [4, 40],
    [2, 20],
  ] as const
  it('turns a window into one value', () => {
    expect(summarize(points, 'mean')).toBe(25)
    expect(summarize(points, 'min')).toBe(10)
    expect(summarize(points, 'max')).toBe(40)
    expect(summarize(points, 'last')).toBe(40)
    expect(summarize(points, 'p50')).toBe(25)
    // rank 0.95 × 3 = 2.85: 30 + 0.85 × (40 − 30)
    expect(summarize(points, 'p95')).toBeCloseTo(38.5)
    expect(summarize([[0, 7]], 'p99')).toBe(7)
    // 30 days at a 15 s step: more points than a call takes arguments
    const month = Array.from({ length: 172_800 }, (_, i) => [i * 15, i] as const)
    expect([summarize(month, 'min'), summarize(month, 'max')]).toEqual([0, 172_799])
    expect(() => summarize([], 'mean')).toThrow(/at least one point/)
  })
})

describe('fromSnapshot', () => {
  it('reads a capacity as measured, with its origin as the source', () => {
    const c = read.capacity('apiCapacity', estimated(1000, 'req/s', { source: 'vendor benchmark', within: 0.2 }))
    // the fallback's ± was about the guess
    expect(c).toMatchObject({ value: 1200, unit: 'req/s', provenance: 'measured' })
    expect(c.within).toBeUndefined()
    expect(c.origin?.metric).toBe('served')
    expect(c.source).toBe(
      'prometheus: max_over_time(sum(rate(http_requests_total{job="api"}[5m]))[7d:5m]), 2026-11-01 to 2026-11-08, every 5 min, 2016 samples, max',
    )
    // a wrong unit in the file is a reading that does not count, not a page that fails
    expect(read.capacity('apiCapacity', measured(1, 'orders/s'))).toMatchObject({
      value: 1,
      unread: '"apiCapacity" is in req/s, not orders/s',
    })
  })

  it('falls back to the definition’s value with why, never to an invented one', () => {
    const fallback = estimated(1000, 'req/s', 'vendor benchmark')
    expect(read.capacity('lag', fallback)).toEqual({ ...fallback, unread: '3 of at least 30 samples', measure: 'lag' })
    expect(read.capacity('hit', fallback).unread).toBe('the query returned no series')
    expect(read.capacity('nothing', fallback).unread).toBe('"nothing" is not in the snapshot')
    // no snapshot at all: the definition's value stands as it is, nothing is missing
    expect(fromSnapshot(undefined).capacity('apiCapacity', fallback)).toBe(fallback)
    expect(fromSnapshot(undefined).unread('apiCapacity')).toBe('no snapshot')
    expect(read.value('requests', 40)).toBe(110)
    expect(read.value('lag', 5)).toBe(5)
    expect(read.value('hit', 0.8)).toBe(0.8)
    expect(read.unread('requests')).toBeNull()
    const empty = raw()
    empty.measurements.requests.origin.samples = 0
    delete empty.measurements.requests.origin.min
    expect(fromSnapshot(parseSnapshot(empty)).value('requests', 40)).toBe(40)
    expect(fromSnapshot(parseSnapshot(empty)).unread('requests')).toBe('no samples in the window')
  })

  it('fits cost against rate from two series on the same timestamps, as fitLinear would', () => {
    const fallback = fitLinear(
      [
        { rate: 1, cores: 1 },
        { rate: 2, cores: 2 },
      ],
      { x: 'rate', y: 'cores', source: 'by hand' },
    )
    const f = read.fit('rate', 'cores', fallback)
    const rate = snapshot.measurements.rate!.series!
    const cores = snapshot.measurements.cores!.series!
    const same = fitLinear(
      rate.map(([, x], i) => ({ rate: x, cores: cores[i]![1] })),
      { x: 'rate', y: 'cores' },
    )
    expect([f.a, f.b, f.r2, f.n]).toEqual([same.a, same.b, same.r2, same.n])
    expect(f(1000)).toBeCloseTo(same(1000))
    expect(f.origin?.y.query).toContain('container_cpu_usage_seconds_total')
    expect(f.source).toMatch(/^prometheus: sum\(rate\(jobs_done_total\[5m\]\)\), .*; prometheus: sum\(rate\(container/)

    // the fallback stands in, unchanged for any other read
    const none = read.fit('requests', 'cores', fallback)
    expect(none.unread).toBe('"requests" has no series')
    expect([none.a, none.b, none(3)]).toEqual([fallback.a, fallback.b, 3])
    expect(fallback.unread).toBeUndefined()
    expect(read.fit('rate', 'hit', fallback).unread).toBe('the query returned no series')
  })
})

describe('a model with a snapshot', () => {
  afterEach(() => vi.useRealTimers())

  const model = () =>
    defineModel({
      load: p.load({ max: 100 }),
      snapshot,
      flows: { req: { rate: ({ load }) => read.value('requests', 40) * load } },
      components: {
        api: {
          name: 'API',
          capacity: read.capacity('apiCapacity', estimated(1000, 'req/s')),
          over: 'clients get 503s',
        },
        topic: {
          name: 'Topic',
          capacity: read.capacity('lag', measured(5000, 'req/s', 'load test')),
          over: 'lag grows',
        },
      },
      stages: { api: pass('api'), topic: pass('topic') },
      routes: { req: ['api', 'topic'] },
    })

  it('lists each measurement once, with its origin or why the definition’s value stands', () => {
    const ev = model().evaluate()
    const measurements = ev.assumptions.flatMap((a) =>
      a.kind === 'measurement' ? [[a.name, a.measurement.missing ?? null]] : [],
    )
    // apiCapacity is the API's capacity line already
    expect(measurements).toEqual([
      ['requests', null],
      ['rate', null],
      ['cores', null],
      ['hit', 'the query returned no series'],
      ['lag', '3 of at least 30 samples'],
    ])
    const api = ev.assumptions.find((a) => a.kind === 'capacity' && a.component === 'api')
    expect(api?.kind === 'capacity' && api.capacity.origin?.provider).toBe('prometheus')
    const topic = ev.components.topic.capacity!
    expect([topic.value, topic.provenance, topic.unread]).toEqual([5000, 'measured', '3 of at least 30 samples'])
    // 110 req/s at 1× against the 1200 measured: the target at 600
    expect(ev.components.api.target).toBeCloseTo(600 / 110)
  })

  it('says the same on any day: dates come from the snapshot', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2027-03-01T12:00:00Z'))
    const a = model().evaluate()
    vi.setSystemTime(new Date('2031-07-15T00:00:00Z'))
    const b = model().evaluate()
    expect(b.verdict).toEqual(a.verdict)
    expect(b.assumptions).toEqual(a.assumptions)
  })
})

describe('originText', () => {
  it('writes the window, the step and the samples', () => {
    const o = snapshot.measurements.requests!.origin!
    expect(originText(o)).toBe(
      'prometheus: sum(rate(http_requests_total{job="api"}[5m])), 2026-11-05 10:00–10:25, every 5 min, 6 samples, p95',
    )
    expect(originText({ ...o, step: 3600, samples: 1, stat: undefined })).toMatch(/every 1 h, 1 sample$/)
    expect(originText({ ...o, step: 15 })).toMatch(/every 15 s/)
  })
})

const START = '<!-- measures: written from MEASURES in packages/core; UPDATE_DOCS=1 pnpm test:node rewrites it -->'
const END = '<!-- end of measures -->'

/** The table of docs/dsl.md, written from MEASURES, so the two cannot drift apart. */
function table(): string {
  const out = ['| Kind | Measurement | Role | Dimension | Sets | |', '| --- | --- | --- | --- | --- | --- |']
  for (const [kind, specs] of Object.entries(MEASURES))
    for (const [key, s] of Object.entries(specs as Record<string, MeasureSpec>))
      out.push(
        `| \`${kind}\` | \`${key}\` | ${s.role} | ${s.dimension} | ${s.later ? 'not modelled yet' : s.sets ? `\`${s.sets}\`` : ''} | ${s.doc} |`,
      )
  return out.join('\n')
}

describe('MEASURES', () => {
  it('is the table in docs/dsl.md', () => {
    const file = new URL('../../../docs/dsl.md', import.meta.url)
    const doc = readFileSync(file, 'utf8')
    const [head, rest] = doc.split(START)
    const tail = rest?.slice(rest.indexOf(END) + END.length)
    expect(tail, 'docs/dsl.md lost its measures markers').toBeDefined()
    const fresh = `${head}${START}\n\n${table()}\n\n${END}${tail}`
    if (process.env.UPDATE_DOCS) writeFileSync(file, fresh)
    expect(doc, 'run UPDATE_DOCS=1 pnpm test:node to rewrite it').toBe(fresh)
  })

  it('gives every measurement a role and a dimension, and sets only what the model has', () => {
    const sets = new Set(['rate', 'capacity', 'hit', 'pods', 'perPod', 'partitions', 'share', 'held'])
    for (const specs of Object.values(MEASURES))
      for (const s of Object.values(specs as Record<string, MeasureSpec>)) {
        expect(s.dimension).not.toBe('')
        if (s.sets) expect(sets.has(s.sets)).toBe(true)
        if (s.later) expect(s.sets).toBeUndefined()
      }
  })
})
