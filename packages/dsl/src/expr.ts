import { type Capacity, configured, estimated, type LinearFit, measured } from '@loadmap/core'
import { compact, fmt, pct, secs } from '@loadmap/core/format'
import { flowOf } from '@loadmap/core/internal'
import type { Expr } from './ast'
import { didYouMean, type Reporter, type Span } from './diagnostics'
import { own, type Scope } from './schema'

export type Type = 'number' | 'boolean' | 'string' | 'capacity' | 'any'

/** A formula ready to run: built from the syntax tree as closures, never from source text. */
export interface Formula {
  type: Type
  /** Reads nothing from the model, so it can be computed once. */
  constant: boolean
  /** Reads `ctx.derived`, so it cannot be computed where only the parameter values are known. */
  run: (ctx: any, local?: unknown) => unknown
}

/** A host's own functions: the escape hatch for what formulas cannot say. Each is called with plain values. */
export type HostFunctions = Readonly<Record<string, (...args: any[]) => unknown>>

/** What a formula may name. */
export interface Names {
  /** The load and every parameter, with the type of its value. */
  params: ReadonlyMap<string, Type>
  /** `let` names; their type, once known. */
  lets: ReadonlyMap<string, Type>
  flows: ReadonlySet<string>
  stages: ReadonlySet<string>
  components: ReadonlySet<string>
  fits: ReadonlyMap<string, LinearFit | null>
  functions: HostFunctions
}

/** A formula failed while the model ran: where, and why. */
export class FormulaError extends Error {
  constructor(
    readonly span: Span,
    message: string,
    readonly hint?: string,
  ) {
    super(message)
  }
}

const ISSUES = 'https://github.com/jaim3r0jas/loadmap/issues'

/**
 * A run-time error in the definition's words: core's own (`loadmap: …`) as written; a TypeError or ReferenceError, which
 * no definition can cause, as a bug in loadmap, its text kept for the report.
 */
export function failure(err: unknown, what = 'this formula'): { message: string; hint?: string } {
  if (err instanceof TypeError || err instanceof ReferenceError)
    return {
      message: `${what} could not be computed: a bug in loadmap`,
      hint: `Please report it at ${ISSUES} (${err.name}: ${err.message})`,
    }
  return { message: err instanceof Error ? err.message.replace(/^loadmap: /, '') : String(err) }
}

interface Builtin {
  args: Type[]
  /** The rest of the arguments have the last type. */
  variadic?: boolean
  min?: number
  result: Type
  fn: (...a: any[]) => unknown
  /** The arguments' names, as autocomplete and signature help show them. */
  params: string[]
  doc: string
}

const num = (f: (...a: number[]) => number): Builtin['fn'] => f as Builtin['fn']
/** Functions renamed before 0.1: a definition from before says what to write instead. */
const RENAMED: Readonly<Record<string, string>> = { kfmt: 'compact' }

const math = (fn: (...a: number[]) => number, doc: string, params = ['x']): Builtin => ({
  args: params.map(() => 'number'),
  result: 'number',
  fn: num(fn),
  params,
  doc,
})
const text = (fn: Builtin['fn'], doc: string): Builtin => ({
  args: ['number'],
  result: 'string',
  fn,
  params: ['x'],
  doc,
})
const capacity = (fn: Builtin['fn'], doc: string): Builtin => ({
  args: ['number', 'string', 'string'],
  min: 2,
  result: 'capacity',
  fn,
  params: ['value', 'unit', 'source'],
  doc,
})

export const BUILTINS: Readonly<Record<string, Builtin>> = {
  min: { ...math(Math.min, 'The smallest of the values.', ['a', 'b']), variadic: true, min: 1 },
  max: { ...math(Math.max, 'The largest of the values.', ['a', 'b']), variadic: true, min: 1 },
  round: math(Math.round, 'To the nearest whole number.'),
  floor: math(Math.floor, 'Down to a whole number.'),
  ceil: math(Math.ceil, 'Up to a whole number: ceil(rate / 500) pods.'),
  abs: math(Math.abs, 'Without its sign.'),
  sqrt: math(Math.sqrt, 'The square root.'),
  log: math(Math.log, 'The natural logarithm.'),
  exp: math(Math.exp, 'e to the power of x.'),
  pow: math(Math.pow, 'x to the power of y.', ['x', 'y']),
  fmt: text(fmt, 'A number for a reader: 1,234 / 12.3 / 0.4.'),
  compact: text(compact, 'A compact number: 980 / 1.2k / 34k / 1.5M.'),
  pct: text(pct, 'A share from 0 to 1 as a percentage: 50 %.'),
  secs: text(secs, 'A duration in seconds: 42 s / 3 min / > 1 h.'),
  measured: capacity(measured, 'A capacity read off a dashboard or a load test. `value ± 30%` says how sure it is.'),
  estimated: capacity(
    estimated,
    "A capacity from a vendor's figure, a benchmark elsewhere or a guess: the verdict says so. `value ± 30%` says how sure it is.",
  ),
  configured: capacity(configured, "A limit someone set, such as a rate limiter's: exact, so it takes no ±."),
}

/** The tables a formula may read with a ".": flows.orders, at.db.orders, demand.db, util.db, derived.x. */
const TABLES = ['flows', 'at', 'demand', 'util', 'derived'] as const
/** Names a declaration cannot take: the tables, the locals, the literals and what plain objects already have. */
export const RESERVED = new Set<string>([
  'load',
  ...TABLES,
  'i',
  'value',
  'true',
  'false',
  'Math',
  ...Object.keys(BUILTINS),
  ...Object.getOwnPropertyNames(Object.prototype),
  'prototype',
])

const WORD: Record<Type, string> = {
  number: 'a number',
  boolean: 'true or false',
  string: 'a text',
  capacity: 'a capacity',
  any: 'a value',
}
export const typeWord = (t: Type) => WORD[t]

/**
 * Checks a formula against what it may read (`scope`) and compiles it. Errors are reported; the result then has type
 * `any` and returns undefined, so checking goes on.
 */
export function compileFormula(e: Expr, names: Names, scope: Scope, report: Reporter): Formula {
  return new Compiler(names, scope, report).compile(e)
}

const bad: Formula = { type: 'any', constant: true, run: () => undefined }

class Compiler {
  constructor(
    readonly names: Names,
    readonly scope: Scope,
    readonly report: Reporter,
  ) {}

  canRead(e: Span, what: string): boolean {
    const allowed = this.scope === 'ctx' || (this.scope === 'values' && what === 'a parameter')
    if (allowed) return true
    const here =
      this.scope === 'const'
        ? 'this value must be a constant'
        : this.scope === 'values'
          ? 'this formula reads only parameters'
          : `this formula reads only "${this.scope}"`
    this.report.error(e, `${here}; it cannot read ${what}`)
    return false
  }

  compile(e: Expr): Formula {
    switch (e.t) {
      case 'error':
        return bad
      case 'num':
      case 'str':
      case 'bool': {
        const v = e.value
        return { type: e.t === 'num' ? 'number' : e.t === 'str' ? 'string' : 'boolean', constant: true, run: () => v }
      }
      case 'tpl': {
        const parts = e.parts.map((p) => this.compile(p))
        const { quasis } = e
        const runs = parts.map((p) => p.run)
        return {
          type: 'string',
          constant: parts.every((p) => p.constant),
          run: (c, l) => {
            let s = quasis[0]!
            for (let i = 0; i < runs.length; i++) s += String(runs[i]!(c, l)) + quasis[i + 1]!
            return s
          },
        }
      }
      case 'id':
        return this.name(e, e.name)
      case 'member':
        return this.member(e)
      case 'call':
        return this.call(e)
      case 'unary': {
        const a = this.compile(e.arg)
        const run = a.run
        if (e.op === '!') return { type: 'boolean', constant: a.constant, run: (c, l) => !run(c, l) }
        this.want(e.arg, a, 'number')
        return { type: 'number', constant: a.constant, run: e.op === '-' ? (c, l) => -(run(c, l) as number) : run }
      }
      case 'bin':
        return this.binary(e)
      case 'cond': {
        const test = this.compile(e.test)
        const then = this.compile(e.then)
        const other = this.compile(e.else)
        const [t, a, b] = [test.run, then.run, other.run]
        return {
          type: then.type === other.type ? then.type : 'any',
          constant: test.constant && then.constant && other.constant,
          run: (c, l) => (t(c, l) ? a(c, l) : b(c, l)),
        }
      }
      case 'array':
        this.report.error(e, 'a list is only allowed as the options of a parameter')
        return bad
      case 'pm':
        this.report.error(e, '"±" only goes in the first value of measured(…) or estimated(…)')
        return bad
    }
  }

  name(e: Span, name: string): Formula {
    if (name === 'i' || name === 'value') {
      if (this.scope !== name) {
        this.report.error(e, `"${name}" is only known in ${name === 'i' ? 'memberLabel and podLabel' : 'format'}`)
        return bad
      }
      return { type: name === 'i' ? 'number' : 'any', constant: false, run: (_, l) => l }
    }
    const param = this.names.params.get(name)
    if (param) {
      if (!this.canRead(e, 'a parameter')) return bad
      return { type: param, constant: false, run: (c) => c[name] }
    }
    const let_ = this.names.lets.get(name)
    if (let_) {
      if (!this.canRead(e, `"${name}"`)) return bad
      return { type: let_, constant: false, run: (c) => c.derived[name] }
    }
    if ((TABLES as readonly string[]).includes(name)) {
      this.report.error(e, `"${name}" is a table: name one of its entries, like ${name}.${this.example(name)}`)
      return bad
    }
    if (this.names.fits.has(name) || own(BUILTINS, name) || own(this.names.functions, name)) {
      this.report.error(e, `"${name}" is a function: call it, ${name}(…)`)
      return bad
    }
    const known = [...this.names.params.keys(), ...this.names.lets.keys()]
    this.report.error(e, `unknown name "${name}"`, didYouMean(name, known))
    return bad
  }

  example(table: string) {
    const pool =
      table === 'flows'
        ? this.names.flows
        : table === 'at'
          ? this.names.stages
          : table === 'derived'
            ? this.names.lets.keys()
            : this.names.components
    return [...pool][0] ?? 'x'
  }

  member(e: Extract<Expr, { t: 'member' }>): Formula {
    const table = e.object.name
    const key = e.prop.name
    if (table === 'at') return this.at(e)
    const pool: Iterable<string> | undefined =
      table === 'flows'
        ? this.names.flows
        : table === 'demand' || table === 'util'
          ? this.names.components
          : table === 'derived'
            ? this.names.lets.keys()
            : undefined
    if (!pool) {
      this.report.error(e.object, `"${table}" has no entries: only flows., at., demand., util. and derived. do`)
      return bad
    }
    const has = table === 'derived' ? this.names.lets.has(key) : (pool as ReadonlySet<string>).has(key)
    if (!has) {
      const what = table === 'flows' ? 'flow' : table === 'derived' ? 'let' : 'component'
      this.report.error(e.prop, `unknown ${what} "${key}"`, didYouMean(key, pool))
      return bad
    }
    if (!this.canRead(e, `${table}.${key}`)) return bad
    const type = table === 'derived' ? this.names.lets.get(key)! : 'number'
    return { type, constant: false, run: (c) => c[table][key] }
  }

  /** at.db: every flow reaching the stage, per second; at.db.orders: one flow. */
  at(e: Extract<Expr, { t: 'member' }>): Formula {
    const stage = e.prop.name
    if (!this.names.stages.has(stage)) {
      this.report.error(e.prop, `unknown stage "${stage}"`, didYouMean(stage, this.names.stages))
      return bad
    }
    const flow = e.flow?.name
    if (flow != null && !this.names.flows.has(flow)) {
      this.report.error(e.flow!, `unknown flow "${flow}"`, didYouMean(flow, this.names.flows))
      return bad
    }
    if (!this.canRead(e, flow == null ? `at.${stage}` : `at.${stage}.${flow}`)) return bad
    const flows = [...this.names.flows]
    return {
      type: 'number',
      constant: false,
      run:
        flow == null
          ? (c) => flows.reduce((a, f) => a + (c.at[stage][f] as number), 0)
          : (c) => c.at[stage][flow] as number,
    }
  }

  call(e: Extract<Expr, { t: 'call' }>): Formula {
    const name = e.callee.name
    const pm = e.args[0]?.t === 'pm' ? e.args[0] : null
    if (pm && (name === 'measured' || name === 'estimated')) return this.capacity(e, pm)
    const args = e.args.map((a) => this.compile(a))
    const runs = args.map((a) => a.run)
    const fit = this.names.fits.get(name)
    if (this.names.fits.has(name)) {
      if (args.length !== 1) this.report.error(e, `the fit "${name}" takes one number`)
      else this.want(e.args[0]!, args[0]!, 'number')
      const a = runs[0] ?? (() => undefined)
      // the fit is filled in once its points are read; until then (or with no points) it returns undefined
      return { type: 'number', constant: args.every((x) => x.constant), run: (c, l) => fit?.(a(c, l) as number) }
    }
    const b = own(BUILTINS, name)
    if (b) {
      const max = b.variadic ? Number.POSITIVE_INFINITY : b.args.length
      const min = b.min ?? b.args.length
      if (args.length < min || args.length > max)
        this.report.error(e, `${name}() takes ${min === max ? min : `${min} to ${max}`} values, not ${args.length}`)
      for (const [i, a] of args.entries()) this.want(e.args[i]!, a, b.args[Math.min(i, b.args.length - 1)]!)
      const fn = b.fn
      return {
        type: b.result,
        constant: args.every((a) => a.constant),
        run: (c, l) => fn(...runs.map((r) => r(c, l))),
      }
    }
    const host = own(this.names.functions, name)
    if (host) {
      const run = (c: unknown, l: unknown) => {
        const args = runs.map((r) => r(c, l))
        try {
          return host(...args)
        } catch (err) {
          // the page's own code: its error, never a bug in loadmap
          throw new Error(`${name}(…) failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      return { type: 'any', constant: false, run }
    }
    const known = [...Object.keys(BUILTINS), ...this.names.fits.keys(), ...Object.keys(this.names.functions)]
    this.report.error(
      e.callee,
      `unknown function "${name}"`,
      (own(RENAMED, name) ? `renamed to ${own(RENAMED, name)}()` : undefined) ??
        didYouMean(name, known) ??
        'a host page can provide it in compile(…, { functions })',
    )
    return bad
  }

  /** measured(value ± within[%], unit, source): the ± becomes the capacity's `within`, a share of the value. */
  capacity(e: Extract<Expr, { t: 'call' }>, pm: Extract<Expr, { t: 'pm' }>): Formula {
    const fn = e.callee.name === 'measured' ? measured : estimated
    const [value, within] = [this.compile(pm.value), this.compile(pm.within)]
    const rest = e.args.slice(1).map((a) => this.compile(a))
    this.want(pm.value, value, 'number')
    this.want(pm.within, within, 'number')
    if (rest.length < 1 || rest.length > 2)
      this.report.error(e, `${e.callee.name}() takes 2 to 3 values, not ${rest.length + 1}`)
    for (const [i, a] of rest.entries()) this.want(e.args[i + 1]!, a, 'string')
    const [v, w] = [value.run, within.run]
    const [unit, source] = rest.map((a) => a.run)
    const { percent } = pm
    return {
      type: 'capacity',
      constant: [value, within, ...rest].every((a) => a.constant),
      run: (c, l) => {
        const x = v(c, l) as number
        const pmv = w(c, l) as number
        const share = percent ? pmv / 100 : x ? pmv / x : 0
        if (!(share >= 0 && share < 1)) {
          const said = percent ? `${pmv} %` : `${pmv} of ${x}`
          throw new Error(`± ${said} is not a share from 0 to below 100 %`)
        }
        return fn(x, unit?.(c, l) as string, { source: source?.(c, l) as string | undefined, within: share })
      },
    }
  }

  binary(e: Extract<Expr, { t: 'bin' }>): Formula {
    const l = this.compile(e.left)
    const r = this.compile(e.right)
    const [a, b] = [l.run, r.run]
    const constant = l.constant && r.constant
    const f = (type: Type, run: Formula['run']): Formula => ({ type, constant, run })
    switch (e.op) {
      case '||':
        return f(l.type === r.type ? l.type : 'any', (c, x) => a(c, x) || b(c, x))
      case '&&':
        return f(l.type === r.type ? l.type : 'any', (c, x) => a(c, x) && b(c, x))
      case '==':
        return f('boolean', (c, x) => a(c, x) === b(c, x))
      case '!=':
        return f('boolean', (c, x) => a(c, x) !== b(c, x))
      case '<':
        return f('boolean', (c, x) => (a(c, x) as number) < (b(c, x) as number))
      case '<=':
        return f('boolean', (c, x) => (a(c, x) as number) <= (b(c, x) as number))
      case '>':
        return f('boolean', (c, x) => (a(c, x) as number) > (b(c, x) as number))
      case '>=':
        return f('boolean', (c, x) => (a(c, x) as number) >= (b(c, x) as number))
      case '+': {
        const type =
          l.type === 'string' || r.type === 'string'
            ? 'string'
            : l.type === 'number' && r.type === 'number'
              ? 'number'
              : 'any'
        if (type !== 'string') {
          this.want(e.left, l, 'number')
          this.want(e.right, r, 'number')
        }
        return f(type, (c, x) => (a(c, x) as number) + (b(c, x) as number))
      }
      default: {
        this.want(e.left, l, 'number')
        this.want(e.right, r, 'number')
        const op = e.op
        return f('number', (c, x) => {
          const u = a(c, x) as number
          const v = b(c, x) as number
          return op === '-' ? u - v : op === '*' ? u * v : op === '/' ? u / v : u % v
        })
      }
    }
  }

  want(at: Span, f: Formula, type: Type) {
    if (f.type !== type && f.type !== 'any' && type !== 'any')
      this.report.error(at, `expected ${typeWord(type)}, this is ${typeWord(f.type)}`)
  }
}

/**
 * Wraps a formula for the model: it takes the context, and any error it throws carries the formula's place. An error
 * already placed (from a formula or a flow this one read) keeps its place: the innermost one is the one to fix.
 */
export function placed<T>(span: Span, run: (ctx: any, local?: unknown) => unknown): (ctx: any, local?: any) => T {
  return (ctx, local) => {
    try {
      return run(ctx, local) as T
    } catch (err) {
      // a flow it read failed: the flow is the place
      if (err instanceof FormulaError || flowOf(err)) throw err
      const { message, hint } = failure(err)
      throw new FormulaError(span, message, hint)
    }
  }
}

export const isCapacity = (v: unknown): v is Capacity =>
  typeof v === 'object' && v != null && 'provenance' in v && 'value' in v
