import type { Origin } from './measure'

export { type Capacity, estimated, measured, type Provenance } from './capacity'

/** cost = a + b × x, fitted from a measured series. Callable: `fit(x)` is the cost at x. */
export interface LinearFit {
  (x: number): number
  a: number
  b: number
  /** Coefficient of determination of the fit, 0 to 1. */
  r2: number
  n: number
  x: string
  y: string
  source?: string
  provenance: 'measured'
  /** Fitted from a snapshot: where each series was read. */
  origin?: { x: Origin; y: Origin }
  /** Why the snapshot gave no series to fit: this is the definition's own fit instead. */
  unread?: string
}

/**
 * Ordinary least squares over `points[x]` → `points[y]`. Needs at least two distinct x values.
 * `through: 'origin'` fixes a at 0 (a cost with no idle part).
 */
export function fitLinear<T extends Record<string, unknown>>(
  points: readonly T[],
  o: { x: keyof T & string; y: keyof T & string; source?: string; through?: 'origin' },
): LinearFit {
  const xs = points.map((pt) => Number(pt[o.x]))
  const ys = points.map((pt) => Number(pt[o.y]))
  const n = xs.length
  if (xs.some((v) => !Number.isFinite(v)) || ys.some((v) => !Number.isFinite(v)))
    throw new Error(`loadmap: fitLinear(${o.x} → ${o.y}) got a non-numeric point`)
  if (n < 2 || new Set(xs).size < 2) throw new Error(`loadmap: fitLinear(${o.x} → ${o.y}) needs two distinct x values`)

  let a: number
  let b: number
  if (o.through === 'origin') {
    a = 0
    b = sum(xs.map((x, i) => x * ys[i]!)) / sum(xs.map((x) => x * x))
  } else {
    const mx = sum(xs) / n
    const my = sum(ys) / n
    b = sum(xs.map((x, i) => (x - mx) * (ys[i]! - my))) / sum(xs.map((x) => (x - mx) ** 2))
    a = my - b * mx
  }
  const my = sum(ys) / n
  const ssTot = sum(ys.map((y) => (y - my) ** 2))
  const ssRes = sum(xs.map((x, i) => (ys[i]! - (a + b * x)) ** 2))
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot)

  const fit = ((x: number) => a + b * x) as LinearFit
  return Object.assign(fit, { a, b, r2, n, x: o.x, y: o.y, source: o.source, provenance: 'measured' as const })
}

const sum = (v: readonly number[]) => v.reduce((s, x) => s + x, 0)
