/**
 * How fast the load grows, compounded: 1× is the load on `asOf`, and every `per` it is `1 + rate` times the last.
 * Dates come from `asOf` alone, never from the clock, so a page and its recordings say the same thing on any day.
 */
export interface Growth {
  /** Growth per period, as a share: 0.06 for 6 % a month. */
  rate: number
  per: 'month' | 'year'
  /** The day the load was 1×: "2026-11-01" or "2026-11". */
  asOf: string
}

const AS_OF = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/

/** The day `asOf` names, at midnight UTC; null when it is not a real date. */
export function parseAsOf(asOf: string): Date | null {
  const m = AS_OF.exec(asOf)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 1)]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null
}

export function growth(o: Growth): Growth {
  if (!(o.rate > 0) || !Number.isFinite(o.rate)) throw new Error(`loadmap: growth needs a rate above 0, not ${o.rate}`)
  if (o.per !== 'month' && o.per !== 'year') throw new Error(`loadmap: growth is per month or per year, not "${o.per}"`)
  if (!parseAsOf(o.asOf)) throw new Error(`loadmap: growth asOf "${o.asOf}" is not a date like 2026-11-01`)
  return { rate: o.rate, per: o.per, asOf: o.asOf }
}

/**
 * When the load reaches `multiple`: `ln(multiple) / ln(1 + rate)` periods after `asOf`. Null without a multiple or
 * when it is never reached; `asOf` itself for 1× and below.
 */
export function dateAt(g: Growth, multiple: number | null): Date | null {
  const start = parseAsOf(g.asOf)
  if (!start || multiple == null || !Number.isFinite(multiple)) return null
  if (multiple <= 1) return start
  const months = (Math.log(multiple) / Math.log(1 + g.rate)) * (g.per === 'year' ? 12 : 1)
  // whole months on the calendar, then the rest as a share of the month it lands in
  const whole = Math.floor(months)
  const y = start.getUTCFullYear()
  const mo = start.getUTCMonth() + whole
  const at = Date.UTC(y, mo, start.getUTCDate())
  const days = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate()
  return new Date(at + (months - whole) * days * 86_400_000)
}
