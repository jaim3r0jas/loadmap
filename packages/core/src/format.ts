/** A number for a reader: 1,234 / 12.3 / 0.4. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '—'
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString('en-US')
  return (Math.round(n * 10) / 10).toString()
}

/** A compact number: 980 / 1.2k / 34k / 1.5M. */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '—'
  const a = Math.abs(n)
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${Math.round(n / 1000)}k`
  if (a >= 1000) return `${(n / 1000).toFixed(1)}k`
  return Math.round(n).toString()
}

/** A load multiple, rounded down so it never promises more than the model: 2.6× / 53×. */
export function multiple(u: number | null, searchMax = 2000): string {
  if (u == null) return '—'
  if (!Number.isFinite(u)) return `beyond ${fmt(searchMax)}×`
  return u >= 10 ? `${Math.floor(u)}×` : `${Math.floor(u * 10) / 10}×`
}

/**
 * Two load multiples: "7.4×" when both edges read the same, else "between 7.4× and 10×" or, short, "7.4×–10×". An
 * edge that never comes reads "7.4× or more" ("≥ 7.4×").
 */
export function multiples(r: { low: number; high: number }, searchMax = 2000, short = false): string {
  const [lo, hi] = [multiple(r.low, searchMax), multiple(r.high, searchMax)]
  if (lo === hi) return lo
  if (!Number.isFinite(r.high)) return short ? `≥ ${lo}` : `${lo} or more`
  return short ? `${lo}–${hi}` : `between ${lo} and ${hi}`
}

/** When two edges are reached: "(around March 2029)", "(between March 2029 and May 2030)" or "(… or later)". */
export function months(low: Date | null, high: Date | null): string {
  if (!low) return ''
  if (!high) return ` (${around(low)} or later)`
  return monthOf(low) === monthOf(high) ? ` (${around(low)})` : ` (between ${monthOf(low)} and ${monthOf(high)})`
}

/** A percentage of a 0–1 share: 50 %. */
export function pct(share: number): string {
  return `${Math.round(share * 100)} %`
}

/** A duration in seconds for a meter: 0 s / 42 s / 3 min / > 1 h / stalled. */
export function secs(s: number): string {
  if (!Number.isFinite(s)) return 'stalled'
  if (s < 1) return '0 s'
  if (s < 60) return `${Math.round(s)} s`
  if (s < 3600) return `${Math.round(s / 60)} min`
  return '> 1 h'
}

/** The 1-2-5 step at or above x: 1, 2, 5, 10, 20, 50, … */
export function niceStep(x: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(x, 1)))
  const f = x / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p
}

/** "a", "a and b", "a, b and c". */
export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** A month in UTC, "March 2028" or short "Mar 2028". Fixed names, whatever the locale. */
export function monthOf(d: Date, short = false): string {
  const name = MONTHS[d.getUTCMonth()]!
  return `${short ? name.slice(0, 3) : name} ${d.getUTCFullYear()}`
}

/** A date as a reader plans with it, by month: "around March 2028". */
export function around(d: Date): string {
  return `around ${monthOf(d)}`
}
