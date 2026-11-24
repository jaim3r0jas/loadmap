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

/**
 * Throughput against size, the Universal Scalability Law: C(N) = λN ÷ (1 + σ(N − 1) + κN(N − 1)). σ is contention
 * (work that queues for one lock or leader), κ coherency (each member talking to every other): twice the pods give less
 * than twice the capacity, and past `peak` less. Callable: `fit(n)` is the capacity at size n.
 */
export interface ScalingFit {
  (n: number): number
  curve: 'usl'
  /** Capacity of one member. */
  lambda: number
  sigma: number
  kappa: number
  /** The size of the most capacity: √((1 − σ) ÷ κ); Infinity without coherency. */
  peak: number
  r2: number
  n: number
  x: string
  y: string
  source?: string
  provenance: 'measured'
  origin?: { x: Origin; y: Origin }
  unread?: string
}

/** A fit a model reads: linear, or a scaling curve. */
export type Fit = LinearFit | ScalingFit

/**
 * The scaling curve through `points[x]` (a size: pods, nodes) → `points[y]` (a capacity), by least squares on
 * N ÷ C = (1 + σ(N − 1) + κN(N − 1)) ÷ λ, which is linear in its three coefficients. A negative σ or κ, which no system
 * has, is held at 0 and the rest fitted again. Needs three distinct sizes.
 */
export function fitScaling<T extends Record<string, unknown>>(
  points: readonly T[],
  o: { x: keyof T & string; y: keyof T & string; source?: string },
): ScalingFit {
  const ns = points.map((pt) => Number(pt[o.x]))
  const cs = points.map((pt) => Number(pt[o.y]))
  if (ns.some((v) => !(v > 0 && Number.isFinite(v))) || cs.some((v) => !(v > 0 && Number.isFinite(v))))
    throw new Error(`loadmap: a scaling curve (${o.x} → ${o.y}) takes sizes and capacities above 0`)
  if (new Set(ns).size < 3) throw new Error(`loadmap: a scaling curve (${o.x} → ${o.y}) needs three distinct sizes`)
  const ys = ns.map((n, i) => n / cs[i]!)
  const cols = [ns.map(() => 1), ns.map((n) => n - 1), ns.map((n) => n * (n - 1))]
  let use = [true, true, true]
  let k = solve(cols, ys, use)
  for (let i = 1; i < 3 && k.some((v, j) => j > 0 && v < 0); i++) {
    use = use.map((u, j) => u && !(j > 0 && k[j]! < 0))
    k = solve(cols, ys, use)
  }
  const [a, b, c] = k as [number, number, number]
  if (!(a > 0))
    throw new Error(`loadmap: the points of ${o.y} by ${o.x} give no scaling curve: a size of 1 would have none`)
  const lambda = 1 / a
  const sigma = b / a
  const kappa = c / a
  const at = (n: number) => (lambda * n) / (1 + sigma * (n - 1) + kappa * n * (n - 1))
  const peak = kappa > 0 ? Math.sqrt(Math.max(0, 1 - sigma) / kappa) : Number.POSITIVE_INFINITY
  const mc = sum(cs) / cs.length
  const ssTot = sum(cs.map((y) => (y - mc) ** 2))
  const ssRes = sum(ns.map((n, i) => (cs[i]! - at(n)) ** 2))
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot)
  const fit = ((n: number) => at(n)) as ScalingFit
  return Object.assign(fit, {
    curve: 'usl' as const,
    lambda,
    sigma,
    kappa,
    peak,
    r2,
    n: ns.length,
    x: o.x,
    y: o.y,
    source: o.source,
    provenance: 'measured' as const,
  })
}

/** Least squares over the columns in use (the others held at 0): the normal equations, by Gaussian elimination. */
function solve(cols: readonly (readonly number[])[], ys: readonly number[], use: readonly boolean[]): number[] {
  const on = cols.map((_, j) => j).filter((j) => use[j])
  const m = on.map((i) => [
    ...on.map((j) => sum(cols[i]!.map((v, r) => v * cols[j]![r]!))),
    sum(cols[i]!.map((v, r) => v * ys[r]!)),
  ])
  for (let i = 0; i < m.length; i++) {
    const p = m[i]![i]!
    if (Math.abs(p) < 1e-300)
      throw new Error('loadmap: the points give no scaling curve: the sizes are too few or alike')
    for (let r = 0; r < m.length; r++) {
      if (r === i) continue
      const f = m[r]![i]! / p
      for (let c = i; c <= m.length; c++) m[r]![c]! -= f * m[i]![c]!
    }
  }
  const out = cols.map(() => 0)
  on.forEach((j, i) => {
    out[j] = m[i]![m.length]! / m[i]![i]!
  })
  return out
}

const sum = (v: readonly number[]) => v.reduce((s, x) => s + x, 0)
