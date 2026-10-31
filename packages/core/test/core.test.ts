import { describe, expect, it } from 'vitest'
import {
  around,
  compare,
  dateAt,
  defineModel,
  estimated,
  growth,
  headroom,
  measured,
  multiple,
  niceStep,
  p,
  parseAsOf,
  pass,
} from '../src'
import { fitLinear } from '../src/calibrate'

const tiny = (over: Partial<Parameters<typeof defineModel>[0]> = {}) =>
  defineModel({
    load: p.load({ max: 100 }),
    flows: { req: { rate: ({ load }: any) => 100 * load } },
    components: {
      api: { name: 'API', demand: ({ flows }: any) => flows.req, capacity: measured(1000, 'req/s'), over: 'x' },
    },
    stages: { api: pass('api') },
    routes: { req: ['api'] },
    ...over,
  } as any)

describe('fitLinear', () => {
  it('recovers a and b from noisy data', () => {
    let s = 1
    const noise = () => {
      s = (s * 16807) % 2147483647
      return (s / 2147483647 - 0.5) * 0.02
    }
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i * 10, y: 3 + 0.25 * i * 10 + noise() }))
    const fit = fitLinear(pts, { x: 'x', y: 'y' })
    expect(fit.a).toBeCloseTo(3, 1)
    expect(fit.b).toBeCloseTo(0.25, 3)
    expect(fit.r2).toBeGreaterThan(0.999)
    expect(fit(100)).toBeCloseTo(28, 1)
    expect(fit.provenance).toBe('measured')
  })

  it('can fit through the origin', () => {
    const fit = fitLinear(
      [
        { r: 1, c: 2 },
        { r: 2, c: 4 },
      ],
      { x: 'r', y: 'c', through: 'origin' },
    )
    expect([fit.a, fit.b]).toEqual([0, 2])
  })

  it('refuses a series without two distinct x values', () => {
    expect(() => fitLinear([{ x: 1, y: 1 }], { x: 'x', y: 'y' })).toThrow(/two distinct/)
  })
})

describe('model', () => {
  it('evaluates lazily and lets functions read each other', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { req: { rate: ({ load }) => 100 * load } },
      derived: { slow: ({ util }) => ((util.cache ?? 0) > 0.7 ? 2 : 1) },
      components: {
        cache: { name: 'Cache', demand: ({ flows }) => flows.req, capacity: measured(1000, 'ops/s'), over: 'x' },
        app: {
          name: 'App',
          demand: ({ flows, derived }) => flows.req * derived.slow,
          capacity: measured(2000, 'req/s'),
          over: 'y',
        },
      },
      stages: { app: pass('app') },
      routes: { req: ['app'] },
    })
    expect(m.evaluate({ load: 5 }).components.app.util).toBeCloseTo(0.25)
    expect(m.evaluate({ load: 8 }).components.app.util).toBeCloseTo(0.8)
  })

  it('names a loop instead of overflowing the stack', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { req: { rate: ({ util }) => (util.a ?? 0) * 10 } },
      components: { a: { name: 'A', demand: ({ flows }) => flows.req, capacity: measured(1, 'x'), over: '' } },
      stages: { a: pass('a') },
      routes: { req: ['a'] },
    })
    expect(() => m.evaluate()).toThrow('utilization of a → demand of a → flow req → utilization of a is a loop')
  })

  it('leaves a switched-off component out of the limits and the verdict', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      params: { cache: p.switch({ label: 'Cache', default: false }) },
      flows: { req: { rate: ({ load }) => load } },
      components: {
        cache: {
          name: 'Cache',
          when: ({ cache }) => cache,
          demand: ({ flows }) => flows.req,
          capacity: estimated(1, 'x'),
          over: '',
        },
        app: { name: 'App', demand: ({ flows }) => flows.req, capacity: measured(100, 'x'), over: '' },
      },
      stages: { app: pass('app') },
      routes: { req: ['app'] },
    })
    const s = m.evaluate({ load: 5 })
    expect(s.components.cache).toMatchObject({ util: null, state: 'off', target: null, full: null })
    expect(s.firstLimit?.id).toBe('app')
    expect(s.ranked.at(-1)?.id).toBe('cache')
  })

  it('ranks a switched-off component after a live one that never reaches the target', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { req: { rate: ({ load }) => load } },
      components: {
        off: { name: 'Off', when: () => false, demand: () => 1, capacity: measured(1, 'x'), over: '' },
        idle: { name: 'Idle', demand: () => 0, capacity: measured(1, 'x'), over: '' },
        busy: { name: 'Busy', demand: ({ flows }) => flows.req, capacity: measured(10, 'x'), over: '' },
      },
      stages: { busy: pass('busy') },
      routes: { req: ['busy'] },
    })
    expect(m.evaluate().ranked.map((c) => c.id)).toEqual(['busy', 'idle', 'off'])
  })

  it('finds the first crossing of a utilization that does not rise steadily', () => {
    // rises to 0.6 at 5×, falls back, crosses 0.5 for good only past 50×
    const m = tiny({
      components: {
        api: {
          name: 'API',
          demand: ({ load }: any) => (load < 5 ? load * 120 : load < 10 ? 600 - (load - 5) * 100 : load * 10),
          capacity: measured(1000, 'x'),
          over: '',
        },
      },
    })
    expect(m.evaluate().components.api?.target).toBeCloseTo(500 / 120, 6)
  })

  it('rejects a reserved parameter name and a route through an unknown stage', () => {
    expect(() => tiny({ params: { flows: p.switch({ label: 'x', default: true }) } } as any)).toThrow(/reserved/)
    expect(() => tiny({ routes: { req: ['nope'] } } as any)).toThrow(/unknown stage "nope"/)
  })

  it('treats a select default outside its options as a mistake', () => {
    expect(() => p.select({ label: 'Pods', options: [1, 2], default: 3 as 1 })).toThrow(/not an option/)
  })
})

describe('format', () => {
  it('rounds multiples down and names the search bound', () => {
    expect([multiple(2.69), multiple(53.9), multiple(Number.POSITIVE_INFINITY), multiple(null)]).toEqual([
      '2.6×',
      '53×',
      'beyond 2,000×',
      '—',
    ])
  })
  it('steps 1-2-5', () => {
    expect([1, 3, 7, 12, 34, 51].map(niceStep)).toEqual([1, 5, 10, 20, 50, 100])
  })
})

/** Bisection lands within 1e-12 of a crossing: compare to 6 places. */
const round = (x: number | null) => (x == null ? x : Number(x.toFixed(6)))

// the API carries 100 req/s per 1× against 1,000 per node: 50 % at 5× a node, 100 % at 10× a node. The database
// carries half of it (a quarter with the cache) against 1,500 q/s: 50 % at 15×, at 30× with the cache.
const sized = defineModel({
  load: p.load({ max: 100 }),
  params: {
    nodes: p.select({ label: 'Nodes', options: [1, 2, 4], default: 1 }),
    cache: p.switch({ label: 'Cache', default: false }),
  },
  scenarios: { Today: {}, 'Two nodes': { nodes: 2 }, Cache: { cache: true } },
  // the load doubles every year
  growth: { rate: 1, per: 'year', asOf: '2026-11-01' },
  flows: { req: { rate: ({ load }) => 100 * load } },
  components: {
    api: {
      name: 'API',
      short: 'the API',
      demand: ({ flows }) => flows.req,
      capacity: ({ nodes }) => measured(1000 * nodes, 'req/s'),
      over: 'x',
    },
    db: {
      name: 'Database',
      short: 'the database',
      demand: ({ flows, cache }) => (cache ? 0.25 : 0.5) * flows.req,
      capacity: measured(1500, 'q/s'),
      over: 'y',
    },
  },
  stages: { api: pass('api') },
  routes: { req: ['api'] },
})

describe('growth', () => {
  it('turns a multiple into a date, compounded from asOf', () => {
    const g = growth({ rate: 1, per: 'year', asOf: '2026-11-01' })
    // 5× is log2(5) = 2.32 years = 27.86 months: 2029-02-01 plus 0.86 of February
    expect(dateAt(g, 5)?.toISOString().slice(0, 10)).toBe('2029-02-25')
    // 10× is 39.86 months: February 2030
    expect(around(dateAt(g, 10)!)).toBe('around February 2030')
    // 6 % a month: 2× is ln 2 / ln 1.06 = 11.9 months
    expect(around(dateAt(growth({ rate: 0.06, per: 'month', asOf: '2026-11' }), 2)!)).toBe('around October 2027')
    expect(dateAt(g, 1)?.toISOString().slice(0, 10)).toBe('2026-11-01')
    expect([dateAt(g, null), dateAt(g, Number.POSITIVE_INFINITY)]).toEqual([null, null])
  })

  it('refuses a rate of 0, an unknown period and a day that does not exist', () => {
    expect(() => growth({ rate: 0, per: 'year', asOf: '2026-11-01' })).toThrow(/rate above 0/)
    expect(() => growth({ rate: 1, per: 'week' as 'year', asOf: '2026-11-01' })).toThrow(/per month or per year/)
    expect(() => growth({ rate: 1, per: 'year', asOf: '2026-02-30' })).toThrow(/not a date/)
    expect(parseAsOf('2026-1-01')).toBeNull()
  })

  it('names the date in the verdict', () => {
    expect(sized.evaluate({ load: 1 }).verdict.text).toBe(
      'At 1×, every component is under the 50 % target. It holds up to 5× (around February 2029); the API is the first limit.',
    )
    expect(sized.evaluate({ load: 7 }).verdict.text).toContain('holds up to 5× (around February 2029), limited by')
  })
})

describe('scenarios', () => {
  it('are the defaults plus their values, and are found from values', () => {
    expect(sized.scenarios).toEqual([
      { label: 'Today', values: { nodes: 1, cache: false } },
      { label: 'Two nodes', values: { nodes: 2, cache: false } },
      { label: 'Cache', values: { nodes: 1, cache: true } },
    ])
    expect(sized.scenarioOf({ load: 40, nodes: 2, cache: false })?.label).toBe('Two nodes')
    expect(sized.scenarioOf({ load: 1, nodes: 4, cache: false })).toBeNull()
  })

  it('refuse the load and unknown parameters', () => {
    expect(() => tiny({ scenarios: { High: { load: 3 } } } as any)).toThrow(/sets the load/)
    expect(() => tiny({ scenarios: { X: { pods: 3 } } } as any)).toThrow(/unknown parameter "pods"/)
  })

  it('compare first limits, multiples, dates and the change per component', () => {
    const c = compare(sized, 1)
    const row = (label: string) => c.rows.find((r) => r.label === label)!
    expect(c.rows.map((r) => [r.label, r.firstLimit?.id, round(r.target), round(r.full)])).toEqual([
      ['Today', 'api', 5, 10],
      ['Two nodes', 'api', 10, 20],
      ['Cache', 'api', 5, 10],
    ])
    expect(around(row('Two nodes').targetDate!)).toBe('around February 2030')
    // 20× is log2(20) = 4.32 years = 51.86 months: February 2031
    expect(around(row('Two nodes').fullDate!)).toBe('around February 2031')
    const changes = (label: string) => row(label).components.map((x) => [x.id, round(x.target), round(x.change)])
    expect(changes('Two nodes')).toEqual([
      ['api', 10, 2],
      ['db', 15, 1],
    ])
    expect(changes('Cache')).toEqual([
      ['api', 5, 1],
      ['db', 30, 2],
    ])
    expect(c.best?.label).toBe('Two nodes')
    expect(c.text).toBe(
      'Two nodes buys the most headroom: the 50 % target holds up to 10× (around February 2030), limited by the API, against 5× (around February 2029) in Today and 5× (around February 2029) in Cache.',
    )
  })

  it('compare scenarios that tie without naming a winner', () => {
    const m = defineModel({ ...(sized.def as any), scenarios: { Today: {}, Cache: { cache: true } } })
    expect(compare(m).best).toBeNull()
    expect(compare(m).text).toBe('Every scenario holds the 50 % target up to 5× (around February 2029).')
  })
})

describe('headroom', () => {
  it('crosses the target and 100 % exactly where the limits say', () => {
    const h = headroom(sized, { load: 3 })
    // the last scenario runs out at 20×, a quarter past is 25×, but the slider reaches 100×
    expect([h.from, h.to, h.load]).toEqual([1, 100, 3])
    expect(h.lines.map((l) => [l.label, l.selected, round(l.target), round(l.full)])).toEqual([
      ['Today', true, 5, 10],
      ['Two nodes', false, 10, 20],
      ['Cache', false, 5, 10],
    ])
    for (const line of h.lines)
      for (const [th, x] of [
        [0.5, line.target],
        [1, line.full],
      ] as const) {
        const i = line.envelope.findIndex(([, u]) => (u ?? 0) >= th)
        expect(line.envelope[i - 1]![0]).toBeLessThan(x!)
        expect(line.envelope[i]![0]).toBeGreaterThanOrEqual(x!)
      }
    const today = h.lines[0]!
    expect(today.components.map((c) => [c.id, round(c.target)])).toEqual([
      ['api', 5],
      ['db', 15],
    ])
  })

  it('adds the shown values first when they match no scenario', () => {
    const h = headroom(sized, { nodes: 4 })
    expect(h.lines.map((l) => [l.label, l.selected, round(l.target)])).toEqual([
      [null, true, 15],
      ['Today', false, 5],
      ['Two nodes', false, 10],
      ['Cache', false, 5],
    ])
  })
})
