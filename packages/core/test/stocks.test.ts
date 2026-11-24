import { describe, expect, it } from 'vitest'
import { check, configured, defineModel, type Growth, measured, p, pass, store } from '../src'

// 100 orders a second at the peak of 1×, half of it over a day; each writes 2 KB (2e-6 GB) to the database's disk
const GROWTH: Growth = { rate: 0.05, per: 'month', asOf: '2026-11-01' }
const MONTH = 2_629_800
const DAY = 86_400

const shop = (
  disk: { keeps?: number; level?: number; within?: number; capacity?: number },
  o: { growth?: Growth | null; lasts?: number } = {},
) =>
  defineModel({
    load: p.load({ max: 40 }),
    flows: { orders: { rate: ({ load }) => 100 * load, average: 0.5 } },
    components: {
      api: { name: 'API', capacity: measured(1_000, 'req/s'), over: 'orders fail' },
      db: { name: 'Database', capacity: measured(3_000, 'writes/s'), over: 'writes queue' },
      disk: {
        name: 'Database disk',
        short: 'the disk',
        fills: ({ at }) => at.db.orders * 2e-6,
        ...(disk.keeps != null ? { keeps: disk.keeps } : {}),
        ...(disk.level != null
          ? { level: measured(disk.level, 'GB', { source: 'df', within: disk.within ?? 0 }) }
          : {}),
        capacity: configured(disk.capacity ?? 1_500, 'GB', 'volume size'),
        over: 'writes fail: the volume is full',
      },
    },
    stages: { api: pass('api'), db: store('db') },
    routes: { orders: ['api', 'db'] },
    ...(o.growth === null ? {} : { growth: o.growth ?? GROWTH }),
    ...(o.lasts != null ? { expect: [{ component: 'disk' as const, lasts: o.lasts }] } : {}),
  })

/** What a stock that grows has gained from asOf to load L when it gains g × load a second: g × P ÷ ln(1 + r) × (L − 1). */
const gained = (g: number, load: number) => ((g * MONTH) / Math.log(1.05)) * (load - 1)

describe('a stock', () => {
  it('that keeps what it gains settles at fills × keeps, read at each flow’s average', () => {
    const ev = shop({ keeps: 7 * DAY }).evaluate({ load: 2 })
    // 100 × 2 × 0.5 orders a second × 2e-6 GB = 2e-4 GB a second, kept 7 days: 120.96 GB of 1,500
    expect(ev.components.disk.stock).toMatchObject({ keeps: 7 * DAY })
    expect(ev.components.disk.stock!.gains).toBeCloseTo(2e-4, 12)
    expect(ev.components.disk.demand).toBeCloseTo(120.96, 6)
    expect(ev.components.disk.util).toBeCloseTo(120.96 / 1_500, 9)
    // a load multiple like any other: full where 60.48 GB × L reaches 1,500
    expect(ev.components.disk.full).toBeCloseTo(1_500 / 60.48, 6)
    expect(ev.components.disk.target).toBeCloseTo(750 / 60.48, 6)
    // every other component still reads the peak
    expect(ev.components.db.util).toBeCloseTo(200 / 3_000, 9)
  })

  it('that grows stands at its level on asOf and adds what it gains as the load grows', () => {
    const model = shop({ level: 120, capacity: 50_000 })
    const at = (load: number) => model.evaluate({ load }).components.disk
    // gains 1e-4 GB a second at 1×, and as much more per × as the load grows
    expect(at(1).demand).toBeCloseTo(120, 9)
    for (const load of [1.5, 3, 10, 30]) {
      const want = 120 + gained(1e-4, load)
      // the trapezoid on a grid an eighth of a doubling wide: within a thousandth
      expect(Math.abs(at(load).demand! / want - 1), `${load}×`).toBeLessThan(1e-3)
    }
    // full on the day the load reaches L: 120 + 5,390 × (L − 1) = 50,000
    const full = 1 + 49_880 / (gained(1e-4, 2) - 0)
    expect(Math.abs(at(1).full! / full - 1)).toBeLessThan(1e-3)
    // the room left at what it gains now
    const st = at(3).stock!
    expect(st.room).toBeCloseTo((50_000 - st.level) / st.gains, 3)
    expect(st.keeps).toBeUndefined()
  })

  it('that grows is ranked on its pessimistic edge: its level high, its capacity low', () => {
    const ev = shop({ level: 120, within: 0.2, capacity: 50_000 }).evaluate({ load: 1 })
    const r = ev.components.disk.fullRange!
    expect(r.low).toBeLessThan(r.high)
    // the low edge reads the level 20 % higher
    expect(Math.abs(r.low / (1 + (50_000 - 144) / gained(1e-4, 2)) - 1)).toBeLessThan(1e-3)
    expect(ev.assumptions).toContainEqual(
      expect.objectContaining({ kind: 'capacity', name: 'Database disk, its level on 2026-11-01' }),
    )
  })

  it('that grows with no growth is not ranked, and the verdict says why', () => {
    const ev = shop({ level: 120 }, { growth: null }).evaluate({ load: 2 })
    expect(ev.components.disk.util).toBeNull()
    expect(ev.components.disk.stock).toMatchObject({ undated: true, level: 120 })
    expect(ev.firstLimit?.id).not.toBe('disk')
    expect(ev.verdict.text).toContain('The disk fills over time, and without growth no load says when')
  })

  it('lasts a time: the load the growth reaches then', () => {
    // 365 days is 11.99 months at 5 % a month: 1.05^11.99 ≈ 1.8×; it runs out near 1.07×
    const [short] = check(shop({ level: 120, capacity: 500 }, { lasts: 365 * DAY }))
    expect(short!.outcome).toBe('fail')
    expect(short!.expectation.notFull).toBeCloseTo(1.05 ** ((365 * DAY) / MONTH), 9)
    expect(short!.message).toMatch(/^expected to last 12 months \([\d.]+×\), but the disk runs out at 1\.07× \(around /)
    const [long] = check(shop({ keeps: DAY }, { lasts: 365 * DAY }))
    expect(long!.outcome).toBe('pass')
  })

  it('refuses what is not one', () => {
    const bad = (disk: Record<string, unknown>, stages?: Record<string, unknown>) => () =>
      defineModel({
        load: p.load({ max: 4 }),
        flows: { orders: { rate: 1 } },
        components: {
          db: { name: 'DB', capacity: measured(10, 'writes/s'), over: 'x' },
          disk: { name: 'Disk', capacity: configured(1, 'GB'), over: 'x', ...disk } as never,
        },
        stages: { db: store('db'), ...stages } as never,
        routes: { orders: ['db'] },
        growth: GROWTH,
      })
    expect(bad({ fills: () => 1 })).toThrow('give it keeps (it settles at fills × keeps) or level')
    expect(bad({ fills: () => 1, keeps: 1, level: measured(1, 'GB') })).toThrow('one of them')
    expect(bad({ keeps: 1, demand: () => 1 })).toThrow('has keeps: give it fills too')
    expect(bad({ fills: () => 1, keeps: 1, demand: () => 1 })).toThrow('it takes no demand or held')
    expect(bad({ fills: () => 1, keeps: 1 }, { disk: store('disk') })).toThrow('no stage runs it')
  })
})
