import { describe, expect, it } from 'vitest'
import {
  assertHolds,
  check,
  compare,
  crossing,
  dateAt,
  defineModel,
  estimated,
  growth,
  headroom,
  measured,
  p,
  parseAsOf,
  pass,
} from '../src'
import { fitLinear } from '../src/calibrate'
import { around, multiple, multiples, niceStep } from '../src/format'
import { flowOf } from '../src/internal'

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
  it('resolves the stages a drawing needs, as evaluate does', () => {
    const m = tiny()
    for (const load of [1, 30]) {
      const ev = m.evaluate({ load })
      const at = m.stagesAt({ load })
      expect(at.values).toEqual(ev.values)
      expect(at.stages).toEqual(ev.stages)
      expect(at.ctx.flows.req).toBe(ev.ctx.flows.req)
    }
  })

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
    // a loop is no one flow's fault
    expect(
      flowOf(
        (() => {
          try {
            m.evaluate()
          } catch (err) {
            return err
          }
        })(),
      ),
    ).toBeUndefined()
  })

  it('takes a constant rate, the same at any load', () => {
    const m = tiny({ flows: { req: { rate: 40 } } })
    expect(m.evaluate({ load: 1 }).flows.req).toBe(40)
    expect(m.evaluate({ load: 90 }).flows.req).toBe(40)
  })

  it('blames a flow only for an error its own computation raised, the innermost flow', () => {
    const thrown = (m: { evaluate: () => unknown }) => {
      try {
        m.evaluate()
      } catch (err) {
        return err
      }
    }
    const nested = thrown(
      tiny({
        flows: {
          req: { rate: ({ flows }: any) => flows.inner },
          inner: {
            rate: () => {
              throw new TypeError('x is not a function')
            },
          },
        },
        routes: { req: ['api'], inner: ['api'] },
      }),
    )
    expect(nested).toBeInstanceOf(TypeError)
    expect(flowOf(nested)).toBe('inner')
    const read = thrown(
      tiny({
        flows: { req: { rate: ({ util }: any) => 10 * (1 - util.api) } },
        components: {
          api: {
            name: 'API',
            demand: () => 1,
            capacity: () => {
              throw new Error('loadmap: the capacity broke')
            },
            over: 'x',
          },
        },
      }),
    )
    expect(read).toMatchObject({ message: 'loadmap: the capacity broke' })
    expect(flowOf(read)).toBeUndefined()
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
const round = (x: number | null | undefined) => (x == null ? x : Number(x.toFixed(6)))

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
    // from the 31st, one month on is the last day of February, not March
    const late = growth({ rate: 0.06, per: 'month', asOf: '2026-01-31' })
    expect(dateAt(late, 1.06)?.toISOString().slice(0, 10)).toBe('2026-02-28')
    // the model gives no date for a crossing already reached
    expect([sized.dateAt(1), sized.dateAt(0.5), sized.dateAt(5)?.toISOString().slice(0, 7)]).toEqual([
      null,
      null,
      '2029-02',
    ])
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
    const check = (set: object) => () => defineModel({ ...(sized.def as any), scenarios: { X: set } })
    expect(check({ nodes: 3 })).toThrow('scenario "X" sets "nodes" to 3, which it cannot take')
    expect(check({ cache: 'yes' })).toThrow(/sets "cache" to yes/)
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

  it('compare equal targets by when they run out, and name scenarios that tie', () => {
    // util = load / 4 up to 2× (the target at 2× in both), then steeper or flatter: 100 % at 4× or 6×; heavy doubles it
    const shaped = defineModel({
      load: p.load({ max: 10 }),
      params: {
        steep: p.switch({ label: 'Steep', default: false }),
        heavy: p.switch({ label: 'Heavy', default: false }),
      },
      scenarios: { Steep: { steep: true }, Flat: {}, Heavy: { heavy: true } },
      flows: { req: { rate: ({ load }) => load } },
      components: {
        x: {
          name: 'X',
          demand: ({ load, steep, heavy }) =>
            (heavy ? 2 : 1) * (load <= 2 ? load / 4 : 0.5 + (load - 2) * (steep ? 0.25 : 0.125)),
          capacity: measured(1, 'u'),
          over: '',
        },
      },
      stages: { x: pass('x') },
      routes: { req: ['x'] },
    })
    const c = compare(shaped)
    expect(c.best?.label).toBe('Flat')
    expect(c.text).toBe(
      'Flat buys the most headroom: the 50 % target holds up to 2×, limited by X, and runs out at 6×, against 2× in Steep (runs out at 4×) and 1× in Heavy.',
    )
    const twins = defineModel({ ...(shaped.def as any), scenarios: { A: {}, B: {}, Heavy: { heavy: true } } })
    expect(compare(twins).best).toBeNull()
    expect(compare(twins).text).toBe(
      'A and B buy the most headroom: the 50 % target holds up to 2×, against 1× in Heavy.',
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

// the API carries 100 req/s per 1× against 1,000 (exact); the cache 100 per 1× against an estimated 1,200 ±30 %:
// 50 % at 6× stated, 4.2× at 840 and 7.8× at 1,560. The API's 5× lies between, so the cache may come first.
const unsure = (cache: Parameters<typeof estimated>[2] = { within: 0.3 }, expect?: any) =>
  defineModel({
    load: p.load({ max: 100 }),
    params: { big: p.switch({ label: 'Big cache', default: false }) },
    scenarios: { Today: {}, Big: { big: true } },
    flows: { req: { rate: ({ load }: any) => 100 * load } },
    components: {
      api: {
        name: 'API',
        short: 'the API',
        demand: ({ flows }: any) => flows.req,
        capacity: measured(1000, 'req/s'),
        over: 'x',
      },
      cache: {
        name: 'Cache',
        short: 'the cache',
        demand: ({ flows }: any) => flows.req,
        capacity: ({ big }: any) => estimated(big ? 2400 : 1200, 'req/s', cache),
        over: 'y',
      },
    },
    stages: { api: pass('api') },
    routes: { req: ['api'] },
    expect,
  } as any)

describe('uncertainty', () => {
  it('keeps the ± on a capacity, and a source as the third argument still works', () => {
    expect(estimated(10, 'x', { source: 's', within: 0.3 })).toEqual({
      value: 10,
      unit: 'x',
      provenance: 'estimated',
      source: 's',
      within: 0.3,
    })
    expect(measured(10, 'x', 's')).toEqual({ value: 10, unit: 'x', provenance: 'measured', source: 's' })
    expect(measured(10, 'x', { within: 0 })).not.toHaveProperty('within')
    for (const w of [-0.1, 1, Number.NaN]) expect(() => estimated(10, 'x', { within: w })).toThrow(/within/)
  })

  it('puts the edges of a range at the crossings at the capacity bounds', () => {
    const r = unsure().evaluate().components.cache!
    expect([r.target, r.targetRange?.low, r.targetRange?.high].map(round)).toEqual([6, 4.2, 7.8])
    expect([r.full, r.fullRange?.low, r.fullRange?.high].map(round)).toEqual([12, 8.4, 15.6])
    // the same as crossing() on the utilization at the bounds, and as a model whose capacity is the bound
    const util = (cap: number) => (load: number) => (100 * load) / cap
    expect(r.targetRange!.low).toBe(crossing(util(1200 * 0.7), 0.5, 2000))
    expect(r.targetRange!.high).toBe(crossing(util(1200 * 1.3), 0.5, 2000))
    for (const [w, edge] of [
      [-0.3, 'low'],
      [0.3, 'high'],
    ] as const) {
      const fixed = defineModel({
        ...(unsure().def as any),
        components: {
          ...unsure().def.components,
          cache: { ...unsure().def.components.cache, capacity: estimated(1200 * (1 + w), 'req/s') },
        },
      })
      expect(r.targetRange![edge]).toBe(fixed.evaluate().components.cache!.target)
      expect(r.fullRange![edge]).toBe(fixed.evaluate().components.cache!.full)
    }
    // an exact capacity has a range of one point
    const api = unsure().evaluate().components.api!
    expect(api.targetRange).toEqual({ low: api.target, high: api.target })
  })

  it('ranks on the pessimistic edge and says so in the verdict', () => {
    const ev = unsure().evaluate({ load: 2 })
    expect(ev.ranked.map((c) => c.id)).toEqual(['cache', 'api'])
    expect(ev.firstLimit?.id).toBe('cache')
    expect([ev.target?.low, ev.target?.high].map(round)).toEqual([4.2, 5])
    expect([ev.full?.low, ev.full?.high].map(round)).toEqual([8.4, 10])
    expect(ev.verdict.text).toBe(
      'At 2×, every component is under the 50 % target. It holds up to between 4.2× and 5×; the cache is the first limit (capacity estimated ±30 %).',
    )
    expect(ev.presets.map((p) => p.label)).toEqual(['Today · 1×', '50 % target · 4.2×', 'Runs out · 8.4×'])
  })

  it('says what may already be happening past a pessimistic edge', () => {
    // the cache's 50 % at 4.2× to 6× (the API's 5× caps it), 100 % at 8.4× to 15.6×
    expect(unsure().evaluate({ load: 4.5 }).verdict).toEqual({
      tier: 'warn',
      text: 'At 4.5×, every component is under the 50 % target at its stated capacity, but the cache may already be above it. The 50 % target holds up to between 4.2× and 5×, limited by the cache (capacity estimated ±30 %).',
    })
    expect(unsure().evaluate({ load: 9 }).verdict.text).toMatch(
      /^At 9×, everything fits at the stated capacities, but the cache may already be past capacity: y\. /,
    )
    // without a ± nothing may: the stated tiers alone
    expect(sized.evaluate({ load: 4 }).verdict.tier).toBe('ok')
  })

  it('names the capacity whose measurement would change the answer', () => {
    const ev = unsure().evaluate()
    expect(ev.measure?.component).toBe('cache')
    expect(ev.measure?.firstLimit).toBe('api')
    expect(ev.measure?.text).toBe(
      'Measuring the cache would change the answer: at its stated capacity, the API is the first limit and the 50 % target holds up to 5×.',
    )
    // a big cache is past the API at either bound: measuring it would only narrow its own range, not the answer
    expect(unsure().evaluate({ big: true } as any).measure).toBeNull()
    // ±3 % is narrow enough
    expect(unsure({ within: 0.03 }).evaluate().measure).toBeNull()
  })

  it('formats a range of multiples', () => {
    expect(multiples({ low: 4.27, high: 13.8 })).toBe('between 4.2× and 13×')
    expect(multiples({ low: 4.27, high: 13.8 }, 2000, true)).toBe('4.2×–13×')
    expect(multiples({ low: 4.27, high: 4.29 })).toBe('4.2×')
    expect(multiples({ low: 4.2, high: Number.POSITIVE_INFINITY })).toBe('4.2× or more')
  })

  it('compares scenarios on the pessimistic edge', () => {
    const c = compare(unsure())
    expect(c.rows.map((r) => [r.label, round(r.target), round(r.targetRange?.high ?? null)])).toEqual([
      ['Today', 4.2, 5],
      ['Big', 5, 5],
    ])
    expect(c.text).toBe(
      'Big buys more headroom: the 50 % target holds up to 5×, limited by the API, against between 4.2× and 5× in Today.',
    )
  })

  it('draws a band whose edges cross where the range says', () => {
    const line = headroom(unsure()).lines[0]!
    expect(line.band).not.toBeNull()
    for (const [edge, series] of [
      ['low', line.band!.upper],
      ['high', line.band!.lower],
    ] as const) {
      const x = line.targetRange![edge]
      const i = series.findIndex(([, u]) => (u ?? 0) >= 0.5)
      expect(series[i - 1]![0]).toBeLessThan(x)
      expect(series[i]![0]).toBeGreaterThanOrEqual(x)
    }
    // the stated line crosses at the first stated crossing: the API's 5×
    expect(round(line.target)).toBe(5)
    expect(headroom(sized).lines[0]!.band).toBeNull()
    // an optimistic edge that never comes: the axis still reaches the pessimistic one
    // (100 req/s per 1× against 1,000 ±50 %: 100 % at 5× to 15×, but the search ends at 12×)
    const far = tiny({
      load: p.load({ max: 2 }),
      searchMax: 12,
      components: {
        api: {
          name: 'API',
          demand: ({ flows }: any) => flows.req,
          capacity: estimated(1000, 'req/s', { within: 0.5 }),
          over: 'x',
        },
      },
    } as any)
    expect(far.evaluate().full).toEqual({ low: 5, high: Number.POSITIVE_INFINITY })
    expect(headroom(far, {}, { samples: 8 }).to).toBe(6.25)
  })
})

describe('expectations', () => {
  it('hold on the pessimistic edge', () => {
    const m = unsure(undefined, [
      { label: 'Today keeps 4×', target: 4 },
      { scenario: 'Big', target: 5, full: 10 },
      { component: 'api', full: 10 },
    ])
    expect(check(m).map((r) => [r.ok, r.message])).toEqual([
      [true, 'the 50 % target holds up to between 4.2× and 5×, limited by the cache (capacity estimated ±30 %)'],
      [true, 'the 50 % target holds up to 5× in Big, limited by the API; the API runs out at 10× in Big'],
      [true, 'the API runs out at 10×'],
    ])
    expect(() => assertHolds(m)).not.toThrow()
  })

  it('fail with what was expected and what was found', () => {
    const m = unsure(undefined, [{ label: 'Today keeps 5×', target: 5 }, { full: 9 }])
    expect(check(m).map((r) => [r.ok, r.message])).toEqual([
      [
        false,
        'expected at least 5×, but the 50 % target holds up to between 4.2× and 5×, limited by the cache (capacity estimated ±30 %)',
      ],
      [false, 'expected at least 9×, but the cache runs out at between 8.4× and 10× (capacity estimated ±30 %)'],
    ])
    expect(() => assertHolds(m)).toThrow(
      '2 of 2 expectations failed:\n- Today keeps 5×: expected at least 5×, but the 50 % target holds up to between 4.2× and 5×, limited by the cache (capacity estimated ±30 %)\n- expected at least 9×, but the cache runs out at between 8.4× and 10× (capacity estimated ±30 %)',
    )
    // the same expectations can be passed in
    expect(check(unsure(), [{ target: 4 }])[0]!.ok).toBe(true)
  })

  it('are checked when the model is defined', () => {
    expect(() => unsure(undefined, [{ scenario: 'Later', target: 1 }])).toThrow(/unknown scenario "Later"/)
    expect(() => unsure(undefined, [{ component: 'db', target: 1 }])).toThrow(/unknown component "db"/)
    expect(() => unsure(undefined, [{ label: 'empty' }])).toThrow(/expectation "empty" needs a target or a full/)
    expect(() => unsure(undefined, [{ target: 0 }])).toThrow(/above 0/)
  })
})

describe('story', () => {
  const make = (story?: any[]) =>
    defineModel({
      load: p.load({ max: 50, default: 1 }),
      params: {
        pods: p.select({ label: 'Pods', options: [2, 4, 8], default: 2 }),
        batch: p.switch({ label: 'Batch', default: false }),
      },
      flows: { reqs: { rate: ({ load }) => 100 * load } },
      components: {
        app: { name: 'App', demand: ({ flows }) => flows.reqs, capacity: measured(1000, 'req/s'), over: 'slow' },
      },
      stages: { app: pass('app') },
      routes: { reqs: ['app'] },
      scenarios: { Today: {}, Proposed: { pods: 8 } },
      story,
    })

  it('resolves every value of each step: defaults, then the scenario, then set', () => {
    const m = make([
      { text: 'Today, at peak.' },
      { text: 'Proposed, at 30×.', scenario: 'Proposed', set: { load: 30, batch: true }, focus: 'app', seconds: 6 },
      { text: 'Back to today at 30×.', set: { load: 30 } },
    ])
    expect(m.story).toEqual([
      { text: 'Today, at peak.', values: { load: 1, pods: 2, batch: false }, seconds: 4 },
      {
        text: 'Proposed, at 30×.',
        values: { load: 30, pods: 8, batch: true },
        scenario: 'Proposed',
        focus: 'app',
        seconds: 6,
      },
      { text: 'Back to today at 30×.', values: { load: 30, pods: 2, batch: false }, seconds: 4 },
    ])
    expect(make().story).toEqual([])
  })

  it('names the step that is wrong', () => {
    const bad = (step: object) => () => make([{ text: 'ok' }, { text: 'x', ...step }])
    expect(bad({ scenario: 'Later' })).toThrow('story step 2 names unknown scenario "Later"')
    expect(bad({ focus: 'db' })).toThrow('story step 2 points at unknown component "db"')
    expect(bad({ set: { pods: 3 } })).toThrow('story step 2 sets "pods" to 3, which it cannot take')
    expect(bad({ set: { load: 80 } })).toThrow('story step 2 sets the load to 80, outside 1 to 50')
    expect(bad({ set: { nodes: 2 } })).toThrow('story step 2 sets unknown parameter "nodes"')
    expect(bad({ seconds: 0 })).toThrow('story step 2 needs seconds above 0, not 0')
  })
})
