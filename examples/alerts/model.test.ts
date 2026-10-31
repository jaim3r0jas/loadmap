import { collisions, layout } from '@loadmap/layout'
import { createSim } from '@loadmap/sim'
import { describe, expect, it } from 'vitest'
import { alertCores, alerts } from './model'
import { view } from './view'

describe('alerts model', () => {
  it('finds each crossing where the arithmetic puts it', () => {
    const c = alerts.evaluate().components
    // 260 positions/s per 1× at 1.5 ms against 3 pods × 2 cores
    expect(c.posPods.full).toBeCloseTo(6 / (260 * 0.0015), 6)
    expect(c.gateway.full).toBeCloseTo(30_000 / 272, 6)
    expect(c.brokers.full).toBeCloseTo(20 / (0.018 + 0.26), 6)
    // 1.4 packets per alert, 0.3 per position, against 3 nodes × 4,000
    expect(c.push.full).toBeCloseTo(12_000 / (12 * 1.4 + 260 * 0.3), 6)
    expect(c.alertPods.full).toBeCloseTo((3 - alertCores.a) / (alertCores.b * 12), 6)
    // pushing every position to every receiver makes the push broker the second limit
    expect(alerts.evaluate({ watchOnly: false }).components.push.full).toBeCloseTo(12_000 / (12 * 1.4 + 260 * 1.2), 6)
  })

  it('names the position consumer as the first limit and says so', () => {
    const s = alerts.evaluate()
    expect(s.firstLimit?.id).toBe('posPods')
    expect(s.verdict.text).toBe(
      'At 10×, everything still fits, but the position consumer runs above the 50 % target. The 50 % target holds up to 7.6×, limited by the position consumer.',
    )
    expect(alerts.evaluate({ load: 80 }).verdict.text).toContain('the brokers are past capacity')
  })

  it('resolves the fan-out and the merge rule from the switches', () => {
    const on = alerts.evaluate()
    const off = alerts.evaluate({ merge: false, watchOnly: false })
    expect(on.overload.positions).toEqual({ merge: { share: 0.37, reason: 'newest kept' } })
    expect(off.overload.positions).toEqual({})
    const fan = (e: typeof on) => (e.stages.push.kind === 'fanout' ? e.stages.push.to : {})
    expect(fan(on).positions).toEqual([{ stage: 'watchers', share: 0.3 }])
    expect(fan(off).positions).toEqual([{ stage: 'watchers', share: 1.2 }])
    expect(fan(on).alerts?.map((b) => b.stage)).toEqual(['members', 'responders'])
  })
})

describe('alerts layout', () => {
  for (const direction of ['RIGHT', 'DOWN'] as const)
    it(`has no label over another label or a node (${direction})`, async () => {
      for (const v of [
        {},
        { alertPods: 8, posPods: 8 },
        { alertPods: 2, posPods: 2, merge: false, watchOnly: false },
      ] as const)
        expect(collisions(await layout(view, alerts.evaluate(v), { direction }))).toEqual([])
    })

  it('splits both topics across the same three brokers', async () => {
    const scene = await layout(view, alerts.evaluate())
    const brokers = scene.nodes.find((n) => n.id === 'brokers')!
    expect(brokers.stages).toEqual(['alertTopic', 'posTopic'])
    for (const [k, m] of brokers.members.entries()) {
      const inside = brokers.cells.filter((c) => c.x >= m.x && c.x < m.x + m.w && c.y >= m.y && c.y < m.y + m.h)
      expect(inside.filter((c) => c.stage === 'alertTopic')).toHaveLength(8)
      expect(inside.filter((c) => c.stage === 'posTopic')).toHaveLength(16)
      expect(inside.every((c) => c.index % 3 === k)).toBe(true)
    }
    expect(brokers.groups.map((g) => g.text).slice(0, 2)).toEqual(['alerts topic', 'positions topic'])
  })
})

describe('alerts sim', () => {
  const lagAt = (values: Parameters<typeof alerts.evaluate>[0]) => {
    const sim = createSim(alerts, alerts.evaluate(values), { speed: 10 })
    for (let i = 0; i < 1800; i++) sim.step(1 / 60)
    return { pos: sim.queue('posTopic', 'positions'), alert: sim.queue('alertTopic', 'alerts') }
  }

  it('holds positions near a second of lag at 20× thanks to the merge', () => {
    // 4,000 positions/s of capacity handle 4,000 / (1 − 0.37) ≈ 6,350 with the merge, above the 5,200 arriving
    expect(lagAt({ load: 20 }).pos.lag).toBeLessThan(3)
  })

  it('keeps alerts flowing while positions back up', () => {
    const { pos, alert } = lagAt({ load: 30 })
    expect(alert.lag).toBe(0)
    expect(pos.lag).toBeGreaterThan(30)
    expect(pos.merged).toBeGreaterThan(0)
  })

  it('backs positions up further without the merge', () => {
    expect(lagAt({ load: 20, merge: false }).pos.lag).toBeGreaterThan(lagAt({ load: 20 }).pos.lag)
  })
})
