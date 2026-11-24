import { describe, expect, it } from 'vitest'
import { configured, defineModel, limit, measured, p, pass } from '../src'

// 40 calls a second at the peak of 1×, a day averaging half of it, through a partner's plan of 2.5M calls
const partner = (per: 'hour' | 'day' | 'month' | undefined, quota: number) =>
  defineModel({
    load: p.load({ max: 20 }),
    flows: { calls: { rate: ({ load }) => 40 * load, average: 0.5 } },
    components: {
      api: { name: 'API', capacity: measured(10_000, 'req/s'), over: 'x' },
      plan: { name: 'Partner plan', capacity: configured(quota, 'calls', 'the plan'), over: 'calls are refused' },
    },
    stages: { api: pass('api'), plan: limit('plan', per ? { per } : {}) },
    routes: { calls: ['api', 'plan'] },
  })

describe('a quota over a window', () => {
  it('counts what reaches it in a day at each flow’s average, and runs out at a load multiple', () => {
    const ev = partner('day', 2_500_000).evaluate({ load: 1 })
    // 40 × 0.5 × 86,400 = 1,728,000 calls a day of 2.5M
    expect(ev.components.plan.demand).toBeCloseTo(1_728_000, 6)
    expect(ev.components.plan.full).toBeCloseTo(2_500_000 / 1_728_000, 6)
    expect(ev.components.plan.quota).toEqual({ per: 'day' })
  })

  it('counts an hour at the peak, a month at the average', () => {
    expect(partner('hour', 1e9).evaluate({ load: 1 }).components.plan.demand).toBeCloseTo(40 * 3_600, 6)
    expect(partner('month', 1e9).evaluate({ load: 1 }).components.plan.demand).toBeCloseTo(20 * 2_629_800, 3)
  })

  it('past it, is gone that far into the window and turns the rest away', () => {
    const ev = partner('day', 2_500_000).evaluate({ load: 5 })
    // 8.64M wanted of 2.5M: gone after 2.5 / 8.64 of the day, 71 % refused
    expect(ev.components.plan.quota!.goneAfter).toBeCloseTo((86_400 * 2_500_000) / 8_640_000, 6)
    expect((ev.stages.plan as { rejects: number }).rejects).toBeCloseTo(1 - 2_500_000 / 8_640_000, 9)
  })

  it('without a window is a rate limit, as before', () => {
    const ev = partner(undefined, 100).evaluate({ load: 1 })
    expect(ev.components.plan.demand).toBeCloseTo(40, 9)
    expect(ev.components.plan.quota).toBeUndefined()
    expect(() => limit('plan', { per: 'week' as never })).toThrow('per hour, day or month')
  })
})
