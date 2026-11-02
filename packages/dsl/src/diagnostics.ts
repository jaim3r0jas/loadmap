/** A range of the source, as offsets: `from` inclusive, `to` exclusive. */
export interface Span {
  from: number
  to: number
}

export interface Diagnostic extends Span {
  severity: 'error' | 'warning'
  message: string
  /** 1-based, like an editor shows them. */
  line: number
  column: number
  /** A short suggestion shown under the mark: "did you mean "orders"?". */
  hint?: string
}

/** More are not listed: a page of garbage must not cost a page of work per keystroke. */
export const MAX_DIAGNOSTICS = 200

/** Collects diagnostics and turns offsets into lines and columns. */
export class Reporter {
  readonly list: Diagnostic[] = []
  private seen = new Set<string>()
  private starts: number[]

  constructor(readonly source: string) {
    this.starts = [0]
    for (let i = 0; i < source.length; i++) if (source[i] === '\n') this.starts.push(i + 1)
  }

  error(at: Span, message: string, hint?: string) {
    this.add('error', at, message, hint)
  }

  warning(at: Span, message: string, hint?: string) {
    this.add('warning', at, message, hint)
  }

  /** The 1-based line and column of an offset. */
  position(offset: number): { line: number; column: number } {
    return position(this.starts, offset)
  }

  get failed() {
    return this.list.some((d) => d.severity === 'error')
  }

  private add(severity: Diagnostic['severity'], at: Span, message: string, hint?: string) {
    // one mark per place and message: recovery can reach the same spot twice
    const key = `${at.from}:${message}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    if (this.list.length >= MAX_DIAGNOSTICS) {
      if (this.list.length === MAX_DIAGNOSTICS)
        this.list.push({
          ...this.list.at(-1)!,
          severity: 'error',
          message: `more than ${MAX_DIAGNOSTICS} problems; fix these first`,
          hint: undefined,
        })
      return
    }
    const { line, column } = position(this.starts, at.from)
    this.list.push({ severity, message, from: at.from, to: Math.max(at.to, at.from), line, column, hint })
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
 *     checkout.loadmap:24:17 error: unknown flow "order"
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
  return `${file}:${d.line}:${d.column} ${d.severity}: ${d.message}\n  ${n} | ${text}\n  ${pad} | ${mark}`
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

export function didYouMean(name: string, options: Iterable<string>): string | undefined {
  const c = closest(name, options)
  return c ? `did you mean "${c}"?` : undefined
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
