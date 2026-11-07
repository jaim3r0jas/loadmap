import type { CrossingRange, LoadParam, Preset } from '@loadmap/core'

/**
 * The load as a place on the slider, 0 to 1, and back, snapped to the load's step. A load that spans ten times or more
 * is on a log scale, as the headroom chart is, so today, the target and where it runs out do not crowd its first tenth.
 */
export function loadScale({ min, max, step }: LoadParam): { at: (x: number) => number; of: (t: number) => number } {
  const log = min > 0 && max >= min * 10
  const f = log ? Math.log : (x: number) => x
  const lo = f(min)
  const span = f(max) - lo || 1
  return {
    at: (x) => (f(Math.min(max, Math.max(min, x))) - lo) / span,
    of: (t) => {
      const x = log ? Math.exp(lo + t * span) : lo + t * span
      return Math.min(max, Math.max(min, Number((min + Math.round((x - min) / step) * step).toPrecision(12))))
    },
  }
}

/** A preset that sets the load, as a mark under the slider: its place, its multiple, and the zone it stands for. */
export interface Mark<P = any> {
  preset: Preset<P>
  load: number
  /** "7.4×": the multiple a derived preset names, or the load it sets. */
  text: string
  kind: 'target' | 'full' | 'preset'
}

/** The presets that set the load, in their order; a derived one says its own multiple, which the step rounds down. */
export function marksOf<P>(
  presets: readonly Preset<P>[],
  full: CrossingRange | null,
  { step, max }: LoadParam,
  fmt: (x: number) => string,
): Mark<P>[] {
  return presets.flatMap((p) => {
    const load = (p.values as { load?: number }).load
    if (load == null) return []
    // the model labels a derived preset "50 % target · 7.4×": the multiple after the dot
    const text = (p.derived && p.label.split(' · ')[1]) || `${fmt(load)}×`
    // the model puts "runs out" at the last step under the crossing, or at the end of the range
    const kind = !p.derived
      ? 'preset'
      : full && load >= Math.min(max, Math.floor(full.low / step) * step) - 1e-9
        ? 'full'
        : 'target'
    return [{ preset: p, load, text, kind } as Mark<P>]
  })
}

/** The slider's zones: under the target, past it, past capacity; a ± range is the blend between its two edges. */
export function zones(target: CrossingRange | null, full: CrossingRange | null, at: (x: number) => number): string {
  const p = (x: number) => `${(at(x) * 100).toFixed(2)}%`
  const stops = ['var(--lm-ok) 0']
  if (target) stops.push(`var(--lm-ok) ${p(target.low)}`, `var(--lm-warn) ${p(target.high)}`)
  // with no target to cross, it is under until it runs out
  if (full) stops.push(`var(--lm-${target ? 'warn' : 'ok'}) ${p(full.low)}`, `var(--lm-drop) ${p(full.high)}`)
  return `linear-gradient(to right, ${stops.join(', ')})`
}

/**
 * Which marks keep their label on a track this wide, the rest keeping their tick: the crossings first, then the
 * presets in their order. Widths are estimated from the text, so the same track hides the same labels on any machine.
 */
export function labelled(marks: readonly Mark[], at: (x: number) => number, width: number): boolean[] {
  const room = (m: Mark) => m.text.length * 7 + 8
  const order = marks
    .map((_, i) => i)
    .sort((a, b) => Number(marks[a]!.kind === 'preset') - Number(marks[b]!.kind === 'preset'))
  const kept: [number, number][] = []
  const out = marks.map(() => false)
  for (const i of order) {
    const x = at(marks[i]!.load) * width
    const w = room(marks[i]!)
    // at either end the label is anchored inside the track, not centred on its tick
    const left = Math.min(Math.max(0, x - w / 2), width - w)
    if (kept.some(([l, r]) => left < r && left + w > l)) continue
    kept.push([left, left + w])
    out[i] = true
  }
  return out
}
