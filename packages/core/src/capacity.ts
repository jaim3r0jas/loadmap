export type Provenance = 'measured' | 'estimated'

/** A capacity always says where it came from: the verdict and the assumptions list show it. */
export interface Capacity {
  value: number
  unit: string
  provenance: Provenance
  source?: string
}

export function measured(value: number, unit: string, source?: string): Capacity {
  return { value, unit, provenance: 'measured', source }
}

export function estimated(value: number, unit: string, source?: string): Capacity {
  return { value, unit, provenance: 'estimated', source }
}
