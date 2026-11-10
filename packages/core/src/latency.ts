/**
 * How long a unit takes: each stage with a service time is one queue (M/M/1), so its time is exponential with a mean of
 * service ÷ (1 − utilization). A way through is the sum of its stages, fitted to a gamma distribution by its mean and
 * variance; the ways of a flow mix by their shares. An estimate of the shape, not a measurement.
 */

/** The percentiles a latency has, and an expectation may hold. */
export const PERCENTILES = ['p50', 'p95', 'p99'] as const

/** A flow's time through, in seconds: the mean and three percentiles; Infinity once a stage on a way is past full. */
export interface Latency {
  mean: number
  p50: number
  p95: number
  p99: number
  /** Components on its way whose time is not known (no published figure, no data): they count as no time. */
  unknown?: readonly string[]
  /** With a timeout: the share of units slower than it, which fail (and are retried when the flow retries). */
  timedOut?: number
  /**
   * With a timeout, the same for each way: the units that end path `path` of `ev.paths` (or that the cache
   * `answeredAt` answers on it), and the share of them slower than the timeout.
   */
  ways?: readonly { path: number; answeredAt?: string; timedOut: number }[]
}

/** One way through: the share of units that take it, and the mean and variance of their time. */
export interface WayTime {
  share: number
  mean: number
  variance: number
}

/** ln Γ(x), by Lanczos's approximation (g = 7, nine terms). */
export function logGamma(x: number): number {
  const g = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  const z = x - 1
  let s = g[0]!
  for (let i = 1; i < 9; i++) s += g[i]! / (z + i)
  const t = z + 7.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(s)
}

/** The regularized lower incomplete gamma P(a, x): by its series below a + 1, by Lentz's continued fraction above. */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0
  if (!Number.isFinite(x)) return 1
  const front = Math.exp(a * Math.log(x) - x - logGamma(a))
  if (x < a + 1) {
    let term = 1 / a
    let sum = term
    for (let n = 1; n < 500; n++) {
      term *= x / (a + n)
      sum += term
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break
    }
    return Math.min(1, sum * front)
  }
  const tiny = 1e-300
  let b = x + 1 - a
  let c = 1 / tiny
  let d = 1 / b
  let h = d
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < tiny) d = tiny
    c = b + an / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-15) break
  }
  return Math.max(0, 1 - front * h)
}

/** The share of a way's units done within t seconds. */
function done(w: WayTime, t: number): number {
  if (!Number.isFinite(w.mean)) return 0
  if (w.variance <= 0 || w.mean <= 0) return t >= w.mean ? 1 : 0
  return gammaP((w.mean * w.mean) / w.variance, (t * w.mean) / w.variance)
}

/** The share of the units not done within t seconds, over every way. */
export function beyond(all: readonly WayTime[], t: number): number {
  const ways = all.filter((w) => w.share > 0)
  const total = ways.reduce((a, w) => a + w.share, 0)
  return total > 0 ? Math.max(0, 1 - ways.reduce((a, w) => a + w.share * done(w, t), 0) / total) : 0
}

/** The time within which a share q of the units are done, over every way. */
export function quantile(all: readonly WayTime[], q: number): number {
  const ways = all.filter((w) => w.share > 0)
  const total = ways.reduce((a, w) => a + w.share, 0)
  const lost = ways.filter((w) => !Number.isFinite(w.mean)).reduce((a, w) => a + w.share, 0)
  if (total <= 0) return 0
  // a lost share of 1 − q, up to rounding, never lets the share done reach q
  if (lost / total >= 1 - q - 1e-12) return Number.POSITIVE_INFINITY
  const at = (t: number) => ways.reduce((a, w) => a + w.share * done(w, t), 0) / total
  // a gamma's q-quantile is under mean + 12 standard deviations for the shapes a sum of exponentials takes
  let hi = Math.max(
    1e-12,
    ...ways.filter((w) => Number.isFinite(w.mean)).map((w) => w.mean + 12 * Math.sqrt(Math.max(0, w.variance))),
  )
  for (let i = 0; at(hi) < q && i < 200; i++) hi *= 2
  let lo = 0
  for (let i = 0; i < 100 && hi - lo > hi * 1e-12; i++) {
    const mid = (lo + hi) / 2
    if (at(mid) < q) lo = mid
    else hi = mid
  }
  return hi
}

/** The mean and percentiles over the ways. */
export function latencyOf(all: readonly WayTime[]): Latency {
  const ways = all.filter((w) => w.share > 0)
  const total = ways.reduce((a, w) => a + w.share, 0)
  const mean = total > 0 ? ways.reduce((a, w) => a + w.share * w.mean, 0) / total : 0
  return { mean, p50: quantile(ways, 0.5), p95: quantile(ways, 0.95), p99: quantile(ways, 0.99) }
}
