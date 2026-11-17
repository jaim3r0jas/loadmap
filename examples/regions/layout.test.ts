import { collisions, layout } from '@loadmap/layout'
import { closing } from '@loadmap/layout/internal'
import { describe, expect, it } from 'vitest'
import { expectCompact } from '../phases'
import { regions } from './model'
import { view } from './view'

describe('regions layout', () => {
  for (const direction of ['RIGHT', 'DOWN'] as const) {
    it(`never moves with the load, and lays out each phase on its own (${direction})`, () =>
      expectCompact(view, regions, direction))

    it(`frames each region and its orders, and draws them closed without a collision (${direction})`, async () => {
      const ev = regions.evaluate(regions.defaults())
      const open = await layout(view, ev, { direction })
      expect(open.subsystems.map((s) => s.id)).toEqual(['eu', 'us', 'eu.orders', 'us.orders'])
      expect(collisions(open)).toEqual([])
      const close = (await closing(view))!
      for (const closed of [['eu', 'us'], ['eu'], ['us.orders']]) {
        const s = await layout(close(view, closed), ev, { direction })
        expect(collisions(s), closed.join()).toEqual([])
        for (const id of closed)
          expect(
            s.nodes.some((n) => n.subsystem === id),
            id,
          ).toBe(true)
      }
    })
  }
})
