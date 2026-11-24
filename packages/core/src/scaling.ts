import type { ScalingFit } from './calibrate'

export type { ScalingFit } from './calibrate'

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
  // the most negative of σ and κ held at 0 first, then the fit again: the other may well be above 0 once it is
  const use = [true, true, true]
  let k = solve(cols, ys, use)
  for (let i = 0; i < 2; i++) {
    const worst = [1, 2].filter((j) => use[j] && k[j]! < 0).sort((x, y) => k[x]! - k[y]!)[0]
    if (worst == null) break
    use[worst] = false
    k = solve(cols, ys, use)
  }
  const [a, b, c] = k as [number, number, number]
  if (!(a > 0))
    throw new Error(`loadmap: the points of ${o.y} by ${o.x} give no scaling curve: a size of 1 would have none`)
  const lambda = 1 / a
  const sigma = b / a
  const kappa = c / a
  const at = (n: number) => (lambda * n) / (1 + sigma * (n - 1) + kappa * n * (n - 1))
  // a curve that falls from the first member on peaks at one
  const peak = kappa > 0 ? Math.max(1, Math.sqrt(Math.max(0, 1 - sigma) / kappa)) : Number.POSITIVE_INFINITY
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

/** The best whole size: the peak rounded to whichever side gives more, at least 1; Infinity without a peak. */
export function bestSize(f: ScalingFit): number {
  if (!Number.isFinite(f.peak)) return Number.POSITIVE_INFINITY
  const lo = Math.max(1, Math.floor(f.peak))
  return f(lo + 1) > f(lo) ? lo + 1 : lo
}

/** The curve in words, the same in the page and in `loadmap check`: "a scaling curve: contention 0.03, coherency …". */
export function curveText(f: ScalingFit): string {
  const sig = (x: number) => String(Number(x.toPrecision(3)))
  const peak = Number.isFinite(f.peak) ? `, most at ${bestSize(f)} ${f.x} and less past it` : ''
  return `${f.y} by ${f.x}, a scaling curve: contention ${sig(f.sigma)}, coherency ${sig(f.kappa)}${peak}`
}

/** Least squares over the columns in use (the others held at 0): the normal equations, by Gaussian elimination. */
function solve(cols: readonly (readonly number[])[], ys: readonly number[], use: readonly boolean[]): number[] {
  const on = cols.map((_, j) => j).filter((j) => use[j])
  const m = on.map((i) => [
    ...on.map((j) => sum(cols[i]!.map((v, r) => v * cols[j]![r]!))),
    sum(cols[i]!.map((v, r) => v * ys[r]!)),
  ])
  // a pivot small against its row's scale: sizes too few or too alike to tell the terms apart
  const scale = m.map((row) => Math.max(...row.slice(0, m.length).map(Math.abs)))
  for (let i = 0; i < m.length; i++) {
    const p = m[i]![i]!
    if (!(Math.abs(p) > 1e-9 * scale[i]!))
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
