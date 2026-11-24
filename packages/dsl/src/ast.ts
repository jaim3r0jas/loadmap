import type { Span } from './diagnostics'
import type { Suffix } from './lexer'

export interface Ident extends Span {
  name: string
}

export type Expr = Span &
  (
    | { t: 'num'; value: number; unit?: Suffix; written?: number }
    | { t: 'str'; value: string; continued?: true }
    | { t: 'bool'; value: boolean }
    | { t: 'tpl'; quasis: string[]; parts: Expr[] }
    | { t: 'id'; name: string }
    /** `flows.orders`; `at.db.orders` has a second name, the flow. */
    | { t: 'member'; object: Ident; prop: Ident; flow?: Ident }
    | { t: 'call'; callee: Ident; args: Expr[] }
    | { t: 'unary'; op: '-' | '+' | '!'; arg: Expr }
    /**
     * `glued`: a `%` written straight after a number (`30%+1`) in a file stamped before 1.5, where a share was likely
     * meant. `triple`: where it was written `===` or `!==`, the old spelling of `==` and `!=`. `plusMinus`: a `+`
     * and a `-` written as one `+-` (`a +- b`) in a file stamped before 1.6, where it became `±`.
     */
    | { t: 'bin'; op: BinOp; left: Expr; right: Expr; glued?: true; triple?: Span; plusMinus?: Span }
    | { t: 'cond'; test: Expr; then: Expr; else: Expr }
    | { t: 'array'; items: Expr[] }
    /**
     * `value +- within`, `value +- within%`: only as the first value of measured(…) or estimated(…). `mark` is where the
     * `+-` is written, or `±` or `+/-`.
     */
    | { t: 'pm'; value: Expr; within: Expr; percent: boolean; mark: Span }
    | { t: 'error' }
  )

export type BinOp = '||' | '&&' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/' | '%'

/**
 * An operator written in parentheses: the parser keeps no node for them, only the wider span. The one place they say
 * more than the tree does is a comparison of a comparison (`(a == b) == c`), which without them is a chain.
 */
export const parenthesized = (e: Extract<Expr, { t: 'bin' }>): boolean => e.from < e.left.from

/** `key: value`. A value is a formula, or a chain of names (`a -> b -> c`) for a route. */
export interface Property extends Span {
  kind: 'prop'
  key: Ident
  value: Expr
  chain?: Ident[]
  /** `demand: … as "cores"`: the unit a demand is in, where its formula cannot tell. */
  as?: Span & { unit: string }
}

/** `keyword args… [= init] [{ body }]`: every statement that declares something. */
export interface Decl extends Span {
  kind: 'decl'
  keyword: Ident
  /** Names, labels, numbers: what follows the keyword on its line. */
  args: Expr[]
  init?: Expr
  body?: Stmt[]
  /** The braces, for finding the block a cursor sits in. */
  bodySpan?: Span
  /** Properties of its block whose value did not parse: present, so nothing says they are missing. */
  broken?: string[]
}

/** `a -> b -> c [: label] [{ body }]`: edges, and in a fan-out its branches (`flow -> stage: share`). */
export interface Edge extends Span {
  kind: 'edge'
  chain: Ident[]
  value?: Expr
  body?: Stmt[]
  bodySpan?: Span
  /** The ":" of `a -> b: { … }`, a slip the compiler names where it knows what the edge is. */
  colon?: Span
}

/** A line of numbers: a data point of a fit. */
export interface Row extends Span {
  kind: 'row'
  values: Expr[]
}

export type Stmt = Property | Decl | Edge | Row

export interface Document {
  body: Stmt[]
}

/** The formulas directly inside a formula, in order; a template's parts only when asked (they are its own text). */
export function childrenOf(e: Expr, templates = false): Expr[] {
  switch (e.t) {
    case 'unary':
      return [e.arg]
    case 'pm':
      return [e.value, e.within]
    case 'cond':
      return [e.test, e.then, e.else]
    case 'bin':
      return [e.left, e.right]
    case 'call':
      return e.args
    case 'array':
      return e.items
    case 'tpl':
      return templates ? e.parts : []
    default:
      return []
  }
}

/** Every formula of the statements, the ones inside formulas and templates too, outermost first. */
export function* formulasOf(body: readonly Stmt[]): Generator<Expr> {
  function* inside(e: Expr): Generator<Expr> {
    yield e
    for (const c of childrenOf(e, true)) yield* inside(c)
  }
  for (const s of body) {
    if (s.kind === 'row') for (const v of s.values) yield* inside(v)
    else if (s.kind === 'prop') yield* inside(s.value)
    else {
      if (s.kind === 'decl') {
        for (const a of s.args) yield* inside(a)
        if (s.init) yield* inside(s.init)
      } else if (s.value) yield* inside(s.value)
      if (s.body) yield* formulasOf(s.body)
    }
  }
}
