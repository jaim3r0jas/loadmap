import type { CrossingRange } from './capacity'
import { fmt, multiples, pct } from './format'
import { type ComponentResult, type Model, sureness } from './model'
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
  /** A warning is reported but never fails a check run (`loadmap check`); default fail. */
  severity?: 'warn' | 'fail'
}

/**
 * pass: it holds. fail: it does not, on every capacity's range. inconclusive: the answer rests on data that is not
 * there (a measurement missing or too thin, no published benchmark), or it holds at the high edge of a ± but not at
 * the low one.
 */
export type Outcome = 'pass' | 'fail' | 'inconclusive'

export interface CheckResult<C extends string = string> {
  expectation: Expectation<C>
  /** It holds on the pessimistic edge: `outcome` is pass. */
  ok: boolean
  outcome: Outcome
  /** Why it is inconclusive: each missing piece of data, or the ± that decides it. Empty otherwise. */
  reasons: string[]
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
  // measurements the snapshot has no value for: each counts once, for what reads it
  const gaps = Object.entries(model.def.snapshot?.measurements ?? {}).filter(([, m]) => m.missing != null)
  return expectations.map((e) => {
    const scenario = e.scenario == null ? null : model.scenarios.find((s) => s.label === e.scenario)
    if (e.scenario != null && !scenario) throw new Error(`loadmap: no scenario "${e.scenario}"`)
    const ev = model.evaluate(scenario?.values as Partial<Values<P>> | undefined)
    const c = e.component == null ? null : ev.components[e.component]
    if (e.component != null && !c) throw new Error(`loadmap: no component "${e.component}"`)
    const where = scenario ? ` in ${scenario.label}` : ''
    const range = (k: 'target' | 'full') => (c ? c[`${k}Range`] : ev[k])
    const found = { target: range('target'), full: range('full') }

    const all = Object.values<ComponentResult<C>>(ev.components)
    const scope = c ? [c] : all
    // a component without a published figure is not ranked: it may only run out sooner, so a failure stays one
    const unknown = scope.filter((x) => x.missing != null)
    const none = unknown
      .map((x) => `${x.short} ${x.plural ? 'have' : 'has'} no published benchmark ${x.missing}${where}`)
      .join('; ')
    // measured data that is missing may move the answer either way: a capacity counts for its component, any other
    // measurement (a rate, a share) for everything
    const read = new Set(all.flatMap((x) => (x.capacity?.measure ? [x.capacity.measure] : [])))
    const unread = new Set<string>()
    for (const x of scope) if (x.capacity?.unread) unread.add(`${x.short}: ${x.capacity.unread}`)
    for (const [name, m] of gaps) if (!read.has(name)) unread.add(`${name}: ${m.missing}`)
    const data = [...unread]
    const benchmarks = unknown.map((x) => `${x.short}: no published benchmark ${x.missing}`)
    if (c && unknown.length) return result(e, 'inconclusive', [...benchmarks, ...data], found, none)
    if (c && c.util == null)
      return result(e, data.length ? 'inconclusive' : 'pass', data, found, `${c.short} is switched off${where}`)
    const claims: { at: 'pass' | 'edge' | 'fail'; text: string; min: number }[] = []
    const r = (x: CrossingRange | null) => (x ? multiples(x, model.searchMax) : 'never')
    const target = `the ${pct(model.thresholds.target)} target`
    // holds at the low edge, only at the high edge of a ±, or at neither
    const at = (x: CrossingRange | null, min: number) => {
      const low = x?.low ?? Number.POSITIVE_INFINITY
      const high = x?.high ?? Number.POSITIVE_INFINITY
      return low >= min ? 'pass' : high >= min ? 'edge' : 'fail'
    }
    if (e.target != null) {
      const by = c ?? ev.firstLimit
      claims.push({
        at: at(found.target, e.target),
        min: e.target,
        text: c
          ? `${c.short} reaches ${target} at ${r(found.target)}${where}${sureness(c.capacity)}`
          : `${target} holds up to ${r(found.target)}${where}${by ? `, limited by ${by.short}${sureness(by.capacity)}` : ''}`,
      })
    }
    if (e.full != null) {
      const by = c ?? ev.firstFull
      claims.push({
        at: at(found.full, e.full),
        min: e.full,
        text: by
          ? `${by.short} ${by.plural ? 'run' : 'runs'} out at ${r(found.full)}${where}${sureness(by.capacity)}`
          : `nothing runs out${where}`,
      })
    }
    const failed = claims.filter((x) => x.at !== 'pass')
    const message = failed.length
      ? failed.map((x) => `expected at least ${fmt(x.min)}×, but ${x.text}`).join('; ')
      : claims.map((x) => x.text).join('; ')
    const edges = claims
      .filter((x) => x.at === 'edge')
      .map((x) => `holds at ${fmt(x.min)}× only at the high edge of a ±`)
    const outcome: Outcome =
      claims.some((x) => x.at === 'fail') && !data.length
        ? 'fail'
        : data.length || edges.length || benchmarks.length
          ? 'inconclusive'
          : 'pass'
    // what the ranked components show still says how much headroom is left
    return result(
      e,
      outcome,
      outcome === 'fail' ? [] : [...benchmarks, ...data, ...edges],
      found,
      unknown.length ? `${none}; among the rest, ${message}` : message,
    )
  })
}

function result<C extends string>(
  expectation: Expectation<C>,
  outcome: Outcome,
  reasons: string[],
  found: { target: CrossingRange | null; full: CrossingRange | null },
  message: string,
): CheckResult<C> {
  return { expectation, ok: outcome === 'pass', outcome, reasons, ...found, message }
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
