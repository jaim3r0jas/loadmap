import { layout, localElk } from '@loadmap/layout'
import { describe, expect, it } from 'vitest'
import { pageElk, workerElk } from '../packages/react/src/elk'
import { alerts } from './alerts/model'
import { view as alertsView } from './alerts/view'
import { checkout } from './checkout/model'
import { view as checkoutView } from './checkout/view'

// layout() caches its scenes per view: a copy of the view lays out afresh
const fresh = <T extends object>(v: T): T => ({ ...v })

describe('ELK in a worker', () => {
  for (const [name, model, view] of [
    ['checkout', checkout, checkoutView],
    ['alerts', alerts, alertsView],
  ] as const)
    for (const direction of ['RIGHT', 'DOWN'] as const)
      it(`lays ${name} out exactly as the main thread does (${direction})`, async () => {
        const ev = model.evaluate()
        const here = await layout(fresh(view), ev, { direction, elk: await localElk() })
        let answers = 0
        const elk = workerElk(() => {
          const w = new Worker(new URL('../packages/react/src/elk.worker.js', import.meta.url), { type: 'module' })
          w.addEventListener('message', () => answers++)
          return w
        })
        const there = await layout(fresh(view), ev, { direction, elk })
        expect(answers).toBe(1)
        expect(there).toEqual(here)
      })

  it('shares one worker across the page', () => {
    expect(pageElk()).toBe(pageElk())
  })

  it('falls back to the main thread when the worker cannot load', async () => {
    const elk = workerElk(() => new Worker('/no-such-worker.js', { type: 'module' }))
    const ev = checkout.evaluate()
    const scene = await layout(fresh(checkoutView), ev, { elk })
    expect(scene).toEqual(await layout(fresh(checkoutView), ev, { elk: await localElk() }))
  })

  it('falls back when there is no worker at all', async () => {
    const elk = workerElk(() => {
      throw new Error('blocked by the page')
    })
    const scene = await layout(fresh(checkoutView), checkout.evaluate(), { elk })
    expect(scene.nodes).toHaveLength(5)
  })
})
