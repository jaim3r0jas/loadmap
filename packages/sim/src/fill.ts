import { rng } from './rng'

/** Busy workers run at this share before the next one takes work, so a half-busy pool shows a spread, not a block. */
const SPILL = 0.7

export interface Fill {
  /** rank[i]: the order in which worker i takes work. */
  rank: readonly number[]
  /** Small per-worker weights around 1, so equal shares do not look machine-made. */
  jitter: readonly number[]
}

/**
 * The order workers take work. Round-robin: one worker of each pod in turn, a shuffled one inside each pod, so load
 * spreads evenly across pods instead of filling pod 0 top to bottom. In-order: pod 0 first.
 */
export function fillOrder(pods: number, perPod: number, fill: 'round-robin' | 'in-order', seed = 1): Fill {
  const n = pods * perPod
  const rank: number[] = new Array(n)
  const r = rng(seed)
  for (let p = 0; p < pods; p++) {
    const perm = Array.from({ length: perPod }, (_, t) => t)
    for (let t = perPod - 1; t > 0; t--) {
      const j = Math.floor(r() * (t + 1))
      ;[perm[t], perm[j]] = [perm[j]!, perm[t]!]
    }
    perm.forEach((t, slot) => {
      rank[p * perPod + t] = fill === 'round-robin' ? slot * pods + p : p * perPod + slot
    })
  }
  const w = Array.from({ length: n }, () => 0.92 + r() * 0.16)
  const mean = w.reduce((a, b) => a + b, 0) / (n || 1)
  return { rank, jitter: w.map((x) => x / mean) }
}

/** How busy worker i is (0–1) when the pool as a whole is `util` busy. */
export function busyOf(i: number, f: Fill, util: number): number {
  const n = f.rank.length
  const total = Math.min(1, Math.max(0, util)) * n
  const k = f.rank[i]!
  let b: number
  if (total <= SPILL * n) {
    const full = Math.floor(total / SPILL)
    b = k < full ? SPILL : k === full ? total - full * SPILL : 0
  } else {
    b = SPILL + (total - SPILL * n) / n
  }
  return Math.min(1, Math.max(0, b * (f.jitter[i] ?? 1)))
}
