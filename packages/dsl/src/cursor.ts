import { Reporter } from './diagnostics'
import { lex, type Token } from './lexer'

/** Where a cursor sits, read from the tokens: what an editor's help needs to know before it offers anything. */
export interface Cursor {
  /** The word under the cursor, up to it: what a completion replaces. In a text, the text up to the cursor. */
  from: number
  to: number
  /** In a comment, in a text (a string, or a template outside its `${…}` parts), or in code. */
  in: 'code' | 'text' | 'comment'
  /** The string the cursor is in. */
  string?: Token
  /** The statement's tokens before the word; in a template, those before the template. */
  head: Token[]
  /** In a template's `${…}`: that formula's tokens before the word. */
  part?: Token[]
}

/** A call the cursor is inside: `measured(3000, "|`. */
export interface CallAt {
  name: string
  /** Which argument, from 0. */
  arg: number
  /** That argument's tokens before the word. */
  tokens: Token[]
}

const ENDS = new Set([';', '{', '}'])

export function cursorAt(source: string, offset: number): Cursor {
  const toks = lex(source, new Reporter(source))
  let from = offset
  while (from > 0 && /\w/.test(source[from - 1]!)) from--

  // the token the cursor is in or right after the start of, else the first one after it
  let i = 0
  // a text left open right at the cursor (`"` and nothing after it) holds the cursor
  const holds = (t: Token) => t.to === from && (t.kind === 'string' || t.kind === 'template') && !closed(t)
  while (toks[i]!.kind !== 'eof' && toks[i]!.to <= from && !holds(toks[i]!)) i++
  const t = toks[i]!
  const inside = t.from < offset ? t : undefined
  const head = statementBefore(toks, i)

  if (inside?.kind === 'string' && (offset < inside.to || !closed(inside)))
    return { from: inside.from + 1, to: offset, in: 'text', string: inside, head }
  if (inside?.kind === 'template') {
    const part = inside.parts?.find((p) => p.from <= offset && offset <= p.to)
    if (part) {
      const inner = lex(source, new Reporter(source), part.from, part.to)
      return { from, to: offset, in: 'code', head, part: inner.filter((k) => k.kind !== 'eof' && k.to <= from) }
    }
    if (offset < inside.to || !closed(inside)) return { from: offset, to: offset, in: 'text', head }
  }
  // comments are not tokens: a "#" on this line, after the last token, starts one
  const line = Math.max(source.lastIndexOf('\n', from - 1) + 1, toks[i - 1]?.to ?? 0)
  if (source.slice(line, from).includes('#')) return { from, to: offset, in: 'comment', head }
  return { from, to: offset, in: 'code', head }
}

/** The tokens of the statement that holds token `i`, before it. */
function statementBefore(toks: readonly Token[], i: number): Token[] {
  let s = i
  while (s > 0) {
    const t = toks[s - 1]!
    if (t.kind === 'newline' || (t.kind === 'punct' && ENDS.has(t.text))) break
    s--
  }
  return toks.slice(s, i)
}

/** A string or template that ends with its quote, not with an escaped one. */
function closed(t: Token): boolean {
  const q = t.text[0]!
  if (t.text.length < 2 || !t.text.endsWith(q)) return false
  let slashes = 0
  for (let k = t.text.length - 2; t.text[k] === '\\'; k--) slashes++
  return slashes % 2 === 0
}

/** The innermost call whose parentheses are still open at the end of `tokens`. */
export function callAt(tokens: readonly Token[]): CallAt | undefined {
  let depth = 0
  let arg = 0
  let start = -1
  for (let k = tokens.length - 1; k >= 0; k--) {
    const t = tokens[k]!
    if (t.kind !== 'punct') continue
    if (t.text === ')' || t.text === ']') depth++
    else if (t.text === '(' || t.text === '[') {
      if (depth > 0) {
        depth--
        continue
      }
      const callee = tokens[k - 1]
      if (t.text === '[' || callee?.kind !== 'ident') return undefined
      return { name: callee.text, arg, tokens: tokens.slice(start < 0 ? k + 1 : start) }
    } else if (t.text === ',' && depth === 0) {
      if (start < 0) start = k + 1
      arg++
    }
  }
  return undefined
}
