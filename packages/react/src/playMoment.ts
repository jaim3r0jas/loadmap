import type { Model, Values } from '@loadmap/core'
import { type Moment, moment } from '@loadmap/core/moments'

/** What each model's moments walked, by preset and values: the line under the verdict and the board read one walk. */
const walked = new WeakMap<object, Map<string, Moment>>()

/** A preset's moment at these values, walked once. */
export function walk<P>(model: Model<P>, values: Values<P>, label: string): Moment {
  const key = `${label}|${JSON.stringify(values)}`
  const byKey = walked.get(model) ?? new Map<string, Moment>()
  walked.set(model, byKey)
  const known = byKey.get(key)
  if (known) return known
  const m = moment(model, values, label)
  if (byKey.size > 16) byKey.delete(byKey.keys().next().value!)
  byKey.set(key, m)
  return m
}

/**
 * The steps of a preset's way up, as values to apply in turn on the engine's clock: each the preset's values with the
 * step's load and what the step sets (the pods ready, the caches' warmth). Past the way up the preset holds. A module of
 * its own: the page loads it when a preset with a way up is pressed or shown.
 */
export function wayUp<P>(
  model: Model<P>,
  from: Values<P>,
  label: string,
  set: Partial<Values<P>>,
): { t: number; dt: number; values: Partial<Values<P>> }[] {
  const m = walk(model, from, label)
  return m.steps
    .filter((s) => s.t - s.dt / 2 < m.wayUp)
    .map((s) => ({ t: s.t, dt: s.dt, values: { ...set, load: s.load, ...s.set } as Partial<Values<P>> }))
}
