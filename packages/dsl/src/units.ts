import type { Expr } from './ast'

/**
 * What a formula counts, as far as its text tells: the power of seconds in it (a rate is -1, a time 1, a share or a
 * count 0) and, for a count, the word it counts in ("cores"). A full algebra of units is left out on purpose: a bare
 * number is any unit, so every definition written before units compiles as it did, and only what the text says (a
 * flow, `20ms`, `80%`, a fit's y, `as "cores"`) is checked.
 */
export interface Unit {
  time: number
  word?: string
}

/** What the units of a formula's names come from. */
export interface UnitNames {
  /** A let's formula. */
  let(name: string): Expr | undefined
  /** A fit's y: what it returns. */
  fit(name: string): string | undefined
}

const CAPACITIES = new Set(['measured', 'estimated', 'configured'])
const SECONDS: Unit = { time: 1 }
const PLAIN: Unit = { time: 0 }
const RATE: Unit = { time: -1 }

/** A unit a second: "req/s", "MB/sec", "requests per second", "rps", "Mbps". */
const PER_SECOND = /(\/\s*s(ec(ond)?s?)?|\bper\s+sec(ond)?|^[a-z]*ps)$/i
/** A y that names a time or a rate: `ms`, `p99`, `cpu_seconds`, `rps`, `throughput`. */
const NOT_A_COUNT = /^(ms|s|secs?|seconds?|min|minutes?|h|hours?|p\d+|[a-z]*ps|latency|time|duration|rate|throughput)$/i

/** A capacity's unit: anything a second ("req/s", "rps") is a rate; any other word is a count of it. */
export function parseUnit(text: string): Unit {
  const word = text.trim()
  return PER_SECOND.test(word) ? { time: -1, word } : { time: 0, word }
}

/**
 * What a fit returns: its y as a count, when y is one plain word that names neither a time nor a rate (`cores`, not
 * `cpu_seconds`, `p99` or `rps`); otherwise unknown.
 */
function fitUnit(y: string): Unit | null {
  return /^[a-z]+$/i.test(y) && !NOT_A_COUNT.test(y) ? { time: 0, word: y } : null
}

/** The unit of a formula, or null where the text does not say. */
export function unitOf(e: Expr, names: UnitNames, seen: ReadonlySet<string> = new Set()): Unit | null {
  const of = (x: Expr) => unitOf(x, names, seen)
  switch (e.t) {
    case 'num':
      if (!e.unit) return null
      return e.unit === '%' || e.unit === '×' || e.unit === 'x' ? PLAIN : SECONDS
    case 'id': {
      // `load` is a multiple, but `rate: load` means one a second at 1×: any unit, like a bare number
      const init = names.let(e.name)
      // a let that reads itself is an error of its own: unknown here
      if (!init || seen.has(e.name)) return null
      return unitOf(init, names, new Set([...seen, e.name]))
    }
    case 'member': {
      const table = e.object.name
      if (table === 'flows' || table === 'at') return RATE
      if (table === 'util') return PLAIN
      if (table === 'derived') return of({ t: 'id', name: e.prop.name, from: e.prop.from, to: e.prop.to })
      return null
    }
    case 'unary':
      return e.op === '!' ? null : of(e.arg)
    case 'pm':
      return of(e.value)
    case 'cond':
      return same(of(e.then), of(e.else))
    case 'bin': {
      if (e.op !== '*' && e.op !== '/' && e.op !== '+' && e.op !== '-') return null
      const [a, b] = [of(e.left), of(e.right)]
      if (!a || !b) return null
      if (e.op === '+' || e.op === '-') return same(a, b)
      // a product's word is gone: cores × 2 counts something else, and saying what is `as`'s job
      return { time: e.op === '*' ? a.time + b.time : a.time - b.time }
    }
    case 'call': {
      const f = e.callee.name
      const y = names.fit(f)
      if (y !== undefined) return fitUnit(y)
      if (f === 'round' || f === 'floor' || f === 'ceil' || f === 'abs') return e.args[0] ? of(e.args[0]) : null
      if (f === 'min' || f === 'max') return e.args.length ? e.args.map(of).reduce((u, v) => same(u, v)) : null
      if (CAPACITIES.has(f)) {
        const unit = e.args[1]
        return unit?.t === 'str' ? parseUnit(unit.value) : null
      }
      return null
    }
    default:
      return null
  }
}

/** The unit two values share, or null when they differ or either is unknown. */
function same(a: Unit | null, b: Unit | null): Unit | null {
  if (!a || !b || a.time !== b.time) return null
  if (a.word === undefined || b.word === undefined) return { time: a.time }
  return wordsMatch(a.word, b.word) ? a : { time: a.time }
}

/** "core" and "Cores" are one word; "cores" and "connections" two. */
const wordsMatch = (a: string, b: string) => norm(a) === norm(b)
const norm = (w: string) => w.trim().toLowerCase().replace(/s$/, '')

/**
 * Whether a demand in `d` and a capacity in `c` disagree: per second against a count, or two counts in different
 * words. Rates are never compared by word: orders a second become requests or writes a second all the time.
 */
export function disagree(d: Unit, c: Unit): boolean {
  if (d.time !== c.time) return true
  return d.time === 0 && d.word !== undefined && c.word !== undefined && !wordsMatch(d.word, c.word)
}

/** A unit in words, after "is": `per second`, `in "cores"`, `in seconds`. */
export function describe(u: Unit): string {
  if (u.word !== undefined) return `in "${u.word}"`
  if (u.time === -1) return 'per second'
  if (u.time === 1) return 'in seconds'
  if (u.time === 0) return 'a plain number (a share or a count)'
  return `in seconds to the power ${u.time}`
}

/** The measured(…), estimated(…) or configured(…) a capacity is, directly or through lets. */
export function capacityCall(
  e: Expr,
  names: UnitNames,
  seen: ReadonlySet<string> = new Set(),
): Extract<Expr, { t: 'call' }> | undefined {
  if (e.t === 'call') return CAPACITIES.has(e.callee.name) ? e : undefined
  if (e.t !== 'id' || seen.has(e.name)) return undefined
  const init = names.let(e.name)
  return init && capacityCall(init, names, new Set([...seen, e.name]))
}

/** The unit a property of the schema is in, how a warning and the reference say it, and what to write instead. */
export const PROPERTY_UNITS = {
  seconds: { unit: SECONDS, words: 'in seconds', hint: 'write a time: 20ms, 5s' },
  share: { unit: PLAIN, words: 'a share', hint: 'write a share: 0.8 or 80%' },
  'per second': { unit: RATE, words: 'per second', hint: 'write units a second: 40 * load' },
} as const satisfies Record<string, { unit: Unit; words: string; hint: string }>
