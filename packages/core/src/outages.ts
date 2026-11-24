import type { CrossingRange } from './capacity'
import { capital, pct } from './format'
import { type Model, reach } from './model'
import type { LooseValues } from './params'

/** A failure domain with one part out: "With one availability zone out, the 70 % target holds up to 6×, …". */
export interface NMinusOne<C extends string = string> {
  domain: string
  /** "with one availability zone out" */
  with: string
  /** Where the target is reached first, on the pessimistic edge; null when nothing reaches it. */
  target: CrossingRange | null
  firstLimit: C | null
  text: string
  /** Where each component reaches the target then; null for one switched off or never reaching it. */
  components: Readonly<Record<C, CrossingRange | null>>
}

/**
 * N−1, for each failure domain with every part up: the model ranked again with one part of it out (the `down`
 * control). Each is a whole evaluation of its own: an entry of its own, for the panels that show it.
 */
export function outages<C extends string>(model: Model<any, string, C>, values: LooseValues = {}): NMinusOne<C>[] {
  const shown: LooseValues = { ...model.defaults(), ...values }
  const down = model.params.find((x) => x.id === 'down')?.def
  if (!model.def.domains || down?.kind !== 'select' || shown.down !== 'none') return []
  return Object.keys(model.def.domains).map((d) => {
    const ev = model.evaluate({ ...shown, down: d } as never)
    const out = `with ${down.format?.(d) ?? `${d} down`}`
    const first = ev.firstLimit
    let text = `${capital(out)}, every component is switched off.`
    if (first) {
      const o = first.out
      const keeps = o ? `, which ${first.plural ? 'keep' : 'keeps'} ${o.left} of ${o.members}` : ''
      const upTo = reach(ev.target, model.searchMax, (x) => model.dateAt(x))
      text = `${capital(out)}, the ${pct(model.thresholds.target)} target holds up to ${upTo}, limited by ${first.short}${keeps}.`
    }
    const components = Object.fromEntries(
      model.componentIds.map((c) => [c, ev.components[c].util == null ? null : ev.components[c].targetRange]),
    ) as Record<C, CrossingRange | null>
    return { domain: d, with: out, target: ev.target, firstLimit: first?.id ?? null, text, components }
  })
}
