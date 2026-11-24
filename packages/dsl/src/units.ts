import type { Expr } from './ast'
import { isSize, SIZES } from './lexer'

/**
 * What a formula counts, as far as its text tells: the power of seconds in it (a rate is -1, a time 1, a share or a
 * count 0) and, for a count, the word it counts in ("cores"). A full algebra of units is left out on purpose: a bare
 * number is any unit, so every definition written before units compiles as it did, and only what the text says (a
 * flow, `20ms`, `80%`, a fit's y, `as "cores"`) is checked.
 */
export interface Unit {
  /** Unknown for a fit's y: its word says what it counts, not whether that is a rate. */
  time?: number
  word?: string
  /** A plain number written as a share (`80%`) or as a load multiple (`7×`): the one thing its suffix says. */
  mark?: 'share' | 'multiple'
}

/** What the units of a formula's names come from. */
export interface UnitNames {
  /** A let's formula. */
  let(name: string): Expr | undefined
  /** A fit's y: what it returns. */
  fit(name: string): string | undefined
  /** A parameter's default as written (a select's first option without one): `default: 1.5KB` is a size. */
  param?(name: string): Expr | undefined
}

const CAPACITIES = new Set(['measured', 'estimated', 'configured'])
const SECONDS: Unit = { time: 1 }
const PLAIN: Unit = { time: 0 }
const RATE: Unit = { time: -1 }
const SHARE: Unit = { time: 0, mark: 'share' }
const MULTIPLE: Unit = { time: 0, mark: 'multiple' }

/** The rates written as one word; never any word in "ps", which takes in "groups" and "apps". */
const RATE_WORDS = 'rps|qps|tps|pps|fps|iops|[kmg]?bps'
/** A unit a second: "req/s", "MB/sec", "requests per second", "rps", "Mbps". */
const PER_SECOND = new RegExp(`(\\/\\s*s(ec(ond)?s?)?|\\bper\\s+sec(ond)?|^(${RATE_WORDS}))$`, 'i')
/** A y that names a time or a rate: `ms`, `p99`, `cpu_seconds`, `rps`, `throughput`. */
const NOT_A_COUNT = new RegExp(
  `^(ms|s|secs?|seconds?|min|minutes?|h|hours?|p\\d+|${RATE_WORDS}|latency|time|duration|rate|throughput)$`,
  'i',
)

/** A capacity's unit: anything a second ("req/s", "rps") is a rate; any other word is a count of it. */
export function parseUnit(text: string): Unit {
  const word = text.trim()
  return PER_SECOND.test(word) ? { time: -1, word } : { time: 0, word }
}

/**
 * What a fit returns: its y's word, when y is one plain word that names neither a time nor a rate (`cores`, not
 * `cpu_seconds`, `p99` or `rps`); otherwise unknown. The word alone: `points hour orders` may well be orders a second,
 * so a fit is compared only with a count, never with a rate or a property's unit.
 */
function fitUnit(y: string): Unit | null {
  return /^[a-z]+$/i.test(y) && !NOT_A_COUNT.test(y) ? { word: y } : null
}

/** Each let's unit, worked out once: `let b = a + a` must not walk a's lets twice, or a shared link can hang. */
const memo = new WeakMap<UnitNames, Map<string, Unit | null>>()

/** The unit of a formula, or null where the text does not say. */
export function unitOf(e: Expr, names: UnitNames, seen: ReadonlySet<string> = new Set()): Unit | null {
  const of = (x: Expr) => unitOf(x, names, seen)
  switch (e.t) {
    case 'num':
      if (!e.unit) return null
      return e.unit === '%' ? SHARE : e.unit === '×' || e.unit === 'x' ? MULTIPLE : isSize(e.unit) ? PLAIN : SECONDS
    case 'id': {
      // `load` is a multiple, but `rate: load` means one a second at 1×: any unit, like a bare number
      const init = names.let(e.name)
      // a let that reads itself is an error of its own: unknown here
      if (!init || seen.has(e.name)) return null
      const known = memo.get(names) ?? new Map<string, Unit | null>()
      memo.set(names, known)
      if (known.has(e.name)) return known.get(e.name)!
      const u = unitOf(init, names, new Set([...seen, e.name]))
      known.set(e.name, u)
      return u
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
      const a = of(e.left)
      const b = a && of(e.right)
      if (!a || !b) return null
      if (e.op === '+' || e.op === '-') return same(a, b)
      if (a.time === undefined || b.time === undefined) return null
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
  // 20% + 30% is a share still; a share and a multiple together are neither
  if (a.mark && a.mark === b.mark) return a
  if (a.word === undefined || b.word === undefined) return a.time === undefined ? null : { time: a.time }
  return wordsMatch(a.word, b.word) ? a : a.time === undefined ? null : { time: a.time }
}

/** "core" and "Cores" are one word, "process" and "processes" too; "cores" and "connections" two. */
function wordsMatch(a: string, b: string): boolean {
  const [x, y] = [a.trim().toLowerCase(), b.trim().toLowerCase()]
  return x === y || x === `${y}s` || y === `${x}s` || x === `${y}es` || y === `${x}es`
}

/**
 * Whether a demand in `d` and a capacity in `c` disagree: per second against a count, or two counts in different
 * words. Rates are never compared by word: orders a second become requests or writes a second all the time.
 */
export function disagree(d: Unit, c: Unit): boolean {
  const words = d.word !== undefined && c.word !== undefined && !wordsMatch(d.word, c.word)
  // a fit's y says only its word: checked against a count, never against a rate
  if (d.time === undefined) return c.time === 0 && words
  if (c.time === undefined) return d.time === 0 && words
  if (d.time !== c.time) return true
  return d.time === 0 && words
}

/** A unit in words, after "is": `per second`, `in "cores"`, `in seconds`. */
export function describe(u: Unit): string {
  if (u.mark) return u.mark === 'share' ? 'a share' : 'a load multiple'
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

/**
 * Whether a number written as a share stands where a load multiple goes, or the other way round. Nothing is inferred:
 * the property's unit is in the schema and the suffix in the text, so this one is an error, not a warning.
 */
export function wrongMark(u: Unit, want: Unit): boolean {
  return !!u.mark && !!want.mark && u.mark !== want.mark
}

/** The unit a property of the schema is in, how a warning and the reference say it, and what to write instead. */
export const PROPERTY_UNITS = {
  seconds: { unit: SECONDS, words: 'in seconds', hint: 'write a time: 20ms, 5s' },
  share: { unit: SHARE, words: 'a share', hint: 'write a share: 0.8 or 80%' },
  multiple: { unit: MULTIPLE, words: 'a load multiple', hint: "write a multiple of today's load: 7×" },
  'per second': { unit: RATE, words: 'per second', hint: 'write units a second: 40 * load' },
} as const satisfies Record<string, { unit: Unit; words: string; hint: string }>

/**
 * Whether a formula is a size, as a power of bytes: 1 for `flows.x * 1.5KB`, 0 for a formula without one or with the
 * size divided out (`2MB / 1KB`). Unlike `unitOf` this is never unknown: a number without a size suffix is no size, so
 * a demand in bytes can be converted to its capacity's unit without guessing. `mixed` is where a size is added to,
 * compared with or chosen against something that is none.
 */
export interface SizePower {
  power: number
  mixed?: Expr
  /** A literal 0: no size and every size, so `max(0, x * 1KB - 1MB)` and `c ? x * 1KB : 0` are sizes. */
  zero?: true
}

const NO_SIZE: SizePower = { power: 0 }
const sizes = new WeakMap<UnitNames, Map<string, SizePower>>()

export function sizePower(e: Expr, names: UnitNames, seen: ReadonlySet<string> = new Set()): SizePower {
  const of = (x: Expr) => sizePower(x, names, seen)
  const alike = (list: SizePower[], at: Expr): SizePower => {
    const mixed = list.find((x) => x.mixed)?.mixed
    // a literal 0 takes the size of what it stands beside
    const sized = list.filter((x) => !x.zero)
    const first = sized[0] ?? list[0] ?? NO_SIZE
    if (mixed) return { power: first.power, mixed }
    return sized.every((x) => x.power === first.power) ? first : { power: first.power, mixed: at }
  }
  switch (e.t) {
    case 'num':
      return isSize(e.unit) ? { power: 1 } : e.value === 0 && !e.unit ? { power: 0, zero: true } : NO_SIZE
    case 'id': {
      const init = names.let(e.name) ?? names.param?.(e.name)
      if (!init || seen.has(e.name)) return NO_SIZE
      const known = sizes.get(names) ?? new Map<string, SizePower>()
      sizes.set(names, known)
      if (!known.has(e.name)) known.set(e.name, sizePower(init, names, new Set([...seen, e.name])))
      return known.get(e.name)!
    }
    case 'member':
      return e.object.name === 'derived'
        ? of({ t: 'id', name: e.prop.name, from: e.prop.from, to: e.prop.to })
        : NO_SIZE
    case 'unary':
      return e.op === '!' ? NO_SIZE : of(e.arg)
    case 'pm':
      return of(e.value)
    case 'cond':
      return alike([of(e.then), of(e.else)], e)
    case 'bin': {
      const [a, b] = [of(e.left), of(e.right)]
      const mixed = a.mixed ?? b.mixed
      if (e.op === '*' || e.op === '/')
        return { power: e.op === '*' ? a.power + b.power : a.power - b.power, ...(mixed && { mixed }) }
      if (e.op === '+' || e.op === '-' || e.op === '%') return alike([a, b], e)
      // a comparison of two sizes is true or false, no size; of a size with a plain number it is a slip
      return {
        power: 0,
        ...((mixed ?? (a.power !== b.power && !a.zero && !b.zero ? e : undefined)) && { mixed: mixed ?? e }),
      }
    }
    case 'call': {
      const f = e.callee.name
      if (names.fit(f) !== undefined) return NO_SIZE
      if (f === 'round' || f === 'floor' || f === 'ceil' || f === 'abs') return e.args[0] ? of(e.args[0]) : NO_SIZE
      if (f === 'min' || f === 'max' || f === 'mod') return alike(e.args.map(of), e)
      return NO_SIZE
    }
    default:
      return NO_SIZE
  }
}

/** A size's unit at the start of a capacity's: `MB/s`, `GB`, `KB per second`. Case matters: `Mb` is megabits. */
const SIZE_UNIT = /^(kB|KB|MB|GB|TB|B|bytes?)(?=$|\s*\/|\s+per\b|\s*$)/

/** How many bytes one of a capacity's unit is, when it counts in a size: 1e6 for "MB/s". */
export function sizeScale(unit: string): number | undefined {
  const m = SIZE_UNIT.exec(unit.trim())
  if (!m) return undefined
  return m[1] === 'B' || m[1]!.startsWith('byte') ? 1 : SIZES[m[1]!.toUpperCase() as keyof typeof SIZES]
}
