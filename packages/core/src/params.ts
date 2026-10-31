/** Values a parameter can take. */
export type ParamValue = number | boolean | string

/**
 * The values seen by a parameter's `enabled` callback. Loosely typed: a parameter is declared before the model
 * that holds it, so it cannot know its siblings' types.
 */
export type LooseValues = Readonly<Record<string, any>>

interface ControlBase {
  label: string
  /** One line under the control. */
  hint?: string
  /** A short tag next to the label, e.g. "product" or "estimate". */
  tag?: string
  /** Greys the control out when it returns false; the value is kept. */
  enabled?: (values: LooseValues) => unknown
}

export interface LoadParam {
  kind: 'load'
  label: string
  min: number
  max: number
  step: number
  default: number
}

export interface SelectParam<V extends number | string = number | string> extends ControlBase {
  kind: 'select'
  options: readonly V[]
  default: NoInfer<V>
  format?: (value: V) => string
}

export interface SwitchParam extends ControlBase {
  kind: 'switch'
  default: boolean
}

export interface RangeParam extends ControlBase {
  kind: 'range'
  min: number
  max: number
  step: number
  default: number
  format?: (value: number) => string
}

export type ParamDef = SelectParam<any> | SwitchParam | RangeParam
export type AnyParamDef = ParamDef | LoadParam

export type ValueOf<D> =
  D extends SelectParam<infer V> ? V : D extends SwitchParam ? boolean : D extends RangeParam ? number : never

/** The value of every parameter, plus the load multiple. */
export type Values<P> = { load: number } & { -readonly [K in keyof P]: ValueOf<P[K]> }

export const p = {
  /** The load, as a multiple of today. One per model; it drives the limits. */
  load(o: { label?: string; min?: number; max: number; step?: number; default?: number }): LoadParam {
    const min = o.min ?? 1
    return {
      kind: 'load',
      label: o.label ?? 'Load, × today',
      min,
      max: o.max,
      step: o.step ?? 1,
      default: o.default ?? min,
    }
  },
  select<const V extends number | string>(o: Omit<SelectParam<V>, 'kind'>): SelectParam<V> {
    if (!o.options.includes(o.default)) throw new Error(`loadmap: "${o.label}" defaults to ${o.default}, not an option`)
    return { kind: 'select', ...o }
  },
  switch(o: Omit<SwitchParam, 'kind'>): SwitchParam {
    return { kind: 'switch', ...o }
  },
  range(o: Omit<RangeParam, 'kind' | 'step'> & { step?: number }): RangeParam {
    return { kind: 'range', step: 1, ...o }
  },
}

export function isEnabled(def: AnyParamDef, values: LooseValues): boolean {
  return def.kind === 'load' || !def.enabled || Boolean(def.enabled(values))
}
