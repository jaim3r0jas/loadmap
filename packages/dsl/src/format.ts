import { childrenOf, type Decl, type Expr, type Stmt } from './ast'
import { type Diagnostic, Reporter } from './diagnostics'
import { lex, type Token } from './lexer'
import { parse } from './parser'
import { cut, edgeLabels, foldWorkers, mods, oneSpelling, subsUp } from './rewrite'
import { ONE_SPELLING, own, propNamed, SCHEMA } from './schema'
import { before, CURRENT, lowest, needs, parseVersion, stampOf, type Version, versionText } from './versions'
import { applied, intoView, oldDirection, viewOf } from './viewblock'

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
 * left alone. The direction's old name, `layout: right` or `layout: down`, becomes `direction:`, and a property's old
 * name (`target` in `expect`) its new one where the `loadmap` line has it. `===` becomes `==` and `derived.x` the bare
 * `x`. Where the line says 1.5 or later, every view setting moves into `view { … }`, a `workers` block onto its pool,
 * `sub:` and an edge's `label:` onto their first line, and `a % b` becomes `mod(a, b)`. The `loadmap` line is
 * raised to the lowest version that has everything the definition uses, never lowered: an older stamp keeps what it
 * allows, and a reader of it would not know the rest.
 */
export function format(source: string): FormatResult {
  const { doc, report } = parse(source)
  if (report.failed) return { ok: false, text: source, diagnostics: report.list }
  // a definition that also says direction keeps the old line as written: renamed, it would set the direction twice
  const named = [...doc.body, ...(viewOf(doc.body)?.body ?? [])].some(
    (st) => st.kind === 'prop' && st.key.name === 'direction',
  )
  const retext = new Map(
    doc.body.flatMap((st) => (!named && st.kind === 'prop' && oldDirection(st) ? [[st.key.from, 'direction']] : [])),
  )
  const stamp = raised(source, doc.body)
  if (stamp) retext.set(stamp.from, stamp.text)
  // without a loadmap line a definition is read at the newest version; a text that is no version is the compiler's
  const said = stampOf(source, doc.body)
  const version = stamp ? parseVersion(stamp.text) : said ? said.version : CURRENT
  // the view settings written at the top go into view { … }, where the stamp has it
  if (version && !before(version, VIEW_BLOCK)) {
    const moves = intoView(source, doc.body, version)
    if (moves.length) return format(applied(source, moves))
  }
  // what 1.5 left one spelling of, a kind at a time: each is worked out from the text the one before left
  if (version && !before(version, ONE)) {
    // the direction's old name beside a direction sets nothing: written so, it is only an error
    const idle = named ? doc.body.filter((st) => st.kind === 'prop' && oldDirection(st)) : []
    if (idle.length)
      return format(
        applied(
          source,
          idle.map((st) => cut(source, {}, st)),
        ),
      )
  }
  if (version && !before(version, ONE))
    for (const rewrite of [foldWorkers, subsUp, edgeLabels, mods]) {
      const changes = rewrite(source, doc.body)
      if (changes.length) return format(applied(source, changes))
    }
  const spelled = oneSpelling(source, doc.body)
  if (spelled.length) return format(applied(source, spelled))
  if (version) for (const [from, name] of renames(doc.body, version)) retext.set(from, name)
  const toks = lex(source, new Reporter(source), 0, source.length, true)
    .filter((t) => t.kind !== 'eof')
    .map((t) => (retext.has(t.from) ? { ...t, text: retext.get(t.from)! } : t))
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
    if (!long) {
      // a text continued over lines is from 1.2: an older stamp keeps its long lines
      const lines = version && !before(version, CONTINUED) ? wrapped(out, marks) : text
      return { ok: true, text: lines.length ? `${lines.join('\n')}\n` : '', diagnostics: [] }
    }
    split.add(index.get(long.toks.find(oneLine)!)!)
  }
}

/** The version from which the view settings live in `view { … }`. */
const VIEW_BLOCK: Version = [1, 2]

/** The version from which one spelling is left: `workers` on its pool, `mod(a, b)`, a box's second text on its line. */
const ONE: Version = parseVersion(ONE_SPELLING)!

/** The version that reads a text continued on the next line. */
const CONTINUED: Version = [1, 2]

const isText = (t: Token | undefined): t is Token =>
  t?.kind === 'string' && (t.text[0] === '"' || t.text[0] === "'") && t.text.length >= 2 && t.text.at(-1) === t.text[0]

/**
 * The lines as text, each text too long for its line broken at a space into pieces, one under the other, and a text
 * written in pieces that now fits put back on one line: where prose breaks is the formatter's, like every other line
 * break. Only a text that stands outside parentheses and one-line blocks is touched, the one place a line that starts
 * with a text continues the one above.
 */
function wrapped(lines: Line[], m: Marks): string[] {
  const out: string[] = []
  const plain = (l: Line) => (l.toks.length ? '  '.repeat(l.depth) + join(l.toks, m) : '')
  // the parentheses and brackets open where each line starts: inside them a line break is no token, and two texts
  // side by side would not be joined
  const held: boolean[] = []
  let open = 0
  for (const l of lines) {
    held.push(open > 0)
    for (const t of l.toks)
      if (t.kind === 'punct') open += t.text === '(' || t.text === '[' ? 1 : t.text === ')' || t.text === ']' ? -1 : 0
  }
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i]!
    if (held[i]) {
      out.push(plain(head))
      continue
    }
    // the pieces: the text that ends this line, and each line after it that starts with one
    let last = i
    while (
      isText(lines[last]!.toks.at(-1)) &&
      isText(lines[last + 1]?.toks[0]) &&
      lines[last + 1]!.toks[0]!.text[0] === head.toks.at(-1)!.text[0]
    ) {
      last++
      if (lines[last]!.toks.length > 1) break
    }
    const pieces = last > i ? [head.toks.at(-1)!, ...lines.slice(i + 1, last + 1).map((l) => l.toks[0]!)] : []
    const prefix = last > i ? head.toks.slice(0, -1) : head.toks
    const suffix = last > i ? lines[last]!.toks.slice(1) : []
    if (last === i) {
      // one line: its longest text, when the line is too long and the text stands at the top of it
      const text = plain(head)
      const at = [...text].length > FORMAT_WIDTH ? longest(head.toks) : -1
      if (at < 0) {
        out.push(text)
        continue
      }
      pieces.push(head.toks[at]!)
      suffix.push(...prefix.splice(at).slice(1))
    }
    const quote = pieces[0]!.text[0]!
    const inner = pieces.map((p) => p.text.slice(1, -1)).join('')
    const one: Token = { ...pieces[0]!, text: quote + inner + quote }
    const before = prefix.length ? join([...prefix, one], m).slice(0, -one.text.length) : ''
    const column = head.depth * 2 + before.length
    const after = suffix.length ? join([one, ...suffix], m).slice(one.text.length) : ''
    const whole = '  '.repeat(head.depth) + before + one.text + after
    const parts = [...whole].length > FORMAT_WIDTH ? broken(inner, FORMAT_WIDTH - column - 2 - after.length) : [inner]
    if (parts.length === 1) out.push(whole)
    else
      for (const [k, part] of parts.entries())
        out.push(
          (k === 0 ? '  '.repeat(head.depth) + before : ' '.repeat(column)) +
            quote +
            part +
            quote +
            (k === parts.length - 1 ? after : ''),
        )
    i = last
  }
  return out
}

/** The longest plain text of a line that no parenthesis, bracket or brace of the line holds, or -1. */
function longest(toks: Token[]): number {
  let depth = 0
  let best = -1
  for (const [i, t] of toks.entries()) {
    if (t.kind === 'punct' && (t.text === '(' || t.text === '[' || t.text === '{')) depth++
    else if (t.kind === 'punct' && (t.text === ')' || t.text === ']' || t.text === '}')) depth--
    else if (depth === 0 && isText(t) && (best < 0 || t.text.length > toks[best]!.text.length)) best = i
  }
  return best
}

/** A text in pieces of at most `width`, each broken after a space; the text whole when a piece finds none. */
function broken(text: string, width: number): string[] {
  const out: string[] = []
  let rest = text
  while (rest.length > width) {
    let at = rest.lastIndexOf(' ', width - 1)
    // a space after a backslash is an escape's: not a place to break
    while (at > 0 && rest[at - 1] === '\\') at = rest.lastIndexOf(' ', at - 1)
    if (at <= 0 || width < 20) return [text]
    out.push(rest.slice(0, at + 1))
    rest = rest.slice(at + 1)
  }
  return [...out, rest]
}

/** The `loadmap` line's version raised to what the definition uses, when it says less. */
function raised(source: string, body: readonly Stmt[]): { from: number; text: string } | undefined {
  // a text that is no version, or a later one, is the compiler's to name
  const said = stampOf(source, body)?.version
  if (!said || !before(said, CURRENT)) return undefined
  const need = lowest(needs(body))
  return before(said, need) ? { from: stampOf(source, body)!.at.from, text: versionText(need) } : undefined
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

/**
 * Where each old property name (`was` in the schema) gets its new one: in a block that does not also set the new name
 * (renamed, it would be set twice), and only where the stamp has the new name already. Raising an older stamp for it
 * would make that version's strict checks errors in a file that compiled.
 */
function renames(body: readonly Stmt[], version: Version): Map<number, string> {
  const out = new Map<number, string>()
  const block = (keyword: string, list: readonly Stmt[]) => {
    const props = own(SCHEMA, keyword)?.props ?? {}
    const written = new Set(list.flatMap((st) => (st.kind === 'prop' ? [st.key.name] : [])))
    for (const st of list) {
      if (st.kind === 'decl') decl(st)
      if (st.kind !== 'prop' || own(props, st.key.name)) continue
      const to = propNamed(props, st.key.name)
      if (to && !written.has(to.name) && !before(version, parseVersion(to.spec.since ?? '1.0')!))
        out.set(st.key.from, to.name)
    }
  }
  const decl = (d: Decl) => {
    if (d.body) block(d.keyword.name, d.body)
  }
  block('', body)
  return out
}
