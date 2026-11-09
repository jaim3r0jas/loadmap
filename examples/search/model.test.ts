import { check } from '@loadmap/core'
import { describe, expect, it } from 'vitest'
import { search } from './model'

const at = (values: Parameters<typeof search.evaluate>[0]) => search.evaluate(values)

describe('search model', () => {
  it('finds each crossing where the arithmetic puts it, and the limiter guards what is behind it', () => {
    const c = at({}).components
    // 300 searches/s per 1× against a limit of 6,000
    expect(c.limiter.full).toBeCloseTo(6_000 / 300, 6)
    // what passes the limiter stops at 6,000/s: 6 of the API's 8 cores, and 600 misses/s on two shards of 1,000
    expect(c.api.full).toBe(Number.POSITIVE_INFINITY)
    expect(c.db.full).toBe(Number.POSITIVE_INFINITY)
    expect(at({ load: 50 }).at.api.searches).toBeCloseTo(6_000, 6)
    // with three hits in ten, 210 misses/s per 1×, half to each shard
    expect(at({ hit: 0.3 }).components.db.full).toBeCloseTo(1_000 / 105, 6)
    expect(at({ hit: 0.3 }).components.db2.full).toBeCloseTo(1_000 / 105, 6)
    expect(at({ hit: 0.3 }).paths.searches.map((w) => [w.stages.at(-1), w.share])).toEqual([
      ['db', 0.5],
      ['db2', 0.5],
    ])
  })

  it('tells its story: the limiter first, the index once the cache is cold, then the retries', () => {
    const [peak, cold, past, proposed] = search.story.map((st) => search.evaluate(st.values))
    expect(peak!.firstLimit?.id).toBe('limiter')
    expect(peak!.verdict.text).toMatch(/^At 4×, every component is under the 50 % target/)
    // three hits in ten: 210 misses/s per 1×, 105 on each shard estimated at 1,000 ± 30 %: the first in order of a tie
    expect(cold!.firstLimit?.id).toBe('db')
    expect(cold!.target?.low).toBeCloseTo((700 * 0.5) / 105, 6)
    // at 30×, 9,000 searches/s against 6,000: three retries each multiply the attempts
    const r = past!.retry.searches!
    expect(r.rate).toBeCloseTo(9_000, 6)
    expect(r.attempts).toBeGreaterThan(20_000)
    // the proposal: a limit of 12,000 turns nothing away at 30×, so the attempts are the searches
    expect(proposed!.retry.searches!.attempts).toBeCloseTo(9_000, 6)
  })

  it('caps the retries with the budget at a tenth more', () => {
    const r = at({ load: 30, budget: true }).retry.searches!
    expect(r.attempts).toBeCloseTo(9_900, 0)
  })

  it('keeps its promises, in both scenarios', () => {
    expect(check(search).map((x) => [x.expectation.label, x.ok])).toEqual([
      ['Today keeps 10×', true],
      ['Proposed keeps 20×', true],
    ])
  })
})
