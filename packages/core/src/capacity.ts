export type Provenance = 'measured' | 'estimated'

/** A capacity always says where it came from: the verdict and the assumptions list show it. */
export interface Capacity {
  value: number
  unit: string
  provenance: Provenance
  source?: string
  /** How sure the value is, as a share: 0.3 is ±30 %. The limits become ranges between the two bounds. */
  within?: number
}

export interface CapacityOptions {
  source?: string
  /** ±, as a share of the value: 0.3 is ±30 %. At least 0, below 1. */
  within?: number
}

/** A capacity read off a dashboard or a load test. */
export function measured(value: number, unit: string, o?: string | CapacityOptions): Capacity {
  return capacity(value, unit, 'measured', o)
}

/** A capacity from a vendor's figure, a benchmark elsewhere or a guess: the verdict says so. */
export function estimated(value: number, unit: string, o?: string | CapacityOptions): Capacity {
  return capacity(value, unit, 'estimated', o)
}

function capacity(value: number, unit: string, provenance: Provenance, o?: string | CapacityOptions): Capacity {
  const { source, within } = typeof o === 'string' ? { source: o, within: undefined } : (o ?? {})
  if (within != null && !(within >= 0 && within < 1))
    throw new Error(`loadmap: within is a share from 0 to below 1 (0.3 is ±30 %), not ${within}`)
  const c: Capacity = { value, unit, provenance, source }
  if (within) c.within = within
  return c
}

/** The capacity's value at its low or high bound; the value itself without a ±. */
export function boundOf(c: Capacity, bound: Bound | undefined): number {
  if (!bound || !c.within) return c.value
  return c.value * (bound === 'low' ? 1 - c.within : 1 + c.within)
}

/** Every capacity at its low bound (the pessimistic edge) or its high bound. */
export type Bound = 'low' | 'high'

/** Where something is reached with every capacity at its low bound (`low`) and at its high bound (`high`). */
export interface CrossingRange {
  low: number
  high: number
}
