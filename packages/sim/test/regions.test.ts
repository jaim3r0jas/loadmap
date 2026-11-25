import { defineModel, lost, measured, p, pass, sink, split } from '@loadmap/core'
import { describe, expect, it } from 'vitest'
import { createSim } from '../src'

const shop = (noSplit = false) =>
  defineModel({
    load: p.load({ max: 10 }),
    domains: { region: { name: 'Region', parts: { eu: { name: 'the EU' }, us: { name: 'the US' } } } },
    flows: { orders: { label: 'orders', rate: ({ load }) => 500 * load } },
    components: {
      router: { name: 'Router', capacity: measured(50_000, 'req/s'), over: 'x' },
      euApi: { name: 'EU API', capacity: measured(1_000, 'req/s'), in: { domain: 'region', part: 'eu' }, over: 'x' },
      usApi: { name: 'US API', capacity: measured(800, 'req/s'), in: { domain: 'region', part: 'us' }, over: 'x' },
    },
    stages: {
      router: noSplit
        ? pass('router')
        : split({
            component: 'router',
            to: [
              { stages: ['euApi'], share: 0.6 },
              { stages: ['usApi'], share: 0.4 },
            ],
          }),
      euApi: pass('euApi'),
      usApi: pass('usApi'),
      refused: lost({ from: noSplit ? ['router', 'euApi'] : ['router', 'euApi', 'usApi'] }),
      out: sink(),
    },
    routes: { orders: noSplit ? ['router', 'euApi', 'out'] : ['router', 'out'] },
  })

/** A simulated minute with the EU out: how the dots ended, and the stages they passed. */
const run = (noSplit: boolean) => {
  const m = shop(noSplit)
  const sim = createSim(m, m.evaluate({ load: 1, down: 'eu' } as never), { seed: 4, speed: 10 })
  const ends = new Set<string>()
  const passed = new Set<string>()
  for (let i = 0; i < 60 * 60; i++) {
    sim.step(1 / 60)
    for (const d of sim.particles) {
      if (d.to.stage) passed.add(d.to.stage)
      if (d.phase === 'fade') ends.add(`${d.to.stage}:${d.outcome}`)
    }
  }
  return { ends: [...ends].sort(), passed }
}

describe('a named part of a domain down', () => {
  it('sends every dot the way that is left', () => {
    const { ends, passed } = run(false)
    expect(ends).toEqual(['out:delivered'])
    expect(passed.has('usApi')).toBe(true)
    expect(passed.has('euApi')).toBe(false)
  })

  it('turns every dot away at a box of the part with no split in front, into its lost box', () => {
    expect(run(true).ends).toEqual(['refused:rejected'])
  })
})
