import type { BinOp, Decl, Document, Edge, Expr, Ident, Property, Row, Stmt } from './ast'
import { Reporter, type Span } from './diagnostics'
import { lex, type Token } from './lexer'

/** Deeper formulas are refused: a shared link must not be able to exhaust the stack. */
export const MAX_DEPTH = 64
/** Longer sources are refused before parsing. */
export const MAX_SOURCE = 200_000

const PREC: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '===': 3,
  '!==': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
}

/** Thrown after a syntax error has been reported, to skip to the next statement. */
class Bail {}

/** Parses a definition into statements. Never throws: errors go to the reporter, and parsing goes on at the next line. */
export function parse(source: string, report = new Reporter(source)): { doc: Document; report: Reporter } {
  if (source.length > MAX_SOURCE) {
    report.error({ from: 0, to: 0 }, `the definition is ${source.length} characters long; at most ${MAX_SOURCE}`)
    return { doc: { body: [] }, report }
  }
  const p = new Parser(lex(source, report), source, report)
  return { doc: { body: p.block(false) }, report }
}

/** Parses one formula on its own, e.g. a template's `${…}` part. */
export function parseExpression(source: string, from: number, to: number, report: Reporter, depth = 0): Expr {
  const p = new Parser(lex(source, report, from, to), source, report)
  p.depth = depth
  try {
    const e = p.expr()
    if (p.peek().kind !== 'eof') p.fail(p.peek(), `unexpected ${describe(p.peek())} in the formula`)
    return e
  } catch (e) {
    if (e instanceof Bail) return { t: 'error', from, to }
    throw e
  }
}

class Parser {
  i = 0
  depth = 0
  /** Blocks open around the statement being read. */
  blocks = 0

  constructor(
    readonly toks: Token[],
    readonly source: string,
    readonly report: Reporter,
  ) {}

  peek(k = 0): Token {
    return this.toks[Math.min(this.i + k, this.toks.length - 1)]!
  }

  next(): Token {
    const t = this.peek()
    if (t.kind !== 'eof') this.i++
    return t
  }

  is(text: string, k = 0) {
    const t = this.peek(k)
    return t.kind === 'punct' && t.text === text
  }

  eat(text: string) {
    if (!this.is(text)) return false
    this.i++
    return true
  }

  expect(text: string, what: string): Token {
    if (!this.is(text)) this.fail(this.peek(), `expected ${what}, found ${describe(this.peek())}`)
    return this.next()
  }

  fail(at: Span, message: string, hint?: string): never {
    this.report.error(at, message, hint)
    throw new Bail()
  }

  /** Statements up to the end of the file, or up to the `}` that closes this block (left for the caller). */
  block(inBraces: boolean): Stmt[] {
    const out: Stmt[] = []
    for (;;) {
      while (this.peek().kind === 'newline' || this.is(';')) this.next()
      const t = this.peek()
      if (t.kind === 'eof') break
      if (this.is('}')) {
        if (inBraces) break
        this.report.error(t, 'this "}" closes no block')
        this.next()
        continue
      }
      try {
        out.push(this.statement())
        const end = this.peek()
        if (!(end.kind === 'newline' || end.kind === 'eof' || this.is(';') || this.is('}')))
          this.fail(end, `expected the end of the line, found ${describe(end)}`)
      } catch (e) {
        if (!(e instanceof Bail)) throw e
        this.recover()
      }
    }
    return out
  }

  /** Skips to the end of the broken statement: the next line, `;` or the `}` of the enclosing block. */
  recover() {
    let depth = 0
    for (;;) {
      const t = this.peek()
      if (t.kind === 'eof') return
      if (depth === 0 && (t.kind === 'newline' || this.is(';') || this.is('}'))) return
      if (this.is('{')) depth++
      else if (this.is('}')) depth--
      this.next()
    }
  }

  statement(): Stmt {
    const t = this.peek()
    if (t.kind === 'number' || (this.is('-') && this.peek(1).kind === 'number')) return this.row()
    if (t.kind !== 'ident') this.fail(t, `expected a statement, found ${describe(t)}`)
    if (this.is(':', 1)) return this.property()
    if (this.is('->', 1)) return this.edge()
    return this.decl()
  }

  ident(what = 'a name'): Ident {
    const t = this.peek()
    if (t.kind !== 'ident') this.fail(t, `expected ${what}, found ${describe(t)}`)
    this.next()
    return { name: t.text, from: t.from, to: t.to }
  }

  property(): Property {
    const key = this.ident()
    this.expect(':', '":"')
    if (this.endsStatement()) this.fail(this.peek(), `"${key.name}" has no value`)
    const value = this.expr()
    if (this.is('->')) {
      if (value.t !== 'id') this.fail(value, 'a route is a list of names joined by "->"')
      const chain: Ident[] = [{ name: value.name, from: value.from, to: value.to }]
      while (this.eat('->')) chain.push(this.ident('a stage'))
      return { kind: 'prop', key, value, chain, from: key.from, to: chain.at(-1)!.to }
    }
    return { kind: 'prop', key, value, from: key.from, to: value.to }
  }

  edge(): Edge {
    const chain = [this.ident()]
    while (this.eat('->')) chain.push(this.ident('a name after "->"'))
    const e: Edge = { kind: 'edge', chain, from: chain[0]!.from, to: chain.at(-1)!.to }
    if (this.eat(':')) {
      if (this.endsStatement()) this.fail(this.peek(), 'expected a value after ":"')
      e.value = this.expr()
      e.to = e.value.to
    }
    if (this.is('{')) this.body(e)
    return e
  }

  decl(): Decl {
    const k = this.next()
    const d: Decl = {
      kind: 'decl',
      keyword: { name: k.text, from: k.from, to: k.to },
      args: [],
      from: k.from,
      to: k.to,
    }
    for (;;) {
      const t = this.peek()
      if (t.kind === 'ident' || t.kind === 'string' || t.kind === 'template' || t.kind === 'number') {
        d.args.push(this.primary())
      } else if (this.is('-') && this.peek(1).kind === 'number') d.args.push(this.unary())
      else break
      d.to = d.args.at(-1)!.to
    }
    if (this.eat('=')) {
      if (this.endsStatement()) this.fail(this.peek(), 'expected a formula after "="')
      d.init = this.expr()
      d.to = d.init.to
    }
    if (this.is('{')) this.body(d)
    else if (!this.endsStatement())
      this.fail(this.peek(), `expected "{" or the end of the line, found ${describe(this.peek())}`)
    return d
  }

  body(d: Decl | Edge) {
    if (this.blocks >= MAX_DEPTH) {
      // skip the block whole, without recursing: a shared definition must not exhaust the stack
      const open = this.next()
      this.report.error(open, `blocks are nested more than ${MAX_DEPTH} deep`)
      for (let depth = 1; depth > 0 && this.peek().kind !== 'eof'; ) {
        const t = this.next()
        if (t.kind === 'punct' && t.text === '{') depth++
        else if (t.kind === 'punct' && t.text === '}') depth--
      }
      d.to = this.peek().from
      return
    }
    this.blocks++
    try {
      this.bodyInside(d)
    } finally {
      this.blocks--
    }
  }

  bodyInside(d: Decl | Edge) {
    const open = this.next()
    d.body = this.block(true)
    const close = this.peek()
    if (!this.is('}')) {
      this.report.error(open, `this "{" of "${'keyword' in d ? d.keyword.name : 'edge'}" is never closed`)
      // open to the end: a cursor typing at the end of the file is still inside
      d.bodySpan = { from: open.from, to: close.from + 1 }
      d.to = close.from
      return
    }
    this.next()
    d.bodySpan = { from: open.from, to: close.to }
    d.to = close.to
  }

  row(): Row {
    const values: Expr[] = []
    while (this.peek().kind === 'number' || (this.is('-') && this.peek(1).kind === 'number')) {
      values.push(this.unary())
      this.eat(',')
    }
    return { kind: 'row', values, from: values[0]!.from, to: values.at(-1)!.to }
  }

  endsStatement() {
    const t = this.peek()
    return t.kind === 'newline' || t.kind === 'eof' || this.is(';') || this.is('}')
  }

  expr(): Expr {
    if (++this.depth > MAX_DEPTH) this.fail(this.peek(), `the formula is nested more than ${MAX_DEPTH} deep`)
    try {
      const test = this.binary(1)
      if (this.is('±') || this.is('+/-')) return this.pm(test)
      if (!this.eat('?')) return test
      const then = this.expr()
      this.expect(':', '":" of the "?"')
      const otherwise = this.expr()
      return { t: 'cond', test, then, else: otherwise, from: test.from, to: otherwise.to }
    } finally {
      this.depth--
    }
  }

  /** `value ± within` or `value ± within%`: parsed anywhere, so the checker can say where it belongs. */
  pm(value: Expr): Expr {
    this.next()
    const within = this.unary()
    const percent = this.is('%') ? this.next() : null
    return { t: 'pm', value, within, percent: !!percent, from: value.from, to: percent?.to ?? within.to }
  }

  binary(min: number): Expr {
    let left = this.unary()
    for (;;) {
      const t = this.peek()
      const prec = t.kind === 'punct' ? PREC[t.text] : undefined
      if (prec == null || prec < min) return left
      this.next()
      const right = this.binary(prec + 1)
      const op = (t.text === '===' ? '==' : t.text === '!==' ? '!=' : t.text) as BinOp
      left = { t: 'bin', op, left, right, from: left.from, to: right.to }
    }
  }

  unary(): Expr {
    const t = this.peek()
    if (this.is('-') || this.is('+') || this.is('!')) {
      this.next()
      if (++this.depth > MAX_DEPTH) this.fail(t, `the formula is nested more than ${MAX_DEPTH} deep`)
      try {
        const arg = this.unary()
        return { t: 'unary', op: t.text as '-' | '+' | '!', arg, from: t.from, to: arg.to }
      } finally {
        this.depth--
      }
    }
    return this.primary()
  }

  primary(): Expr {
    const t = this.peek()
    // a mark that cannot start a value stays put, so a "}" still closes its block
    const starts = t.kind !== 'punct' ? t.kind !== 'newline' && t.kind !== 'eof' : t.text === '(' || t.text === '['
    if (!starts) this.fail(t, `expected a value, found ${describe(t)}`)
    this.next()
    switch (t.kind) {
      case 'number':
        return { t: 'num', value: t.value as number, from: t.from, to: t.to }
      case 'string':
        return { t: 'str', value: t.value as string, from: t.from, to: t.to }
      case 'template':
        return {
          t: 'tpl',
          quasis: t.quasis!,
          parts: t.parts!.map((s) => this.part(s)),
          from: t.from,
          to: t.to,
        }
      case 'ident': {
        if (t.text === 'true' || t.text === 'false')
          return { t: 'bool', value: t.text === 'true', from: t.from, to: t.to }
        let callee: Ident = { name: t.text, from: t.from, to: t.to }
        if (this.is('.')) {
          this.next()
          const prop = this.ident('a name after "."')
          if (!this.is('(')) {
            // at.<stage>.<flow>: the one table with two names
            if (callee.name === 'at' && this.is('.')) {
              this.next()
              const flow = this.ident('a flow after "at.<stage>."')
              if (this.is('.')) this.fail(this.peek(), 'at takes two names: at.db.orders')
              return { t: 'member', object: callee, prop, flow, from: t.from, to: flow.to }
            }
            if (this.is('.')) this.fail(this.peek(), 'only one "." is allowed: flows.orders, util.db')
            return { t: 'member', object: callee, prop, from: t.from, to: prop.to }
          }
          // Math.min(…) reads as min(…), so formulas can be pasted from TypeScript
          if (callee.name !== 'Math') this.fail(callee, `"${callee.name}.${prop.name}(…)" is not a function`)
          callee = prop
        }
        if (this.is('(')) {
          this.next()
          const args: Expr[] = []
          while (!this.is(')')) {
            args.push(this.expr())
            if (!this.eat(',')) break
          }
          const close = this.expect(')', '")" or ","')
          return { t: 'call', callee, args, from: t.from, to: close.to }
        }
        return { t: 'id', name: t.text, from: t.from, to: t.to }
      }
      case 'punct':
        if (t.text === '(') {
          const e = this.expr()
          const close = this.expect(')', '")"')
          return { ...e, from: t.from, to: close.to }
        }
        if (t.text === '[') {
          const items: Expr[] = []
          while (!this.is(']')) {
            items.push(this.expr())
            if (!this.eat(',')) break
          }
          const close = this.expect(']', '"]" or ","')
          return { t: 'array', items, from: t.from, to: close.to }
        }
        break
    }
    this.fail(t, `expected a value, found ${describe(t)}`)
  }

  /** One `${…}` of a template, parsed from its place in the source so errors point into it. */
  part(s: Span): Expr {
    if (s.to > s.from) return parseExpression(this.source, s.from, s.to, this.report, this.depth)
    this.report.error({ from: s.from - 2, to: s.to + 1 }, 'an empty part in a template')
    return { t: 'error', from: s.from, to: s.to }
  }
}

function describe(t: Token): string {
  switch (t.kind) {
    case 'eof':
      return 'the end of the file'
    case 'newline':
      return 'the end of the line'
    case 'string':
    case 'template':
      return 'a text'
    case 'number':
      return `the number ${t.text}`
    default:
      return `"${t.text}"`
  }
}
