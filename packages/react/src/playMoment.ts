import type { Model, Values } from '@loadmap/core'
import { moment } from '@loadmap/core/moments'

/**
 * Plays a preset's way up on the board: its moment's steps, at the sim's speed, each the preset's values with the
 * step's load and what the step sets (the pods ready, the caches' warmth), then the preset as it holds. `run.live`
 * false stops it. A module of its own: the page loads it when a preset with a way up is pressed.
 */
export function playMoment<P>(
  model: Model<P>,
  from: Values<P>,
  label: string,
  speed: number,
  run: { live: boolean },
  set: Partial<Values<P>>,
  apply: (v: Partial<Values<P>>) => void,
): void {
  if (!run.live) return
  const m = moment(model, from, label)
  // the way up: up to the step after the last one that differs from the moment as it holds
  const last = m.steps.findLastIndex((s) => s.set != null || s.load !== m.steps.at(-1)!.load)
  const steps = m.steps.slice(0, last + 2)
  const start = performance.now()
  let shown = -1
  const tick = () => {
    if (!run.live) return
    const t = ((performance.now() - start) / 1000) * (speed || 1)
    const i = steps.findIndex((s) => s.t + s.dt / 2 > t)
    if (i < 0) {
      run.live = false
      apply(set)
      return
    }
    if (i !== shown) {
      shown = i
      apply({ ...set, load: steps[i]!.load, ...steps[i]!.set } as Partial<Values<P>>)
    }
    requestAnimationFrame(tick)
  }
  tick()
}
