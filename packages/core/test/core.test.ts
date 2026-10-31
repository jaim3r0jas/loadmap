import { describe, expect, it } from 'vitest'
import { defineModel, estimated, measured, multiple, niceStep, p, pass } from '../src'
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
