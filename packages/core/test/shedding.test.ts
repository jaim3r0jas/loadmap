import { describe, expect, it } from 'vitest'
import { defineModel, lost, measured, p, pass, sink } from '../src'

// a gateway of 300 a second: orders (priority 1, 200) and reports (priority 2, 200) both reach it
const gateway = (shed?: 'priority') =>
  defineModel({
    load: p.load({ max: 10 }),
    flows: {
      orders: { rate: ({ load }) => 200 * load, priority: 1 },
      reports: { rate: ({ load }) => 200 * load, priority: 2 },
    },
    components: { gw: { name: 'Gateway', capacity: measured(300, 'req/s'), over: 'requests fail' } },
    stages: { gw: pass('gw', shed ? { shed } : {}), out: sink(), turned: lost({ from: ['gw'] }) },
    routes: { orders: ['gw', 'out'], reports: ['gw', 'out'] },
  })

describe('a pass that sheds by priority', () => {
  it('turns away the larger priority number first, letting through what it always would', () => {
    const ev = gateway('priority').evaluate({ load: 1 })
    const gw = ev.stages.gw as { shed: number; shedBy: Record<string, number> }
    // 300 of 400 get through: every order, and 100 of 200 reports
    expect(gw.shedBy.orders).toBeCloseTo(0, 9)
    expect(gw.shedBy.reports).toBeCloseTo(0.5, 9)
    expect(gw.shed).toBeCloseTo(0.25, 9)
    expect(ev.at.turned.orders).toBeCloseTo(0, 9)
    expect(ev.at.turned.reports).toBeCloseTo(100, 9)
    // past room for priority 1 too, orders lose their share and reports all of theirs
    const far = gateway('priority').evaluate({ load: 2 }).stages.gw as { shedBy: Record<string, number> }
    expect(far.shedBy.orders).toBeCloseTo(0.25, 9)
    expect(far.shedBy.reports).toBeCloseTo(1, 9)
  })

  it('counts the units that reach it: a demand that weighs flows apart is refused', () => {
    expect(() =>
      defineModel({
        load: p.load({ max: 4 }),
        flows: { a: { rate: 1, priority: 1 }, b: { rate: 1, priority: 2 } },
        components: {
          gw: { name: 'GW', demand: ({ flows }) => 5 * flows.a + flows.b, capacity: measured(3, 'r/s'), over: 'x' },
        },
        stages: { gw: pass('gw', { shed: 'priority' }), out: sink() },
        routes: { a: ['gw', 'out'], b: ['gw', 'out'] },
      }),
    ).toThrow('sheds by priority, so it counts the units that reach it')
  })

  it('without it turns away the same share of every flow, as before', () => {
    const ev = gateway().evaluate({ load: 1 })
    const gw = ev.stages.gw as { shed: number; shedBy?: unknown }
    expect(gw.shed).toBeCloseTo(0.25, 9)
    expect(gw.shedBy).toBeUndefined()
    expect(ev.at.turned.orders).toBeCloseTo(50, 9)
  })
})
