import type { Reference } from './published'

export type Provenance = 'measured' | 'estimated' | 'configured' | 'published'

/** A capacity always says where it came from: the verdict and the assumptions list show it. */
export interface Capacity {
  value: number
  unit: string
  provenance: Provenance
  source?: string
  /** How sure the value is, as a share: 0.3 is ±30 %. The limits become ranges between the two bounds. */
  within?: number
  /** The value is a best case: a ± only lowers it, so the high bound is the value itself. */
  ceiling?: boolean
  /** A published figure: the catalog's component, the run, its conditions and its source. */
  ref?: Reference
  /** Why there is no published figure for this configuration: the component is then not ranked. */
  missing?: string
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

/** A limit someone set, such as a rate limiter's: exact, so it takes no ±. */
export function configured(value: number, unit: string, source?: string): Capacity {
  return capacity(value, unit, 'configured', source)
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
  if (bound === 'high') return c.ceiling ? c.value : c.value * (1 + c.within)
  return c.value * (1 - c.within)
}

/** Every capacity at its low bound (the pessimistic edge) or its high bound. */
export type Bound = 'low' | 'high'

/** Where something is reached with every capacity at its low bound (`low`) and at its high bound (`high`). */
export interface CrossingRange {
  low: number
  high: number
}

/** "Apache Kafka, run by Confluent, 2020-08-21": the line a capacity's source shows. */
export function sourceText(r: Reference): string {
  return `${r.name}, ${r.measure === 'limit' ? 'documented by' : 'run by'} ${r.source.by}${r.source.date ? `, ${r.source.date}` : ''}`
}
