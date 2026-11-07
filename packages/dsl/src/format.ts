import { childrenOf, type Expr, type Stmt } from './ast'
import { type Diagnostic, Reporter } from './diagnostics'
import { lex, type Token } from './lexer'
import { parse } from './parser'
import { DIRECTIONS } from './schema'

/** A line longer than this has its one-line blocks split, a statement a line. */
export const FORMAT_WIDTH = 120

export interface FormatResult {
  /** False when the text has a syntax error: `text` is then the source unchanged. */
  ok: boolean
  text: string
  diagnostics: Diagnostic[]
}

/**
 * Lays a definition out the one way: two spaces a block, a statement a line, at most one blank line, one space
 * around operators. It works on the tokens, so numbers, texts, templates and parentheses stay exactly as written and
 * a formula never changes. A block written on one line stays on one line while it fits. A text with a syntax error is
 * left alone. The direction's old name, `layout: right` or `layout: down`, becomes `direction:`.
 */
export function format(source: string): FormatResult {
  const { doc, report } = parse(source)
  if (report.failed) return { ok: false, text: source, diagnostics: report.list }
  // a definition that also says direction keeps the old line as written: renamed, it would set the direction twice
  const named = doc.body.some((st) => st.kind === 'prop' && st.key.name === 'direction')
  const renamed = new Set(doc.body.flatMap((st) => (!named && oldDirection(st) ? [st.key.from] : [])))
  const toks = lex(source, new Reporter(source), 0, source.length, true)
    .filter((t) => t.kind !== 'eof')
    .map((t) => (renamed.has(t.from) ? { ...t, text: 'direction' } : t))
  const marks = marksOf(doc.body, toks)
  const lines = new Reporter(source)
  const match = new Map<number, number>()
  const open: number[] = []
  for (let i = 0; i < toks.length; i++) {
    if (isPunct(toks[i]!, '{')) open.push(i)
    else if (isPunct(toks[i]!, '}')) match.set(open.pop()!, i)
  }
  // per block: nothing inside ({} however written), or its braces on two lines (laid out a statement a line)
  const empty = new Set<number>()
  const written = new Set<number>()
  for (const [i, j] of match) {
    if (toks.slice(i + 1, j).every((t) => t.kind === 'newline')) empty.add(i)
    else if (lines.position(toks[i]!.from).line !== lines.position(toks[j]!.from).line) written.add(i)
  }
  const index = new Map(toks.map((t, i) => [t, i]))
  const split = new Set<number>()
  const oneLine = (t: Token) => {
    const i = index.get(t)!
    return isPunct(t, '{') && !empty.has(i) && !written.has(i) && !split.has(i)
  }
  for (;;) {
    const out = layout(toks, match, (i) => split.has(i) || written.has(i), empty)
    const text = out.map((l) => (l.toks.length ? '  '.repeat(l.depth) + join(l.toks, marks) : ''))
    // the first line too long that still holds a one-line block: split its outermost one
    const long = out.find((l, n) => [...text[n]!].length > FORMAT_WIDTH && l.toks.some(oneLine))
    if (!long) return { ok: true, text: text.length ? `${text.join('\n')}\n` : '', diagnostics: [] }
    split.add(index.get(long.toks.find(oneLine)!)!)
  }
}

interface Line {
  depth: number
  toks: Token[]
}

/** The tokens in lines with their depth. `multi` tells a block laid out a statement a line. */
function layout(toks: Token[], match: Map<number, number>, multi: (i: number) => boolean, empty: Set<number>): Line[] {
  const out: Line[] = []
  let cur: Token[] = []
  // braces and parentheses open before the token: the indent of a line that starts there
  let depth = 0
  let lineDepth = 0
  let newlines = 0
  // a blank line never opens a block, the file, or closes a block
  let start = true
  // per open block, whether it is laid out a statement a line; the file is
  const blocks: boolean[] = [true]
  const end = () => {
    if (cur.length) out.push({ depth: lineDepth, toks: cur })
    cur = []
  }
  const add = (t: Token) => {
    if (!cur.length) {
      if (newlines > 1 && !start && !isPunct(t, '}')) out.push({ depth: 0, toks: [] })
      lineDepth = depth - (isPunct(t, '}') || isPunct(t, ')') || isPunct(t, ']') ? 1 : 0)
    }
    newlines = 0
    start = false
    cur.push(t)
  }
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!
    if (t.kind === 'newline') {
      end()
      newlines++
    } else if (isPunct(t, ';')) {
      // a statement a line: the ";" goes, and a comment after it stays on the statement's line
      if (blocks.at(-1)) {
        if (toks[i + 1]?.kind !== 'comment') end()
      } else {
        // in a one-line block, a ";" that separates nothing goes
        const next = toks[i + 1]
        const last = cur.at(-1)
        const lone = !next || next.kind === 'newline' || next.kind === 'comment' || isPunct(next, '}')
        if (!(lone || !last || isPunct(last, '{') || isPunct(last, ';'))) add(t)
      }
    } else if (isPunct(t, '{')) {
      if (empty.has(i)) {
        add(t)
        i = match.get(i)!
        add(toks[i]!)
        continue
      }
      const m = multi(i)
      add(t)
      depth++
      blocks.push(m)
      if (m) {
        // a comment after the "{" stays on its line
        if (toks[i + 1]?.kind === 'comment') add(toks[++i]!)
        end()
        start = true
      }
    } else if (isPunct(t, '}')) {
      if (blocks.pop()) end()
      add(t)
      depth--
    } else if (isPunct(t, '(') || isPunct(t, '[')) {
      add(t)
      depth++
    } else if (isPunct(t, ')') || isPunct(t, ']')) {
      add(t)
      depth--
    } else add(t)
  }
  end()
  return out
}

/** Which marks the syntax gives a role the tokens alone do not tell: a sign, a "%" after "±", a "?:" colon. */
interface Marks {
  unary: Set<number>
  percent: Set<number>
  ternary: Set<number>
}

function marksOf(body: Stmt[], toks: Token[]): Marks {
  const m: Marks = { unary: new Set(), percent: new Set(), ternary: new Set() }
  // the first token at or after an offset; the spans of a parenthesized formula include its parentheses
  const after = (at: number) => {
    let lo = 0
    let hi = toks.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (toks[mid]!.from < at) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const find = (from: number, text: string) => {
    for (let i = after(from); i < toks.length; i++) if (isPunct(toks[i]!, text)) return toks[i]!.from
    return -1
  }
  const expr = (e: Expr | undefined) => {
    if (!e) return
    if (e.t === 'unary') {
      let at = -1
      for (let i = after(e.from); i < toks.length && toks[i]!.from < e.arg.from; i++)
        if (isPunct(toks[i]!, e.op)) at = toks[i]!.from
      m.unary.add(at)
    } else if (e.t === 'pm' && e.percent) m.percent.add(find(e.within.to, '%'))
    else if (e.t === 'cond') m.ternary.add(find(e.then.to, ':'))
    // a template is printed as written: its parts are left out
    for (const k of childrenOf(e)) expr(k)
  }
  const stmt = (s: Stmt) => {
    if (s.kind === 'row') s.values.forEach(expr)
    else if (s.kind === 'prop') expr(s.value)
    else {
      if (s.kind === 'decl') {
        s.args.forEach(expr)
        expr(s.init)
      } else expr(s.value)
      s.body?.forEach(stmt)
    }
  }
  body.forEach(stmt)
  return m
}

function join(toks: Token[], m: Marks): string {
  let s = toks[0]!.text
  for (let i = 1; i < toks.length; i++) s += gap(toks[i - 1]!, toks[i]!, m) + toks[i]!.text
  return s
}

function gap(a: Token, b: Token, m: Marks): string {
  const A = a.kind === 'punct' ? a.text : ''
  const B = b.kind === 'punct' ? b.text : ''
  if (A === '{' && B === '}') return ''
  if (A === '(' || A === '[' || A === '.') return ''
  if ((A === '-' || A === '+' || A === '!') && m.unary.has(a.from)) return ''
  if (B === ')' || B === ']' || B === ',' || B === ';' || B === '.') return ''
  if (B === '%' && m.percent.has(b.from)) return ''
  if (B === ':' && !m.ternary.has(b.from)) return ''
  // a call: the name and its "(" (in a statement's names, "(" never follows a name)
  if (B === '(' && a.kind === 'ident') return ''
  return ' '
}

const isPunct = (t: Token, text: string) => t.kind === 'punct' && t.text === text

/** `layout: right` or `layout: down` at the top: the direction, under the name it had before `layout: compact`. */
function oldDirection(st: Stmt): st is Extract<Stmt, { kind: 'prop' }> {
  if (st.kind !== 'prop' || st.key.name !== 'layout') return false
  const v = st.value
  const word = v.t === 'id' ? v.name : v.t === 'str' ? v.value : undefined
  return word != null && (DIRECTIONS as readonly string[]).includes(word)
}
