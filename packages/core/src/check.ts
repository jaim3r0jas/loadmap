import type { CrossingRange } from './capacity'
import { fmt, multiples, pct } from './format'
import { type Model, sureness } from './model'
import type { Values } from './params'

/**
 * Something that must keep holding, as minimum load multiples on the pessimistic edge (every capacity at its low
 * bound): a change that loses headroom fails it.
 */
export interface Expectation<C extends string = string> {
  /** Names it in a failure: "Today keeps 7×". */
  label?: string
  /** The scenario whose values it checks; the defaults without one. */
  scenario?: string
  /** One component; the first limit without one. */
  component?: C
  /** The target holds up to at least this multiple. */
  target?: number
  /** Nothing runs out (or this component does not) before this multiple. */
  full?: number
}

export interface CheckResult<C extends string = string> {
  expectation: Expectation<C>
  ok: boolean
  /** What was found: where the target and 100 % are reached, at the low and the high bounds; null when off. */
  target: CrossingRange | null
  full: CrossingRange | null
  /** One sentence: what holds, or what was expected and what was found. */
  message: string
}

/** Tests a model's expectations (or these) on the pessimistic edge. */
export function check<P, C extends string>(
  model: Model<P, string, C>,
  expectations: readonly Expectation<C>[] = model.expectations,
): CheckResult<C>[] {
  return expectations.map((e) => {
    const scenario = e.scenario == null ? null : model.scenarios.find((s) => s.label === e.scenario)
    if (e.scenario != null && !scenario) throw new Error(`loadmap: no scenario "${e.scenario}"`)
    const ev = model.evaluate(scenario?.values as Partial<Values<P>> | undefined)
    const c = e.component == null ? null : ev.components[e.component]
    if (e.component != null && !c) throw new Error(`loadmap: no component "${e.component}"`)
    const where = scenario ? ` in ${scenario.label}` : ''
    const range = (k: 'target' | 'full') => (c ? c[`${k}Range`] : ev[k])
    const found = { target: range('target'), full: range('full') }

    if (c && c.util == null)
      return { expectation: e, ok: true, ...found, message: `${c.short} is switched off${where}` }
    const claims: { ok: boolean; text: string; min: number }[] = []
    const r = (x: CrossingRange | null) => (x ? multiples(x, model.searchMax) : 'never')
    const target = `the ${pct(model.thresholds.target)} target`
    if (e.target != null) {
      const by = c ?? ev.firstLimit
      claims.push({
        ok: (found.target?.low ?? Number.POSITIVE_INFINITY) >= e.target,
        min: e.target,
        text: c
          ? `${c.short} reaches ${target} at ${r(found.target)}${where}${sureness(c.capacity)}`
          : `${target} holds up to ${r(found.target)}${where}${by ? `, limited by ${by.short}${sureness(by.capacity)}` : ''}`,
      })
    }
    if (e.full != null) {
      const by = c ?? ev.firstFull
      claims.push({
        ok: (found.full?.low ?? Number.POSITIVE_INFINITY) >= e.full,
        min: e.full,
        text: by
          ? `${by.short} ${by.plural ? 'run' : 'runs'} out at ${r(found.full)}${where}${sureness(by.capacity)}`
          : `nothing runs out${where}`,
      })
    }
    const failed = claims.filter((x) => !x.ok)
    const message = failed.length
      ? failed.map((x) => `expected at least ${fmt(x.min)}×, but ${x.text}`).join('; ')
      : claims.map((x) => x.text).join('; ')
    return { expectation: e, ok: !failed.length, ...found, message }
  })
}

/**
 * Throws when an expectation fails, listing every failure: one line in a Vitest (or any) test.
 *
 *     it('keeps its headroom', () => assertHolds(checkout))
 */
export function assertHolds<P, C extends string>(
  model: Model<P, string, C>,
  expectations: readonly Expectation<C>[] = model.expectations,
): void {
  const results = check(model, expectations)
  const failed = results.filter((r) => !r.ok)
  if (!failed.length) return
  const name = (r: CheckResult<C>) => (r.expectation.label ? `${r.expectation.label}: ` : '')
  throw new Error(
    `${failed.length} of ${results.length} expectations failed:\n${failed.map((r) => `- ${name(r)}${r.message}`).join('\n')}`,
  )
}
