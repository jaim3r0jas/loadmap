import { describe, expect, it } from 'vitest'
import { fitScaling } from '../src/scaling'

// a pool whose one pod handles 500 a second, with 3 % contention and 0.05 % coherency
const usl = (n: number) => (500 * n) / (1 + 0.03 * (n - 1) + 0.0005 * n * (n - 1))
const sizes = [1, 2, 4, 8, 16, 32]

describe('a scaling curve', () => {
  it('recovers the contention and coherency of points on the curve, and where it peaks', () => {
    const f = fitScaling(
      sizes.map((pods) => ({ pods, rate: usl(pods) })),
      { x: 'pods', y: 'rate', source: 'load test' },
    )
    expect(f.lambda).toBeCloseTo(500, 6)
    expect(f.sigma).toBeCloseTo(0.03, 9)
    expect(f.kappa).toBeCloseTo(0.0005, 9)
    expect(f.peak).toBeCloseTo(Math.sqrt(0.97 / 0.0005), 6)
    expect(f(16)).toBeCloseTo(usl(16), 6)
    expect(f.r2).toBeCloseTo(1, 9)
    expect(f).toMatchObject({ curve: 'usl', n: 6, x: 'pods', y: 'rate', source: 'load test', provenance: 'measured' })
  })

  it('holds at 0 a coefficient no system has, and has no peak without coherency', () => {
    // twice the pods, twice the rate: no contention, no coherency
    const f = fitScaling(
      sizes.map((n) => ({ n, c: 100 * n * (1 + 0.001 * Math.sin(n)) })),
      { x: 'n', y: 'c' },
    )
    expect(f.sigma).toBeGreaterThanOrEqual(0)
    expect(f.kappa).toBeGreaterThanOrEqual(0)
    const g = fitScaling(
      sizes.map((n) => ({ n, c: 100 * n })),
      { x: 'n', y: 'c' },
    )
    expect(g.peak).toBe(Number.POSITIVE_INFINITY)
  })

  it('needs three sizes and capacities above 0', () => {
    expect(() =>
      fitScaling(
        [
          { n: 1, c: 1 },
          { n: 2, c: 2 },
        ],
        { x: 'n', y: 'c' },
      ),
    ).toThrow('three distinct sizes')
    expect(() =>
      fitScaling(
        [
          { n: 1, c: 1 },
          { n: 2, c: 0 },
          { n: 3, c: 3 },
        ],
        { x: 'n', y: 'c' },
      ),
    ).toThrow('above 0')
  })
})
