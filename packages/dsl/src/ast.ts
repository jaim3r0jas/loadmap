import type { Span } from './diagnostics'

export interface Ident extends Span {
  name: string
}

export type Expr = Span &
  (
    | { t: 'num'; value: number }
    | { t: 'str'; value: string }
    | { t: 'bool'; value: boolean }
    | { t: 'tpl'; quasis: string[]; parts: Expr[] }
    | { t: 'id'; name: string }
    /** `flows.orders`; `at.db.orders` has a second name, the flow. */
    | { t: 'member'; object: Ident; prop: Ident; flow?: Ident }
    | { t: 'call'; callee: Ident; args: Expr[] }
    | { t: 'unary'; op: '-' | '+' | '!'; arg: Expr }
    | { t: 'bin'; op: BinOp; left: Expr; right: Expr }
    | { t: 'cond'; test: Expr; then: Expr; else: Expr }
    | { t: 'array'; items: Expr[] }
    /** `value ± within`, `value ± within%`: only as the first value of measured(…) or estimated(…). */
    | { t: 'pm'; value: Expr; within: Expr; percent: boolean }
    | { t: 'error' }
  )

export type BinOp = '||' | '&&' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/' | '%'

/** `key: value`. A value is a formula, or a chain of names (`a -> b -> c`) for a route. */
export interface Property extends Span {
  kind: 'prop'
  key: Ident
  value: Expr
  chain?: Ident[]
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
}

/** `a -> b -> c [: label] [{ body }]`: edges, and in a fan-out its branches (`flow -> stage: share`). */
export interface Edge extends Span {
  kind: 'edge'
  chain: Ident[]
  value?: Expr
  body?: Stmt[]
  bodySpan?: Span
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
