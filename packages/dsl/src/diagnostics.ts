/** A range of the source, as offsets: `from` inclusive, `to` exclusive. */
export interface Span {
  from: number
  to: number
}

/**
 * Every diagnostic's code: the kind of problem, stable across rewordings of its message. Quick fixes, tools reading
 * `--format json` and (later) a comment that silences a warning key on it, never on the message. A new diagnostic
 * takes the code of the problem it reports, or a new one added here; the reference in docs/dsl.md lists them.
 */
export const CODES = {
  syntax: 'the text does not parse: a character, a token or a line out of place',
  'too-large': 'the definition, a block, a formula or a template is larger or deeper than loadmap reads',
  'language-version': 'the "loadmap" line is missing, misplaced, or names a version this loadmap does not read',
  'unknown-name': 'a name that nothing declares: a flow, stage, node, component, parameter, function, …',
  'unknown-property': 'a property the statement does not have',
  'unknown-statement': 'a statement the place does not have',
  misplaced: 'a statement or property in a place it does not belong',
  duplicate: 'something set, declared or listed twice',
  'reserved-name': 'an id that loadmap keeps for itself',
  'missing-property': 'a required property is missing',
  'missing-part': 'a required statement, argument or block is missing',
  'unknown-unit': 'a number with a suffix that is not a unit: 5sec',
  'wrong-type': 'a value of the wrong type',
  'bad-value': 'a value of the right type that the property does not take',
  'out-of-range': 'a number outside the range the property takes',
  'wrong-scope': 'a formula reads what its place may not read',
  'wrong-arguments': 'a function called with the wrong number of values',
  'bad-formula': 'a formula that uses a table, a function, a list or "±" where they do not go',
  'unit-mismatch': 'a demand, capacity or property whose unit differs from the one it should have',
  'empty-unit': 'a capacity whose unit is empty',
  'bare-capacity': 'a capacity without measured(…), estimated(…) or configured(…)',
  'colon-before-block': 'an edge written "a -> b: { … }"',
  'missing-edge': 'a flow goes from one box to another that no edge joins',
  'reversed-edge': 'a flow goes from one box to another against their edge',
  'hidden-edge': 'an edge hidden by its when while a flow still goes that way',
  'unseen-loss': 'what a stage loses reaches no lost box',
  'bad-lost': 'a lost box that takes nothing, feeds on, or takes what another lost box takes',
  'bad-box': 'a box whose stages and component do not fit together',
  'bad-route': "a flow's route, hops, ways or branches that do not fit its stages",
  'bad-edge': 'an edge with a property or label it cannot have',
  'bad-param': 'a parameter whose options, range or default do not fit',
  'bad-scenario': 'a scenario or preset that sets what it cannot',
  'bad-expect': 'an expectation without a target, or with one that does not fit',
  'bad-step': 'a story step that sets what it cannot',
  'bad-fit': 'a fit whose points or measures do not fit',
  'bad-metric': 'a metric, measure or query that cannot be read',
  'bad-rate': 'a flow whose rate is not a finite number at some values',
  'unused-stage': 'a stage no flow passes',
  'unused-component': 'a component no stage uses or holds',
  'tier-order': 'an edge that runs back against the tiers',
  deprecated: 'an old spelling: loadmap fmt rewrites it',
  'catalog-not-loaded': 'the definition names the component catalog, and the host did not load it',
  'no-benchmark': 'no published run matches the configuration: the component is not ranked',
  'newer-edition': 'a later edition of the catalog has other figures for the component',
  runtime: 'a formula that fails when it is computed',
  model: 'the model refuses the definition',
  'expect-failed': 'an expectation that does not hold',
  'expect-inconclusive': 'an expectation that holds only at the high edge of a ±, or rests on missing data',
  'against-base': "a component's verdict changed against the base the check compares with",
  unreadable: 'loadmap check cannot read the file, its snapshot, or a provider it needs',
  internal: 'a bug in loadmap',
} as const satisfies Record<string, string>

export type Code = keyof typeof CODES

/** A did-you-mean: the hint as shown, and the name a quick fix puts in. */
export interface Suggestion {
  hint: string
  name: string
}

export interface Diagnostic extends Span {
  severity: 'error' | 'warning'
  code: Code
  message: string
  /** 1-based, like an editor shows them. */
  line: number
  column: number
  /** A short suggestion shown under the mark: "did you mean "orders"?". */
  hint?: string
  /** The names a quick fix needs, so it never reads them back out of the message: `replace`, `key`, `stage`, … */
  data?: Readonly<Record<string, string>>
}

/** More are not listed: a page of garbage must not cost a page of work per keystroke. */
export const MAX_DIAGNOSTICS = 200

/** Collects diagnostics and turns offsets into lines and columns. */
export class Reporter {
  readonly list: Diagnostic[] = []
  private seen = new Set<string>()
  private quieted = new Set<string>()
  private starts: number[]

  constructor(readonly source: string) {
    this.starts = [0]
    for (let i = 0; i < source.length; i++) if (source[i] === '\n') this.starts.push(i + 1)
  }

  error(code: Code, at: Span, message: string, hint?: string | Suggestion, data?: Record<string, string>) {
    this.add('error', code, at, message, hint, data)
  }

  warning(code: Code, at: Span, message: string, hint?: string | Suggestion, data?: Record<string, string>) {
    this.add('warning', code, at, message, hint, data)
  }

  private unknownQuiet(code: Code, at: Span) {
    return code === 'unknown-name' && this.quieted.has(this.source.slice(at.from, at.to))
  }

  /** The 1-based line and column of an offset. */
  position(offset: number): { line: number; column: number } {
    return position(this.starts, offset)
  }

  /**
   * A name whose declaration failed (`nod api "API"`): every "unknown" mark on it, before and after, is the same
   * mistake again, so it goes.
   */
  quiet(name: string) {
    this.quieted.add(name)
    if (!this.list.some((d) => this.unknownQuiet(d.code, d))) return
    const keep = this.list.filter((d) => !this.unknownQuiet(d.code, d))
    this.list.splice(0, this.list.length, ...keep)
  }

  get failed() {
    return this.list.some((d) => d.severity === 'error')
  }

  private add(
    severity: Diagnostic['severity'],
    code: Code,
    at: Span,
    message: string,
    hint?: string | Suggestion,
    data?: Record<string, string>,
  ) {
    // one mark per place, code and message: recovery can reach the same spot twice
    const key = `${at.from}:${code}:${message}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    if (this.unknownQuiet(code, at)) return
    if (this.list.length >= MAX_DIAGNOSTICS) {
      if (this.list.length === MAX_DIAGNOSTICS)
        this.list.push({
          ...this.list.at(-1)!,
          severity: 'error',
          code: 'too-large',
          message: `more than ${MAX_DIAGNOSTICS} problems; fix these first`,
          hint: undefined,
          data: undefined,
        })
      return
    }
    const { line, column } = position(this.starts, at.from)
    const d: Diagnostic = { severity, code, message, from: at.from, to: Math.max(at.to, at.from), line, column }
    if (typeof hint === 'string') d.hint = hint
    else if (hint) {
      d.hint = hint.hint
      data = { ...data, replace: hint.name }
    }
    if (data) d.data = data
    this.list.push(d)
  }
}

function position(starts: readonly number[], offset: number) {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid]! <= offset) lo = mid
    else hi = mid - 1
  }
  return { line: lo + 1, column: offset - starts[lo]! + 1 }
}

/**
 * One diagnostic as a terminal shows it:
 *
 *     checkout.loadmap:24:17 error[unknown-name]: unknown flow "order"
 *       24 |   demand: flows.order + flows.events
 *          |                 ^^^^^ did you mean "orders"?
 */
export function formatDiagnostic(d: Diagnostic, source: string, file = 'input.loadmap'): string {
  const lines = source.split('\n')
  const text = lines[d.line - 1] ?? ''
  const n = String(d.line)
  const pad = ' '.repeat(n.length)
  const width = Math.max(1, Math.min(d.to - d.from, text.length - d.column + 1))
  const mark = `${' '.repeat(d.column - 1)}${'^'.repeat(width)}${d.hint ? ` ${d.hint}` : ''}`
  return `${file}:${d.line}:${d.column} ${d.severity}[${d.code}]: ${d.message}\n  ${n} | ${text}\n  ${pad} | ${mark}`
}

/** The closest of `options` to `name`, when it is close enough to be a typo. */
export function closest(name: string, options: Iterable<string>): string | undefined {
  let best: string | undefined
  let bestD = Number.POSITIVE_INFINITY
  const lower = name.toLowerCase()
  for (const o of options) {
    const d = o.toLowerCase() === lower ? 0 : distance(lower, o.toLowerCase())
    if (d < bestD) {
      best = o
      bestD = d
    }
  }
  return best != null && bestD <= Math.max(1, Math.floor(name.length / 3)) ? best : undefined
}

export function didYouMean(name: string, options: Iterable<string>): Suggestion | undefined {
  const c = closest(name, options)
  return c ? { hint: `did you mean "${c}"?`, name: c } : undefined
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = cur
    }
  }
  return row[b.length]!
}
