import { describe, expect, it } from 'vitest'
import { checkout, workerCores } from './model'

describe('checkout model', () => {
  it('finds each crossing where the arithmetic puts it', () => {
    const s = checkout.evaluate()
    // the gateway carries 940 req/s per 1× against 20,000
    expect(s.components.gateway.full).toBeCloseTo(20_000 / 940, 6)
    expect(s.components.gateway.target).toBeCloseTo(10_000 / 940, 6)
    // the workers carry a + b × 940 × load cores against 3 pods × 2 cores
    expect(s.components.workers.full).toBeCloseTo((6 - workerCores.a) / (workerCores.b * 940), 6)
    // batched, the database needs 40 / 50 commits per 1×: 5,000×, past the search
    expect(s.components.db.full).toBe(Number.POSITIVE_INFINITY)
    expect(checkout.evaluate({ batch: false }).components.db.full).toBeCloseTo(100, 6)
  })

  it('ranks the components by when they reach the target', () => {
    const s = checkout.evaluate()
    expect(s.ranked.map((c) => c.id)).toEqual(['workers', 'gateway', 'db'])
    expect(s.firstLimit?.id).toBe('workers')
    expect(s.firstFull?.id).toBe('workers')
    // more pods move the first limit to the gateway
    expect(checkout.evaluate({ pods: 4 }).firstLimit?.id).toBe('gateway')
  })

  it('writes a verdict for each tier', () => {
    expect(checkout.evaluate({ load: 1 }).verdict).toEqual({
      tier: 'ok',
      text: 'At 1×, every component is under the 50 % target. It holds up to 10×; the worker pool is the first limit.',
    })
    expect(checkout.evaluate({ load: 15 }).verdict).toEqual({
      tier: 'warn',
      text: 'At 15×, everything still fits, but API gateway and the worker pool run above the 50 % target. The 50 % target holds up to 10×, limited by the worker pool.',
    })
    expect(checkout.evaluate({ load: 60, pods: 2 }).verdict).toEqual({
      tier: 'over',
      text: 'At 60×, the worker pool and API gateway are past capacity: messages wait in the topic and the lag keeps growing; clients get 429s. The 50 % target holds up to 6.4×, limited by the worker pool.',
    })
  })

  it('says when the first limit is an estimate', () => {
    const s = checkout.evaluate({ load: 1, pods: 4 })
    // 8 cores of workers outlast the gateway's estimated 20,000 req/s
    expect(s.firstLimit?.id).toBe('gateway')
    expect(s.verdict.text).toContain('API gateway is the first limit (capacity estimated)')
  })

  it('disables "rows per batch" while batching is off', () => {
    expect(checkout.isEnabled('rows', checkout.defaults())).toBe(true)
    expect(checkout.isEnabled('rows', { ...checkout.defaults(), batch: false })).toBe(false)
  })

  it('offers today, the declared presets and the two derived ones', () => {
    const labels = checkout.evaluate().presets.map((x) => x.label)
    expect(labels).toEqual(['Today · 1×', 'Black Friday', '50 % target · 10×', 'Runs out · 20×'])
    expect(checkout.evaluate().presets.at(-1)?.values).toEqual({ load: 20 })
  })

  it('lists every capacity with its provenance, and the fit', () => {
    const a = checkout.evaluate().assumptions
    expect(
      a.map((x) => (x.kind === 'capacity' ? `${x.component}: ${x.capacity.provenance}` : `fit: ${x.name}`)),
    ).toEqual(['gateway: estimated', 'workers: measured', 'db: estimated', 'fit: Worker CPU per request'])
  })

  it('resolves the stages for the current values', () => {
    const s = checkout.evaluate({ pods: 4, threads: 16 })
    expect(s.stages.workers).toMatchObject({ kind: 'workers', pods: 4, perPod: 16, fill: 'round-robin' })
    expect(s.stages.topic).toMatchObject({ kind: 'queue', partitions: { orders: 12, events: 24 } })
  })
})
