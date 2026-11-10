import { logGamma } from './latency'
import { quantile, type TimeSeries } from './measure'

/**
 * Drift in measured data: where a series shifted (change points), whether two windows differ (a two-sample test with a
 * dead zone), and whether a value left the band its history sets. Deterministic: no random permutations, so the same
 * data gives the same report. Imported on its own (`@loadmap/core/drift`); no page loads it.
 */

/** A shift found in a series: where, how large, and how sure. */
export interface ChangePoint {
  /** The index of the first point after the shift, and its time. */
  index: number
  t: number
  /** The means before and after it, in the series' unit. */
  before: number
  after: number
  /** (after − before) ÷ |before|: 0.2 is 20 % higher, whatever the sign. Null when the mean before is 0. */
  change: number | null
  /** Welch's t-test between the two sides. */
  p: number
}

export interface ChangePointOptions {
  /** A shift counts below this p-value. Default 0.001, as Apache Otava. */
  pValue?: number
  /** The fewest points on either side of a shift. Default 5. */
  minSize?: number
  /** A longer series is averaged into this many buckets first, keeping the cost quadratic in it. Default 500. */
  maxPoints?: number
}

/**
 * Change points by E-divisive (Matteson and James, α = 1), with each split kept only when Welch's t-test between its
 * sides is significant, as Apache Otava does in place of a permutation test. Binary segmentation: the best split of a
 * segment, then of each side.
 */
export function changePoints(series: TimeSeries, o: ChangePointOptions = {}): ChangePoint[] {
  const pValue = o.pValue ?? 0.001
  const minSize = Math.max(2, o.minSize ?? 5)
  const pts = bucket(series, o.maxPoints ?? 500)
  const xs = pts.map((p) => p[1])
  const found: ChangePoint[] = []
  const split = (s: number, e: number) => {
    const tau = bestSplit(xs, s, e, minSize)
    if (tau == null) return
    const left = xs.slice(s, tau)
    const right = xs.slice(tau, e)
    const p = welch(left, right)
    if (!(p < pValue)) return
    const before = mean(left)
    const after = mean(right)
    found.push({ index: tau, t: pts[tau]![0], before, after, change: relative(before, after), p })
    split(s, tau)
    split(tau, e)
  }
  split(0, xs.length)
  return found.sort((a, b) => a.index - b.index)
}

/** The split of xs[s, e) that maximizes the energy statistic, with at least minSize points on each side. */
function bestSplit(xs: readonly number[], s: number, e: number, minSize: number): number | null {
  if (e - s < 2 * minSize) return null
  const d = (i: number, j: number) => Math.abs(xs[i]! - xs[j]!)
  // left = [s, tau), right = [tau, e): within-left, within-right and cross sums of distances, moved one point at a time
  const first = s + minSize
  let within = { left: 0, right: 0 }
  let cross = 0
  for (let i = s; i < first; i++) for (let k = i + 1; k < first; k++) within.left += d(i, k)
  for (let j = first; j < e; j++) for (let k = j + 1; k < e; k++) within.right += d(j, k)
  for (let i = s; i < first; i++) for (let j = first; j < e; j++) cross += d(i, j)
  let best: { tau: number; q: number } | null = null
  for (let tau = first; tau <= e - minSize; tau++) {
    const m = tau - s
    const n = e - tau
    const energy = (2 * cross) / (m * n) - (2 * within.left) / (m * (m - 1)) - (2 * within.right) / (n * (n - 1))
    const q = ((m * n) / (m + n)) * energy
    if (!best || q > best.q) best = { tau, q }
    if (tau === e - minSize) break
    // point tau moves from the right to the left
    let toLeft = 0
    let toRight = 0
    for (let i = s; i < tau; i++) toLeft += d(i, tau)
    for (let j = tau + 1; j < e; j++) toRight += d(j, tau)
    within = { left: within.left + toLeft, right: within.right - toRight }
    cross = cross - toLeft + toRight
  }
  return best?.tau ?? null
}

/** A long series as at most `max` points, each the mean of a run of consecutive ones at the run's first time. */
function bucket(series: TimeSeries, max: number): TimeSeries {
  if (series.length <= max) return series
  const size = Math.ceil(series.length / max)
  const out: [number, number][] = []
  for (let i = 0; i < series.length; i += size) {
    const run = series.slice(i, i + size)
    out.push([run[0]![0], mean(run.map((p) => p[1]))])
  }
  return out
}

/** Two windows compared: is the second one higher, lower, or the same as far as the test and the dead zone go? */
export interface WindowComparison {
  /** Two-sided p-value of the Mann-Whitney U test. */
  p: number
  /** (mean(after) − mean(before)) ÷ |mean(before)|. Null when the mean before is 0. */
  change: number | null
  verdict: 'higher' | 'lower' | 'same'
}

export interface WindowOptions {
  /** How sure the test must be. Default 0.98, as Kayenta. */
  confidence?: number
  /** A shift smaller than this share never alerts, however sure. Default 0.05. */
  deadZone?: number
}

/**
 * Kayenta's judge for two windows: a Mann-Whitney U test at a set confidence, and a dead zone on the change of the
 * mean, so a tiny shift never alerts. The normal approximation, corrected for ties and for continuity.
 */
export function compareWindows(
  before: readonly number[],
  after: readonly number[],
  o: WindowOptions = {},
): WindowComparison {
  const confidence = o.confidence ?? 0.98
  const deadZone = o.deadZone ?? 0.05
  const p = mannWhitney(before, after)
  const mb = mean(before)
  const change = relative(mb, mean(after))
  const moved = change == null ? mean(after) !== 0 : Math.abs(change) > deadZone
  const verdict = p < 1 - confidence && moved ? (mean(after) > mb ? 'higher' : 'lower') : 'same'
  return { p, change, verdict }
}

/** The two-sided p-value of the Mann-Whitney U test between two samples. */
export function mannWhitney(a: readonly number[], b: readonly number[]): number {
  const n1 = a.length
  const n2 = b.length
  if (!n1 || !n2) return 1
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v)
  const n = all.length
  let r1 = 0
  let ties = 0
  for (let i = 0; i < n; ) {
    let j = i
    while (j + 1 < n && all[j + 1]!.v === all[i]!.v) j++
    // the run i..j shares the mean of its ranks, which are 1-based
    const rank = (i + j + 2) / 2
    for (let k = i; k <= j; k++) if (all[k]!.g === 0) r1 += rank
    const t = j - i + 1
    ties += t ** 3 - t
    i = j + 1
  }
  const u = r1 - (n1 * (n1 + 1)) / 2
  const mu = (n1 * n2) / 2
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - ties / (n * (n - 1))))
  if (sigma === 0) return 1
  const z = Math.max(0, Math.abs(u - mu) - 0.5) / sigma
  return Math.min(1, 2 * (1 - normalCdf(z)))
}

/** How a history becomes a band, as Bencher's thresholds: a fixed one, a share around the mean, a t-test or the IQR. */
export type ThresholdTest =
  | { test: 'static'; lower?: number; upper?: number }
  | { test: 'percentage'; share: number }
  | { test: 't_test'; confidence?: number }
  | { test: 'iqr'; k?: number }

export interface ThresholdOptions {
  /** The last runs it reads. Default 30. */
  window?: number
  /** The fewest runs it needs before it judges. Default 5. */
  min?: number
}

/** A value against the band its history sets; null when the history is too short to judge. */
export interface ThresholdResult {
  lower: number | null
  upper: number | null
  /** How many runs the band was built from. */
  samples: number
  outside: 'above' | 'below' | null
}

/**
 * A value judged against main's own history, as Bencher does: the band from the last `window` runs (at least `min`),
 * by the test, and whether the value is above or below it. `t_test` bounds the mean ± t × the standard deviation of a
 * new run (√(1 + 1/n)) at the confidence, two-sided; `iqr` is Q1 − k × IQR to Q3 + k × IQR (k = 1.5).
 */
export function threshold(
  history: readonly number[],
  value: number,
  t: ThresholdTest = { test: 't_test' },
  o: ThresholdOptions = {},
): ThresholdResult | null {
  const xs = history.slice(-(o.window ?? 30))
  if (t.test !== 'static' && xs.length < Math.max(2, o.min ?? 5)) return null
  let lower: number | null = null
  let upper: number | null = null
  if (t.test === 'static') {
    lower = t.lower ?? null
    upper = t.upper ?? null
  } else if (t.test === 'percentage') {
    const m = mean(xs)
    lower = m * (1 - t.share)
    upper = m * (1 + t.share)
  } else if (t.test === 't_test') {
    const m = mean(xs)
    const s = Math.sqrt(variance(xs))
    const k = tQuantile((1 + (t.confidence ?? 0.99)) / 2, xs.length - 1) * s * Math.sqrt(1 + 1 / xs.length)
    lower = m - k
    upper = m + k
  } else {
    const sorted = [...xs].sort((a, b) => a - b)
    const q1 = quantile(sorted, 0.25)
    const q3 = quantile(sorted, 0.75)
    const k = (t.k ?? 1.5) * (q3 - q1)
    lower = q1 - k
    upper = q3 + k
  }
  const outside = upper != null && value > upper ? 'above' : lower != null && value < lower ? 'below' : null
  return { lower, upper, samples: xs.length, outside }
}

// statistics

const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length

/** How far after is from before, as a share of before's size: a negative series keeps the sign of its change. */
const relative = (before: number, after: number) => (before === 0 ? null : (after - before) / Math.abs(before))

/** The sample variance (n − 1). */
function variance(xs: readonly number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)
}

/** The two-sided p-value of Welch's t-test between two samples. */
export function welch(a: readonly number[], b: readonly number[]): number {
  const va = variance(a) / a.length
  const vb = variance(b) / b.length
  const diff = mean(a) - mean(b)
  if (va + vb === 0) return diff === 0 ? 1 : 0
  const t = diff / Math.sqrt(va + vb)
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1))
  return tTwoSided(t, df)
}

/** P(|T| ≥ |t|) for Student's t with df degrees of freedom: the regularized incomplete beta I(df/(df+t²); df/2, 1/2). */
export function tTwoSided(t: number, df: number): number {
  return incompleteBeta(df / (df + t * t), df / 2, 0.5)
}

/** The q-quantile of Student's t with df degrees of freedom, by bisection on its distribution. */
function tQuantile(q: number, df: number): number {
  // P(T ≤ x) = 1 − tTwoSided(x)/2 for x ≥ 0
  let lo = 0
  let hi = 1
  while (1 - tTwoSided(hi, df) / 2 < q) hi *= 2
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    if (1 - tTwoSided(mid, df) / 2 < q) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Φ(z): the standard normal distribution, through erf (Abramowitz and Stegun 7.1.26, error below 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2
}

/** The regularized incomplete beta function I_x(a, b), by its continued fraction (Numerical Recipes 6.4). */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  // the fraction converges fast on this side; the other side by symmetry
  if (x < (a + 1) / (a + b + 2)) return (front * betaFraction(x, a, b)) / a
  return 1 - (front * betaFraction(1 - x, b, a)) / b
}

function betaFraction(x: number, a: number, b: number): number {
  const tiny = 1e-300
  let c = 1
  let d = 1 - ((a + b) * x) / (a + 1)
  if (Math.abs(d) < tiny) d = tiny
  d = 1 / d
  let h = d
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 3e-14) break
  }
  return h
}
