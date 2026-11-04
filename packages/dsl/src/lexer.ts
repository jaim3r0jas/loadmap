import type { Reporter, Span } from './diagnostics'

export type TokenKind = 'ident' | 'number' | 'string' | 'template' | 'punct' | 'newline' | 'comment' | 'eof'

export interface Token extends Span {
  kind: TokenKind
  /** The source text: an identifier's name, a punctuation mark. */
  text: string
  /** A number's value, a string's cooked text. */
  value?: number | string
  /** A template's cooked text pieces and, between them, the source ranges of its `${…}` parts. */
  quasis?: string[]
  parts?: Span[]
}

// "+/-" is "±" for a keyboard without it; "a +/- b" means nothing else
const PUNCT = ['===', '!==', '+/-', '->', '==', '!=', '<=', '>=', '&&', '||', ...'{}()[],;:.?+-*/%<>!=±']

/** The token kinds and marks an editor needs to highlight the language like the parser reads it. */
export const LEXICON = { punct: PUNCT, comment: '#' } as const

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
      const text = source.slice(s, i)
      if (text.endsWith('_') || text.includes('__')) report.error({ from: s, to: i }, `"${text}" is not a number`)
      push({ kind: 'number', text, value: Number(text.replaceAll('_', '')), from: s, to: i })
    } else if (c === '"' || c === "'") {
      const s = i
      const r = readString(source, i + 1, to, c)
      if (!r.closed) report.error({ from: s, to: r.end }, 'this text has no closing quote', `end it with ${c}`)
      i = r.end
      push({ kind: 'string', text: source.slice(s, i), value: r.value, from: s, to: i })
    } else if (c === '`') {
      const s = i
      const t = readTemplate(source, i + 1, to, report)
      if (!t.closed) report.error({ from: s, to: t.end }, 'this template has no closing backtick', 'end it with `')
      i = t.end
      push({ kind: 'template', text: source.slice(s, i), quasis: t.quasis, parts: t.parts, from: s, to: i })
    } else {
      const p = PUNCT.find((m) => source.startsWith(m, i))
      if (!p) {
        report.error({ from: i, to: i + 1 }, `unexpected character "${c}"`)
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
        report.error({ from: i, to: end }, 'this "${" has no closing "}"')
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
        report.error({ from: i, to: i + 1 }, `templates are nested more than ${MAX_TEMPLATE_DEPTH} deep`)
        return to
      }
      i = readTemplate(src, i + 1, to, report, depth + 1).end
      continue
    } else if (c === '\n') return i
    i++
  }
  return i
}
