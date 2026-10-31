import { around, compare } from '@loadmap/core'
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
      text: 'At 1×, every component is under the 50 % target. It holds up to 10× (around February 2030); the worker pool is the first limit.',
    })
    expect(checkout.evaluate({ load: 15 }).verdict).toEqual({
      tier: 'warn',
      text: 'At 15×, everything still fits, but API gateway and the worker pool run above the 50 % target. The 50 % target holds up to 10× (around February 2030), limited by the worker pool.',
    })
    expect(checkout.evaluate({ load: 60, pods: 2 }).verdict).toEqual({
      tier: 'over',
      text: 'At 60×, the worker pool and API gateway are past capacity: messages wait in the topic and the lag keeps growing; clients get 429s. The 50 % target holds up to 6.4× (around June 2029), limited by the worker pool.',
    })
  })

  it('says when the first limit is an estimate', () => {
    const s = checkout.evaluate({ load: 1, pods: 4 })
    // 8 cores of workers outlast the gateway's estimated 20,000 req/s
    expect(s.firstLimit?.id).toBe('gateway')
    expect(s.verdict.text).toContain('API gateway is the first limit (capacity estimated)')
  })

  it('compares today with the proposed design', () => {
    const c = compare(checkout, 10)
    const [today, proposed] = c.rows
    const cores = (n: number) => (n - workerCores.a) / (workerCores.b * 940)
    // today: 3 pods × 2 cores, the target at 3 cores and 100 % at 6
    expect([today!.label, today!.firstLimit?.id, today!.firstFull?.id]).toEqual(['Today', 'workers', 'workers'])
    expect(today!.target).toBeCloseTo(cores(3), 6)
    expect(today!.full).toBeCloseTo(cores(6), 6)
    // proposed: 6 pods (target at 6 cores, 100 % at 12) and two gateways (target at 20,000 / 940)
    expect([proposed!.label, proposed!.firstLimit?.id, proposed!.firstFull?.id]).toEqual([
      'Proposed',
      'workers',
      'workers',
    ])
    expect(proposed!.target).toBeCloseTo(cores(6), 6)
    expect(proposed!.full).toBeCloseTo(cores(12), 6)
    // 6 % a month from 2026-11-01: 10.0× is ln 10.0 / ln 1.06 = 39.5 months, 20.7× is 52.0, 42.2× is 64.2
    expect(
      [today!.targetDate, today!.fullDate, proposed!.targetDate, proposed!.fullDate].map((d) => around(d!)),
    ).toEqual(['around February 2030', 'around March 2031', 'around March 2031', 'around March 2032'])
    const change = Object.fromEntries(proposed!.components.map((x) => [x.id, x.change]))
    expect(change.gateway).toBeCloseTo(2, 9)
    expect(change.workers).toBeCloseTo(cores(6) / cores(3), 9)
    // batched, the database never reaches the target in either
    expect(change.db).toBe(1)
    expect(c.text).toBe(
      'Proposed buys more headroom: the 50 % target holds up to 20× (around March 2031), limited by the worker pool, against 10× (around February 2030) in Today.',
    )
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
