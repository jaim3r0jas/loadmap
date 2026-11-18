import { childrenOf, type Decl, type Expr, type Stmt } from './ast'
import type { Span } from './diagnostics'
import { isSize } from './lexer'
import { COMPONENT_PROPS, EDGE_PROPS, own, PLUS_MINUS, SCHEMA } from './schema'
import { before, parseVersion, stampVersion, type Version } from './stamp'

/**
 * The language version this package reads, the newest: what a new definition starts with. A minor version stays open
 * until the release that ships it; from then on it never changes (docs/dsl.md, "Versions").
 */
export const LANGUAGE_VERSION = '1.6'

export { before, parseVersion, type Version, versionText } from './stamp'

export const CURRENT = parseVersion(LANGUAGE_VERSION)!

/** How a capacity's ± is written at a version: `+-` from 1.6 (`format()` writes it), `±` before. */
export const plusMinusMark = (version: Version): string => (before(version, parseVersion(PLUS_MINUS)!) ? '±' : '+-')

/**
 * The `loadmap` line's version: the number, as written, and the version it says. `version` is undefined when the text
 * is no version (`1.05`, `0`); 0.32 read any spelling of the number 1 (`1.00`, `1e0`), so that is still 1.0.
 */
export function stampOf(
  source: string,
  body: readonly Stmt[],
): { at: Span; text: string; version: Version | undefined } | undefined {
  const head = body[0]
  const v = head?.kind === 'decl' && head.keyword.name === 'loadmap' ? head.args[0] : undefined
  if (v?.t !== 'num') return undefined
  const text = source.slice(v.from, v.to)
  return { at: { from: v.from, to: v.to }, text, version: v.unit ? parseVersion(text) : stampVersion(text, v.value) }
}

/** What the language reads that is not a statement or a property, and the version that added it. */
const SYNTAX = {
  units: { since: '1.1', what: 'a number with a unit (20ms, 80%, 7×)' },
  as: { since: '1.1', what: '"as" after a demand' },
  mod: { since: '1.2', what: 'mod(a, b)' },
  out: { since: '1.2', what: 'out.<stage>, what a fan-out sends' },
  continued: { since: '1.2', what: 'a text continued on the next line' },
  scenarioId: { since: '1.2', what: "a scenario's id" },
  sizes: { since: '1.2', what: 'a size (1.5KB, 20MB)' },
  autoDirection: { since: '1.4', what: 'direction: auto' },
  poolScale: { since: '1.5', what: 'autoscale on the pool' },
} as const

/** A use of something a version added: where, what, and the version. */
export interface Need extends Span {
  since: Version
  what: string
}

/**
 * Each thing the definition uses that a version after 1.0 added, the first use of each: a statement or property with
 * `since` in the schema, a number with a unit, `as`. A definition stamped before one of them fails on a reader of that
 * stamp with "unknown statement" instead of "update", so the stamp must say it.
 */
export function needs(body: readonly Stmt[], hosted: ReadonlySet<string> = new Set()): Need[] {
  const out = new Map<string, Need>()
  const add = (key: string, since: string | undefined, what: string, at: Span) => {
    if (since && !out.has(key)) out.set(key, { since: parseVersion(since)!, what, from: at.from, to: at.to })
  }
  // a fit of that name is the definition's own, called the same way; so is a function the host page gave it
  const ownMod =
    hosted.has('mod') ||
    body.some(
      (s) => s.kind === 'decl' && s.keyword.name === 'fit' && s.args.some((a) => a.t === 'id' && a.name === 'mod'),
    )
  const expr = (e: Expr) => {
    if (e.t === 'num' && isSize(e.unit)) add('sizes', SYNTAX.sizes.since, SYNTAX.sizes.what, e)
    else if (e.t === 'num' && e.unit) add('units', SYNTAX.units.since, SYNTAX.units.what, e)
    if (e.t === 'str' && e.continued) add('continued', SYNTAX.continued.since, SYNTAX.continued.what, e)
    if (e.t === 'member' && e.object.name === 'out') add('out', SYNTAX.out.since, SYNTAX.out.what, e.object)
    if (e.t === 'call' && e.callee.name === 'mod' && !ownMod) add('mod', SYNTAX.mod.since, SYNTAX.mod.what, e.callee)
    for (const c of childrenOf(e, true)) expr(c)
  }
  const stmts = (list: readonly Stmt[], parent: string) => {
    for (const s of list) {
      if (s.kind === 'decl') {
        const spec = own(SCHEMA, s.keyword.name)
        add(`statement ${s.keyword.name}`, spec?.since, `"${s.keyword.name}"`, s.keyword)
        if (s.keyword.name === 'scenario' && s.args[0]?.t === 'id')
          add('scenarioId', SYNTAX.scenarioId.since, SYNTAX.scenarioId.what, s.args[0])
        if (s.keyword.name === 'autoscale' && parent === 'pool')
          add('poolScale', SYNTAX.poolScale.since, SYNTAX.poolScale.what, s.keyword)
        decl(s)
      } else if (s.kind === 'prop') {
        const spec =
          parent === '->'
            ? own(EDGE_PROPS, s.key.name)
            : (own(own(SCHEMA, parent)?.props ?? {}, s.key.name) ?? own(COMPONENT_PROPS, s.key.name))
        add(`property ${parent} ${s.key.name}`, spec?.since, `"${s.key.name}:"`, s.key)
        if (s.as) add('as', SYNTAX.as.since, SYNTAX.as.what, s.as)
        if (parent === '' && s.key.name === 'direction' && s.value.t === 'id' && s.value.name === 'auto')
          add('autoDirection', SYNTAX.autoDirection.since, SYNTAX.autoDirection.what, s.value)
        expr(s.value)
      } else if (s.kind === 'edge') {
        if (s.value) expr(s.value)
        if (s.body) stmts(s.body, '->')
      } else for (const v of s.values) expr(v)
    }
  }
  const decl = (d: Decl) => {
    for (const a of d.args) expr(a)
    if (d.init) expr(d.init)
    if (d.body) stmts(d.body, d.keyword.name)
  }
  stmts(body, '')
  return [...out.values()]
}

/** The lowest version that has everything in `needs`. */
export function lowest(list: readonly Need[]): Version {
  return list.reduce<Version>((v, n) => (before(v, n.since) ? n.since : v), [1, 0])
}
