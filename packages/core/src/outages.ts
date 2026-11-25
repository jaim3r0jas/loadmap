import type { CrossingRange } from './capacity'
// types only from the model: a value would split the packed core in two
import { capital, fmt, months, multiples, pct } from './format'
import type { Model } from './model'
import type { LooseValues } from './params'

/** A failure domain with one part out: "With one availability zone out, the 70 % target holds up to 6×, …". */
export interface NMinusOne<C extends string = string> {
  domain: string
  /** The named part that is out, for a domain with its parts by name. */
  part?: string
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
  return model.outageValues(values).map(({ domain: d, part, with: out, values: v }) => {
    const ev = model.evaluate(v as never)
    const first = ev.firstLimit
    let text = `${capital(out)}, every component is switched off.`
    // never within the search: no limit to name
    if (first && !(ev.target && Number.isFinite(ev.target.low)))
      text = `${capital(out)}, no component reaches the ${pct(model.thresholds.target)} target up to ${fmt(model.searchMax)}×.`
    else if (first) {
      const o = first.out
      const keeps = o ? `, which ${first.plural ? 'keep' : 'keeps'} ${o.left} of ${o.members}` : ''
      const r = ev.target!
      const upTo = `${multiples(r, model.searchMax)}${months(model.dateAt(r.low), model.dateAt(r.high))}`
      text = `${capital(out)}, the ${pct(model.thresholds.target)} target holds up to ${upTo}, limited by ${first.short}${keeps}.`
    }
    const components = Object.fromEntries(
      model.componentIds.map((c) => [c, ev.components[c].util == null ? null : ev.components[c].targetRange]),
    ) as Record<C, CrossingRange | null>
    return {
      domain: d,
      ...(part != null ? { part } : {}),
      with: out,
      target: ev.target,
      firstLimit: first?.id ?? null,
      text,
      components,
    }
  })
}
