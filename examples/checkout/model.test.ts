import { assertHolds, check, compare } from '@loadmap/core'
import { around } from '@loadmap/core/format'
import { describe, expect, it } from 'vitest'
import { checkout, workerCores } from './model'

describe('checkout model', () => {
  it('finds each crossing where the arithmetic puts it', () => {
    const s = checkout.evaluate()
    // the gateway carries 940 req/s per 1× against 20,000
    expect(s.components.gateway.full).toBeCloseTo(20_000 / 940, 6)
    expect(s.components.gateway.target).toBeCloseTo(10_000 / 940, 6)
    // estimated ±30 %: 14,000 to 26,000 req/s
    expect(s.components.gateway.targetRange?.low).toBeCloseTo(7_000 / 940, 6)
    expect(s.components.gateway.targetRange?.high).toBeCloseTo(13_000 / 940, 6)
    expect(s.components.gateway.fullRange?.low).toBeCloseTo(14_000 / 940, 6)
    expect(s.components.gateway.fullRange?.high).toBeCloseTo(26_000 / 940, 6)
    // the workers carry a + b × 940 × load cores against 3 pods × 2 cores
    expect(s.components.workers.full).toBeCloseTo((6 - workerCores.a) / (workerCores.b * 940), 6)
    // batched, the database needs 40 / 50 commits per 1×: 5,000×, past the search
    expect(s.components.db.full).toBe(Number.POSITIVE_INFINITY)
    expect(checkout.evaluate({ batch: false }).components.db.full).toBeCloseTo(100, 6)
  })

  it('ranks the components by when they may reach the target', () => {
    const s = checkout.evaluate()
    // the gateway's pessimistic 7.4× comes before the workers' exact 10×, though its stated 10.6× does not
    expect(s.ranked.map((c) => c.id)).toEqual(['gateway', 'workers', 'conns', 'db'])
    // 40 orders/s a load, each holding a connection 20 ms: 0.8 of 100 a load, half of them at 62.5×
    expect(s.components.conns.demand).toBeCloseTo(8, 9)
    expect(s.components.conns.target).toBeCloseTo(62.5, 6)
    expect(s.firstLimit?.id).toBe('gateway')
    expect(s.firstFull?.id).toBe('gateway')
    expect(s.target?.low).toBeCloseTo(7_000 / 940, 6)
    expect(s.target?.high).toBe(s.components.workers.target)
    // fewer pods put the workers first at either bound
    expect(checkout.evaluate({ pods: 2 }).firstLimit?.id).toBe('workers')
  })

  it('names the gateway as the capacity to measure', () => {
    expect(checkout.evaluate().measure).toMatchObject({
      component: 'gateway',
      firstLimit: 'workers',
      text: 'Measuring the API gateway would change the answer: at its stated capacity, the worker pool is the first limit and the 50 % target holds up to 10×.',
    })
    // with 4 pods the gateway is first either way: measuring it only narrows the range
    expect(checkout.evaluate({ pods: 4 }).measure?.text).toBe(
      'Measuring the API gateway would narrow this most: at its stated capacity, the 50 % target holds up to 10×.',
    )
    // with 2 pods the workers come first at either bound: nothing to measure
    expect(checkout.evaluate({ pods: 2 }).measure).toBeNull()
  })

  it('keeps the headroom it promises', () => {
    assertHolds(checkout)
    expect(check(checkout).map((r) => r.message)).toEqual([
      'the 50 % target holds up to between 7.4× and 10×, limited by the API gateway (capacity estimated ±30 %)',
      'the 50 % target holds up to between 14× and 20× in Proposed, limited by the API gateway (capacity estimated ±30 %)',
    ])
    // a single gateway in Proposed would not
    expect(() => assertHolds(checkout, [{ scenario: 'Proposed', target: 14 }, { target: 8 }])).toThrow(
      '1 of 2 expectations failed:\n- expected at least 8×, but the 50 % target holds up to between 7.4× and 10×, limited by the API gateway (capacity estimated ±30 %)',
    )
  })

  it('writes a verdict for each tier', () => {
    expect(checkout.evaluate({ load: 1 }).verdict).toEqual({
      tier: 'ok',
      text: 'At 1×, every component is under the 50 % target. It holds up to between 7.4× and 10× (between September 2029 and February 2030); the API gateway is the first limit (capacity estimated ±30 %).',
    })
    expect(checkout.evaluate({ load: 12 }).verdict).toEqual({
      tier: 'warn',
      text: 'At 12×, everything still fits, but the API gateway and the worker pool run above the 50 % target. The 50 % target holds up to between 7.4× and 10× (between September 2029 and February 2030), limited by the API gateway (capacity estimated ±30 %).',
    })
    // past a pessimistic edge the verdict says what may already be happening: the gateway at 14,000 req/s
    expect(checkout.evaluate({ load: 15 }).verdict).toEqual({
      tier: 'warn',
      text: 'At 15×, everything fits at the stated capacities, but the API gateway may already be past capacity: clients get 429s. The 50 % target holds up to between 7.4× and 10× (between September 2029 and February 2030), limited by the API gateway (capacity estimated ±30 %).',
    })
    expect(checkout.evaluate({ load: 8 }).verdict).toEqual({
      tier: 'warn',
      text: 'At 8×, every component is under the 50 % target at its stated capacity, but the API gateway may already be above it. The 50 % target holds up to between 7.4× and 10× (between September 2029 and February 2030), limited by the API gateway (capacity estimated ±30 %).',
    })
    expect(checkout.evaluate({ load: 60, pods: 2 }).verdict).toEqual({
      tier: 'over',
      text: 'At 60×, the worker pool and the API gateway are past capacity: messages wait in the topic and the lag keeps growing; clients get 429s. The 50 % target holds up to 6.4× (around June 2029), limited by the worker pool.',
    })
  })

  it('says when the first limit is an estimate, and how sure', () => {
    const s = checkout.evaluate({ load: 1, pods: 4 })
    // 8 cores of workers outlast the gateway's estimated 20,000 req/s at either bound
    expect(s.firstLimit?.id).toBe('gateway')
    expect(s.verdict.text).toContain('between 7.4× and 13× (between September 2029 and July 2030)')
    expect(s.verdict.text).toContain('the API gateway is the first limit (capacity estimated ±30 %)')
  })

  it('compares today with the proposed design', () => {
    const c = compare(checkout, 10)
    const [today, proposed] = c.rows
    const cores = (n: number) => (n - workerCores.a) / (workerCores.b * 940)
    // today, on the pessimistic edge: the gateway at 14,000 req/s (target at 7,000 / 940, 100 % at 14,000 / 940);
    // at the high bounds the workers come first: 3 pods × 2 cores, the target at 3 cores and 100 % at 6
    expect([today!.label, today!.firstLimit?.id, today!.firstFull?.id]).toEqual(['Today', 'gateway', 'gateway'])
    expect(today!.target).toBeCloseTo(7_000 / 940, 6)
    expect(today!.full).toBeCloseTo(14_000 / 940, 6)
    expect(today!.targetRange?.high).toBeCloseTo(cores(3), 6)
    expect(today!.fullRange?.high).toBeCloseTo(cores(6), 6)
    // proposed: two gateways (twice the edges) and 6 pods (target at 6 cores, 100 % at 12)
    expect([proposed!.label, proposed!.firstLimit?.id, proposed!.firstFull?.id]).toEqual([
      'Proposed',
      'gateway',
      'gateway',
    ])
    expect(proposed!.target).toBeCloseTo(14_000 / 940, 6)
    expect(proposed!.full).toBeCloseTo(28_000 / 940, 6)
    expect(proposed!.targetRange?.high).toBeCloseTo(cores(6), 6)
    expect(proposed!.fullRange?.high).toBeCloseTo(cores(12), 6)
    // 6 % a month from 2026-11-01: 7.4× is ln 7.4 / ln 1.06 = 34.5 months, 14.9× is 46.4, 29.8× is 58.3
    expect(
      [today!.targetDate, today!.fullDate, proposed!.targetDate, proposed!.fullDate].map((d) => around(d!)),
    ).toEqual(['around September 2029', 'around September 2030', 'around September 2030', 'around September 2031'])
    const change = Object.fromEntries(proposed!.components.map((x) => [x.id, x.change]))
    expect(change.gateway).toBeCloseTo(2, 9)
    expect(change.workers).toBeCloseTo(cores(6) / cores(3), 9)
    // batched, the database never reaches the target in either
    expect(change.db).toBe(1)
    expect(c.text).toBe(
      'Proposed buys more headroom: the 50 % target holds up to between 14× and 20× (between September 2030 and March 2031), limited by the API gateway, against between 7.4× and 10× (between September 2029 and February 2030) in Today.',
    )
  })

  it('disables "rows per batch" while batching is off', () => {
    expect(checkout.isEnabled('rows', checkout.defaults())).toBe(true)
    expect(checkout.isEnabled('rows', { ...checkout.defaults(), batch: false })).toBe(false)
  })

  it('offers today, the declared presets and the two derived ones', () => {
    const labels = checkout.evaluate().presets.map((x) => x.label)
    // on the pessimistic edge: where it may already happen
    expect(labels).toEqual(['Today · 1×', 'Black Friday', '50 % target · 7.4×', 'Runs out · 14×'])
    expect(checkout.evaluate().presets.at(-1)?.values).toEqual({ load: 14 })
  })

  it('lists every capacity with its provenance, and the fit', () => {
    const a = checkout.evaluate().assumptions
    expect(
      a.map((x) => (x.kind === 'capacity' ? `${x.component}: ${x.capacity.provenance}` : `fit: ${x.name}`)),
    ).toEqual([
      'gateway: estimated',
      'workers: measured',
      'db: estimated',
      'conns: configured',
      'fit: Worker CPU per request',
    ])
  })

  it('resolves the stages for the current values', () => {
    const s = checkout.evaluate({ pods: 4, threads: 16 })
    expect(s.stages.workers).toMatchObject({ kind: 'workers', pods: 4, perPod: 16, fill: 'round-robin' })
    expect(s.stages.topic).toMatchObject({ kind: 'queue', partitions: { orders: 12, events: 24 } })
  })
})
