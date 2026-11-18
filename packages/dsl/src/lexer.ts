import { Reporter, type Span } from './diagnostics'
import { ONE_SPELLING, PLUS_MINUS } from './schema'
import { before, parseVersion, stampVersion, type Version } from './stamp'

export type TokenKind = 'ident' | 'number' | 'string' | 'template' | 'punct' | 'newline' | 'comment' | 'eof'

export interface Token extends Span {
  kind: TokenKind
  /** The source text: an identifier's name, a punctuation mark. */
  text: string
  /** A number's value (in seconds or as a share for a unit), a string's cooked text. */
  value?: number | string
  /** A number's unit, written straight after it (`20ms`), and the number as written before it (20). */
  unit?: Suffix
  written?: number
  /** A text continued on the lines after it (`"a "` and under it `"b"`): one text, written in these pieces. */
  pieces?: Span[]
  /** A template's cooked text pieces and, between them, the source ranges of its `${…}` parts. */
  quasis?: string[]
  parts?: Span[]
}

// "+-" is "±" for a keyboard without it, from 1.6 (before, "a +- b" was "a + -b"); so is "+/-", which means nothing
// else
const PUNCT = ['===', '!==', '+/-', '+-', '->', '==', '!=', '<=', '>=', '&&', '||', ...'{}()[],;:.?+-*/%<>!=±']

/**
 * A unit written straight after a number. Durations become seconds and `%` a share, the units every property and
 * formula already counts in; `×` (`x` on a keyboard without it) marks a load multiple and changes nothing. A size
 * (`1.5KB`, `20MB`: decimal, as a network counts) becomes bytes.
 */
export type Suffix = 'ms' | 's' | 'min' | 'h' | '%' | '×' | 'x' | Size
export type Size = 'KB' | 'MB' | 'GB' | 'TB'
/** The sizes, and how many bytes one of each is. */
export const SIZES: Readonly<Record<Size, number>> = { KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }
export const isSize = (unit: string | undefined): unit is Size => unit !== undefined && Object.hasOwn(SIZES, unit)
const WORDS: readonly Suffix[] = ['ms', 's', 'min', 'h', 'x', 'KB', 'MB', 'GB', 'TB']
/** Each unit as a power of ten and a whole factor, so `4.1min` is worked out in decimal: the double nearest 246. */
const SCALE: Record<Suffix, [exp: number, factor: bigint]> = {
  ms: [-3, 1n],
  s: [0, 1n],
  min: [0, 60n],
  h: [0, 3600n],
  '%': [-2, 1n],
  '×': [0, 1n],
  x: [0, 1n],
  KB: [3, 1n],
  MB: [6, 1n],
  GB: [9, 1n],
  TB: [12, 1n],
}

/**
 * The token kinds and marks an editor needs to highlight the language like the parser reads it. `unit` is a regular
 * expression for what may follow a number as its unit; the lexer reads units with it too, so the two never differ.
 * A `%` straight after a number is a share (`80%`, `80% * x`, `30%+1`): the remainder is `mod(a, b)`.
 */
export const LEXICON = {
  punct: PUNCT,
  comment: '#',
  unit: `(?:(?:${WORDS.join('|')})(?![A-Za-z0-9_])|×|%)`,
} as const
const UNIT = new RegExp(LEXICON.unit, 'y')
/**
 * Before loadmap 1.5 `%` was also the remainder, and a `%` after a number a share only when no value followed it on
 * the line (`80%`, `80% * x`, `80% - x`): before a value, or with a sign right after it (`10%-3`), it was the
 * remainder. A file stamped before 1.5 is still read that way.
 */
const UNIT_BEFORE_1_5 = new RegExp(
  `(?:(?:${WORDS.join('|')})(?![A-Za-z0-9_])|×|%(?![-+!]|[ \\t]*(?:[A-Za-z0-9_(\\['"\`]|\\.\\d)))`,
  'y',
)
const ONE = parseVersion(ONE_SPELLING)!
const PM = parseVersion(PLUS_MINUS)!

/** The marks of a capacity's `±`: `+-` (the one `format()` writes from 1.6), `±` and `+/-`. */
export const PLUS_MINUS_MARKS: readonly string[] = ['+-', '±', '+/-']

/** Whether a token is the `±` of a capacity's value, however it is spelled. */
export const isPlusMinus = (t: Token | undefined): boolean => t?.kind === 'punct' && PLUS_MINUS_MARKS.includes(t.text)

/**
 * The text after `loadmap` on a file's first line that is not blank or a comment, from `at` to `end`: a scan, one
 * pass, since a shared link is untrusted input (a pattern for it backtracks on a long run of spaces).
 */
function stampAt(source: string, at: number, end: number): string | undefined {
  const blank = (c: string | undefined) => c === ' ' || c === '\t' || c === '\r'
  let i = at
  while (i < end) {
    while (i < end && blank(source[i])) i++
    if (source[i] === '#') i = source.indexOf('\n', i) < 0 ? end : source.indexOf('\n', i)
    if (source[i] !== '\n') break
    i++
  }
  if (!source.startsWith('loadmap', i)) return undefined
  i += 'loadmap'.length
  const gap = i
  while (i < end && blank(source[i])) i++
  const from = i
  while (i < end && /[0-9A-Za-z_.+-]/.test(source[i]!)) i++
  return i > gap && from > gap && /[0-9]/.test(source[from] ?? '') ? source.slice(from, i) : undefined
}

/**
 * The version the file that holds `from` is stamped with: before loadmap 1.5 `%` was also the remainder, and before 1.6
 * `+-` a plus and a minus. The lexer reads the `loadmap` line itself: what a `%` or a `+-` is decides the tokens,
 * before any statement is parsed. A file without the line (undefined) is read at the newest version.
 */
function stamped(source: string, report: Reporter, from: number): Version | undefined {
  const file = report.source === source ? report.fileAt(from) : undefined
  const first = report.source === source ? (report.files[0]?.base ?? source.length + 1) - 1 : source.length
  const text = stampAt(source, file?.base ?? 0, file?.end ?? first)
  // read as the compiler reads the stamp (versions.ts): a text that is no version is its error to name
  return text == null ? undefined : stampVersion(text, Number(text))
}

/**
 * The unit glued to the number that ends at `i`: undefined for none, null for a word that is not one. After a `±` a
 * `%` is the ± form's own mark (`± 30%`), read by the parser as it always was.
 */
function suffixAt(src: string, i: number, to: number, afterPm: boolean, old: boolean): Suffix | null | undefined {
  if (i >= to || (afterPm && src[i] === '%')) return undefined
  const unit = old ? UNIT_BEFORE_1_5 : UNIT
  unit.lastIndex = i
  const m = unit.exec(src)
  if (m && i + m[0].length <= to) return m[0] as Suffix
  return isIdStart(src[i]!) ? null : undefined
}

/** A number written with a unit, in seconds or as a share: in decimal, then rounded once to a double. */
function inBase(digits: string, unit: Suffix): number {
  const [exp, factor] = SCALE[unit]
  const [mantissa = '', e = '0'] = digits.split(/e/i)
  const [int = '', frac = ''] = mantissa.split('.')
  return Number(`${BigInt(int + frac || '0') * factor}e${Number(e) - frac.length + exp}`)
}

/** How many seconds (or what share) one of a unit is: what turns a value back into the number written with it. */
export function unitScale(unit: Suffix): number {
  const [exp, factor] = SCALE[unit]
  return Number(`${factor}e${exp}`)
}

/**
 * Splits `source[from, to)` into tokens. Newlines end statements, except inside parentheses and brackets, so a long
 * formula can wrap there. `#` starts a comment to the end of the line.
 *
 * With `trivia` (for the formatter, never the parser) every newline is a token, blank lines and wrapped formulas
 * included, and so is every comment.
 */
export function lex(source: string, report: Reporter, from = 0, to = source.length, trivia = false): Token[] {
  const out: Token[] = []
  let depth = 0
  let i = from
  const version = stamped(source, report, from)
  const old = version != null && before(version, ONE)
  const plusMinus = version == null || !before(version, PM)
  const push = (t: Token) => out.push(t)
  while (i < to) {
    const c = source[i]!
    if (c === '\n') {
      if (trivia || (depth === 0 && out.at(-1)?.kind !== 'newline'))
        push({ kind: 'newline', text: '\n', from: i, to: i + 1 })
      i++
    } else if (c === ' ' || c === '\t' || c === '\r') i++
    else if (c === '#') {
      const s = i
      while (i < to && source[i] !== '\n') i++
      if (trivia) push({ kind: 'comment', text: source.slice(s, i).trimEnd(), from: s, to: i })
    } else if (isIdStart(c)) {
      const s = i
      while (i < to && isIdPart(source[i]!)) i++
      push({ kind: 'ident', text: source.slice(s, i), from: s, to: i })
    } else if (isDigit(c) || (c === '.' && isDigit(source[i + 1] ?? ''))) {
      const s = i
      while (i < to && (isDigit(source[i]!) || source[i] === '_')) i++
      if (source[i] === '.' && isDigit(source[i + 1] ?? '')) {
        i++
        while (i < to && (isDigit(source[i]!) || source[i] === '_')) i++
      }
      const sign = source[i + 1] === '+' || source[i + 1] === '-' ? 1 : 0
      if ((source[i] === 'e' || source[i] === 'E') && isDigit(source[i + 1 + sign] ?? '')) {
        i += 1 + sign
        while (i < to && isDigit(source[i]!)) i++
      }
      const digits = source.slice(s, i)
      if (digits.endsWith('_') || digits.includes('__'))
        report.error('syntax', { from: s, to: i }, `"${digits}" is not a number`)
      const written = Number(digits.replaceAll('_', ''))
      const prev = out.at(-1)
      const unit = suffixAt(source, i, to, isPlusMinus(prev), old)
      if (unit === null) {
        // a glued word is never a name: "5sec" is one mistake, not a number and a stray name
        const w = i
        while (i < to && isIdPart(source[i]!)) i++
        report.error(
          'unknown-unit',
          { from: s, to: i },
          `"${source.slice(w, i)}" is not a unit of a number`,
          'the units are ms, s, min, h, %, × and the sizes KB, MB, GB, TB',
        )
        push({ kind: 'number', text: source.slice(s, i), value: written, from: s, to: i })
        continue
      }
      i += unit?.length ?? 0
      const value = unit ? inBase(digits.replaceAll('_', ''), unit) : written
      push({ kind: 'number', text: source.slice(s, i), value, from: s, to: i, ...(unit && { unit, written }) })
    } else if (c === '"' || c === "'") {
      const s = i
      let r = readString(source, i + 1, to, c)
      if (!r.closed) {
        // a text carried onto the next line and closed there: one mistake, read as the one text it was meant to be,
        // so its second line is not a statement of its own and its quote opens nothing
        // only when it is the one quote of its line and the next line has the one that closes it: a stray quote
        // among others must not take the lines after it
        const quotes = (a: number, b: number) => source.slice(a, b).split(c).length - 1
        const [start, nl] = [source.lastIndexOf('\n', s - 1) + 1, source.indexOf('\n', r.end + 1)]
        const lone = quotes(start, r.end) === 1 && quotes(r.end + 1, nl < 0 || nl > to ? to : nl) === 1
        const next = lone && r.end < to && source[r.end] === '\n' ? readString(source, r.end + 1, to, c) : undefined
        if (next?.closed) {
          report.error(
            'syntax',
            { from: s, to: r.end },
            `a ${c}…${c} text ends on its line`,
            'close it here; a text in backticks may run over lines',
          )
          r = { value: `${r.value} ${next.value.trimStart()}`, end: next.end, closed: true }
        } else report.error('syntax', { from: s, to: r.end }, 'this text has no closing quote', `end it with ${c}`)
      }
      i = r.end
      push({ kind: 'string', text: source.slice(s, i), value: r.value, from: s, to: i })
    } else if (c === '`') {
      const s = i
      const t = readTemplate(source, i + 1, to, report)
      if (!t.closed)
        report.error('syntax', { from: s, to: t.end }, 'this template has no closing backtick', 'end it with `')
      i = t.end
      push({ kind: 'template', text: source.slice(s, i), quasis: t.quasis, parts: t.parts, from: s, to: i })
    } else {
      const found = PUNCT.find((m) => source.startsWith(m, i))
      // before 1.6, "a +- b" is a + -b: the parser marks it, for the warning
      const p = found === '+-' && !plusMinus ? '+' : found
      if (!p) {
        report.error('syntax', { from: i, to: i + 1 }, `unexpected character "${c}"`)
        i++
        continue
      }
      if (p === '(' || p === '[') depth++
      else if ((p === ')' || p === ']') && depth > 0) depth--
      // a block brace resets the wrap: a missing ")" must not swallow the rest of the file
      else if (p === '{' || p === '}') depth = 0
      push({ kind: 'punct', text: p, from: i, to: i + p.length })
      i += p.length
    }
  }
  push({ kind: 'eof', text: '', from: to, to })
  return trivia ? out : continued(source, out)
}

/**
 * A line that starts with a text continues the text that ends the line before it: no statement starts with one, so
 * nothing else can be meant. The pieces become one token, whose text is what the one text would have been (the
 * fingerprint of a definition does not change with where its prose is broken).
 */
function continued(source: string, toks: Token[]): Token[] {
  const out: Token[] = []
  for (let i = 0; i < toks.length; i++) {
    const [nl, next] = [toks[i]!, toks[i + 1]]
    const prev = out.at(-1)
    const joins =
      nl.kind === 'newline' &&
      prev?.kind === 'string' &&
      next?.kind === 'string' &&
      source[prev.from] === source[next.from] &&
      // the very next line: a blank line between them ends the statement
      source.slice(prev.to, next.from).split('\n').length === 2
    if (!joins) {
      out.push(nl)
      continue
    }
    const pieces = prev.pieces ?? [{ from: prev.from, to: prev.to }]
    out[out.length - 1] = {
      ...prev,
      text: prev.text.slice(0, -1) + next!.text.slice(1),
      value: `${prev.value}${next!.value}`,
      to: next!.to,
      pieces: [...pieces, { from: next!.from, to: next!.to }],
    }
    i++
  }
  return out
}

const isIdStart = (c: string) => /[A-Za-z_]/.test(c)
const isIdPart = (c: string) => /[A-Za-z0-9_]/.test(c)
const isDigit = (c: string) => c >= '0' && c <= '9'

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', '\\': '\\', '"': '"', "'": "'", '`': '`', $: '$' }

function readString(src: string, i: number, to: number, q: string) {
  let value = ''
  while (i < to && src[i] !== q && src[i] !== '\n') {
    if (src[i] === '\\' && i + 1 < to) {
      value += ESCAPES[src[i + 1]!] ?? src[i + 1]
      i += 2
    } else value += src[i++]
  }
  const closed = src[i] === q
  return { value, end: closed ? i + 1 : i, closed }
}

/** Templates nested deeper than this are refused: the lexer reads them recursively. */
const MAX_TEMPLATE_DEPTH = 16

function readTemplate(src: string, i: number, to: number, report: Reporter, depth = 0) {
  const quasis: string[] = []
  const parts: Span[] = []
  let cur = ''
  while (i < to && src[i] !== '`') {
    if (src[i] === '\\' && i + 1 < to) {
      cur += ESCAPES[src[i + 1]!] ?? src[i + 1]
      i += 2
    } else if (src[i] === '$' && src[i + 1] === '{') {
      quasis.push(cur)
      cur = ''
      const start = i + 2
      const end = skipExpression(src, start, to, report, depth)
      parts.push({ from: start, to: end })
      if (src[end] === '}') i = end + 1
      else {
        report.error('syntax', { from: i, to: end }, 'this "${" has no closing "}"')
        i = end
      }
    } else cur += src[i++]
  }
  quasis.push(cur)
  const closed = src[i] === '`'
  return { quasis, parts, end: closed ? i + 1 : i, closed }
}

/** The offset of the `}` that closes a template's `${`, skipping nested braces, strings and templates. */
function skipExpression(src: string, i: number, to: number, report: Reporter, depth: number): number {
  let braces = 0
  while (i < to) {
    const c = src[i]!
    if (c === '}' && braces === 0) return i
    if (c === '{') braces++
    else if (c === '}') braces--
    else if (c === '"' || c === "'") {
      i = readString(src, i + 1, to, c).end
      continue
    } else if (c === '`') {
      if (depth + 1 >= MAX_TEMPLATE_DEPTH) {
        report.error('too-large', { from: i, to: i + 1 }, `templates are nested more than ${MAX_TEMPLATE_DEPTH} deep`)
        return to
      }
      i = readTemplate(src, i + 1, to, report, depth + 1).end
      continue
    } else if (c === '\n') return i
    i++
  }
  return i
}

/** The text as its tokens: the same for two texts that differ only in spaces, line breaks and comments. */
export function fingerprint(source: string): string {
  return lex(source, new Reporter(source))
    .map((t) => t.text)
    .join('\u0001')
}
