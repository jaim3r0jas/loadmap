import { describe, expect, it } from 'vitest'
import { changePoints, compareWindows, mannWhitney, normalCdf, threshold, tTwoSided, welch } from '../src/drift'

// a deterministic wobble: the same "noise" on every run
const wobble = (i: number) => 0.4 * Math.sin(i * 1.7) + 0.3 * Math.cos(i * 0.9)
const series = (values: readonly number[]) => values.map((v, i) => [1794000000 + 300 * i, v] as const)

describe('the distributions', () => {
  it('agree with the tables', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7)
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6)
    expect(normalCdf(-2.326348)).toBeCloseTo(0.01, 6)
    // two-sided Student's t: t(10) at 2.228 is 5 %, t(5) at 2.015 is 10 %, t(1) at 12.706 is 5 %
    expect(tTwoSided(2.228139, 10)).toBeCloseTo(0.05, 5)
    expect(tTwoSided(2.015048, 5)).toBeCloseTo(0.1, 5)
    expect(tTwoSided(12.7062, 1)).toBeCloseTo(0.05, 4)
    expect(tTwoSided(0, 7)).toBeCloseTo(1, 10)
  })

  it('give Welch’s t-test and the Mann-Whitney U test as scipy does', () => {
    // scipy.stats.ttest_ind([1..5], [2..6], equal_var=False): t = −1, df = 8, p = 0.3466
    expect(welch([1, 2, 3, 4, 5], [2, 3, 4, 5, 6])).toBeCloseTo(0.346594, 5)
    expect(welch([3, 3, 3], [3, 3, 3])).toBe(1)
    expect(welch([3, 3, 3], [4, 4, 4])).toBe(0)
    // scipy.stats.mannwhitneyu([1..5], [6..10], method='asymptotic'): p = 0.01219
    expect(mannWhitney([1, 2, 3, 4, 5], [6, 7, 8, 9, 10])).toBeCloseTo(0.012186, 5)
    // with ties: scipy gives 0.0083675
    expect(mannWhitney([1, 2, 2, 3, 3, 3], [3, 4, 4, 5, 5, 5])).toBeCloseTo(0.0083675, 6)
    expect(mannWhitney([2, 2, 2], [2, 2, 2])).toBe(1)
  })
})

describe('changePoints', () => {
  it('finds one step where it is, how large it is, and how sure', () => {
    const xs = Array.from({ length: 60 }, (_, i) => (i < 30 ? 10 : 15) + wobble(i))
    const found = changePoints(series(xs))
    expect(found).toHaveLength(1)
    const [c] = found
    expect(c!.index).toBe(30)
    expect(c!.t).toBe(1794000000 + 300 * 30)
    expect(c!.before).toBeCloseTo(10, 0)
    expect(c!.after).toBeCloseTo(15, 0)
    expect(c!.change).toBeCloseTo(0.5, 1)
    expect(c!.p).toBeLessThan(1e-10)
  })

  it('finds nothing in noise, and two steps where there are two', () => {
    expect(changePoints(series(Array.from({ length: 80 }, (_, i) => 10 + wobble(i))))).toEqual([])
    const two = Array.from({ length: 90 }, (_, i) => (i < 30 ? 10 : i < 60 ? 14 : 8) + wobble(i))
    expect(changePoints(series(two)).map((c) => c.index)).toEqual([30, 60])
    // too short to split: nothing
    expect(changePoints(series([1, 2, 3, 9, 9]))).toEqual([])
  })

  it('reads a long series in buckets, the same way every time', () => {
    const xs = Array.from({ length: 2016 }, (_, i) => (i < 1400 ? 100 : 130) + 5 * wobble(i))
    const a = changePoints(series(xs))
    expect(a).toHaveLength(1)
    // 2016 points in buckets of 5: the step at 1400 is bucket 280
    expect(a[0]!.index).toBe(280)
    expect(changePoints(series(xs))).toEqual(a)
  })
})

describe('compareWindows', () => {
  const before = Array.from({ length: 40 }, (_, i) => 100 + 3 * wobble(i))
  it('says higher or lower only when the test is sure and the shift is past the dead zone', () => {
    const higher = compareWindows(
      before,
      before.map((v) => v * 1.2),
    )
    expect(higher.verdict).toBe('higher')
    expect(higher.change).toBeCloseTo(0.2, 6)
    expect(higher.p).toBeLessThan(0.02)
    expect(
      compareWindows(
        before,
        before.map((v) => v * 0.8),
      ).verdict,
    ).toBe('lower')
    // sure, but 2 %: inside the dead zone
    const tiny = compareWindows(
      before,
      before.map((v) => v + 4),
    )
    expect(tiny.p).toBeLessThan(0.02)
    expect(tiny.verdict).toBe('same')
    expect(
      compareWindows(
        before,
        before.map((v) => v + 4),
        { deadZone: 0.01 },
      ).verdict,
    ).toBe('higher')
    // the same window: nothing
    expect(compareWindows(before, before).verdict).toBe('same')
  })
})

describe('threshold', () => {
  const history = [10, 11, 9, 10, 10.5, 9.5, 10, 11, 9, 10]
  it('builds a band from main’s history and says which side a value left it by', () => {
    // mean 10, s 0.7071, t(9) at 99 % two-sided 3.2498 (scipy t.ppf(0.995, 9)), √(1 + 1/10): ±2.4101
    const t = threshold(history, 13)!
    expect(t.lower).toBeCloseTo(10 - 2.4101, 3)
    expect(t.upper).toBeCloseTo(10 + 2.4101, 3)
    expect(t.outside).toBe('above')
    expect(threshold(history, 10.5)!.outside).toBeNull()
    expect(threshold(history, 7.5, { test: 't_test' })!.outside).toBe('below')
    expect(threshold(history, 11.6, { test: 'percentage', share: 0.15 })).toMatchObject({
      outside: 'above',
      samples: 10,
    })
    // Q1 9.625, Q3 10.375, IQR 0.75: from 8.5 to 11.5
    expect(threshold(history, 11.6, { test: 'iqr' })).toMatchObject({ lower: 8.5, upper: 11.5, outside: 'above' })
    expect(threshold([], 99, { test: 'static', upper: 50 })!.outside).toBe('above')
  })

  it('judges nothing on a history too short, and reads only its window', () => {
    expect(threshold([10, 11, 9], 50)).toBeNull()
    expect(threshold([10, 11, 9], 50, { test: 't_test' }, { min: 3 })!.outside).toBe('above')
    // the last 3 runs only: 20, 21, 19
    expect(
      threshold([1, 2, 3, 20, 21, 19], 20.5, { test: 'percentage', share: 0.1 }, { window: 3, min: 3 })!.outside,
    ).toBeNull()
  })
})
