import { check } from '@loadmap/core'
import { describe, expect, it } from 'vitest'
import { regions } from './model'

describe('two regions', () => {
  it('holds its expectations', () => {
    expect(check(regions).map((x) => [x.expectation.label, x.ok])).toEqual([
      ['Today keeps 2×', true],
      ['With the US lost, the EU keeps 1.5×', true],
      ['With the EU lost and four US pods, the US keeps 1.5×', true],
    ])
  })

  it('runs out first in the smaller region, and sooner when the other one is lost', () => {
    const at = (values: Record<string, unknown>) => regions.evaluate({ load: 1, ...values } as never)
    const today = at({})
    expect(today.firstLimit?.id).toBe('us.orders.workers')
    expect(today.firstLimit?.target).toBeCloseTo(2.5, 6)
    // the EU's orders go to the US: its workers are at their target already today
    const euLost = at({ euLost: true })
    expect(euLost.firstLimit?.id).toBe('us.orders.workers')
    expect(euLost.firstLimit?.target).toBeCloseTo(1, 6)
    expect(euLost.verdict.text).toContain('the workers in US region')
    // the other way round the EU holds longer: it is the bigger one
    const usLost = at({ usLost: true })
    expect(usLost.firstLimit?.id).toBe('eu.orders.workers')
    expect(usLost.firstLimit?.target).toBeCloseTo(2, 6)
    // four US pods: the EU's orders fit in the US to 2×, where its API and its workers meet
    const proposed = at({ euLost: true, usPods: 4 })
    expect(proposed.firstLimit?.target).toBeCloseTo(2, 6)
  })

  it("sends a lost region's orders to the other one, and none of them anywhere else", () => {
    const ev = regions.evaluate({ load: 1, euLost: true } as never)
    expect(ev.ctx.flows).toEqual({ eu: 0, euInUs: 300, us: 200, usInEu: 0 })
    expect(ev.components['eu.lb']!.util).toBe(0)
  })
})
