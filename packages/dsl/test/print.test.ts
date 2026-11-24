import { describe, expect, it } from 'vitest'
import { compile, flatten, format } from '../src'
import { comparedAgain, type Expr, parenthesized } from '../src/ast'
import { parse } from '../src/internal'
import { print } from '../src/print'

/**
 * What the compiler reads of a formula: the tree without its places, and for a comparison of a comparison whether it
 * is a chain (no parentheses around the first), the one thing the tree alone does not say.
 */
function shape(e: Expr): unknown {
  switch (e.t) {
    case 'num':
      return { t: e.t, value: e.value, unit: e.unit }
    case 'str':
    case 'bool':
      return { t: e.t, value: e.value }
    case 'id':
      return { t: e.t, name: e.name }
    case 'tpl':
      return { t: e.t, quasis: e.quasis, parts: e.parts.map(shape) }
    case 'member':
      return { t: e.t, object: e.object.name, prop: e.prop.name, flow: e.flow?.name }
    case 'call':
      return { t: e.t, callee: e.callee.name, args: e.args.map(shape) }
    case 'unary':
      return { t: e.t, op: e.op, arg: shape(e.arg) }
    case 'bin': {
      const again = comparedAgain(e)
      const chain = !!again && !parenthesized(again)
      return { t: e.t, op: e.op, left: shape(e.left), right: shape(e.right), chain }
    }
    case 'cond':
      return { t: e.t, test: shape(e.test), yes: shape(e.then), no: shape(e.else) }
    case 'array':
      return { t: e.t, items: e.items.map(shape) }
    case 'pm':
      return { t: e.t, value: shape(e.value), within: shape(e.within), percent: e.percent }
    case 'error':
      throw new Error('a formula that did not parse')
  }
}

const file = (version: string, formula: string) => `loadmap ${version}\nlet x = ${formula}\n`

/** The statements of a text that parses, and the formula of its `let`. */
function read(text: string) {
  const { doc, report } = parse(text)
  expect(report.failed, `${text}${report.list.map((d) => d.message).join('; ')}`).toBe(false)
  const init = doc.body.flatMap((s) => (s.kind === 'decl' && s.keyword.name === 'let' && s.init ? [s.init] : []))[0]
  if (!init) throw new Error(`no let in ${text}`)
  return { body: doc.body, tree: shape(init) }
}

/** `formula` printed from its tree, as the one line of its `let`. */
function printed(version: string, formula: string): string {
  const text = file(version, formula)
  const out = print(read(text).body, text)
  return out.slice(out.indexOf('let x = ') + 'let x = '.length).trimEnd()
}

/** A seeded generator (mulberry32): the same formulas on every run. */
function random(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ATOMS = ['a', 'b', 'load', '1', '2.5', '20ms', '"s"', 'true', 'flows.a', 'at.db.a']
const OPS = ['||', '&&', '==', '!=', '<', '<=', '>', '>=', '+', '-', '*', '/']

/**
 * A formula of every kind the parser reads. `wrap` is how often an operand stands in parentheses: at 1 every one
 * does, so the tree is the one drawn here and the printer has to find each pair that matters; below 1 the parser
 * decides, and chains and the pairs nobody needs come up too. `remainder`: the stamp still reads `%` as an operator.
 * `mark`: how the stamp writes a ±.
 */
function formula(
  r: () => number,
  depth: number,
  o: { wrap: number; remainder: boolean; mark: string; template?: boolean },
): string {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)]!
  const inner = (d = depth - 1) => formula(r, d, o)
  const operand = () => (r() < o.wrap ? `(${inner()})` : inner())
  if (depth <= 0 || r() < 0.12) return pick(ATOMS)
  switch (pick(['unary', 'bin', 'bin', 'bin', 'bin', 'cond', 'call', 'array', 'tpl', 'pm'])) {
    case 'unary':
      // spaced, so a "+" before a "-" is written as two signs
      return `${pick(['-', '+', '!'])} ${operand()}`
    case 'bin':
      return `${operand()} ${pick(o.remainder ? [...OPS, '%'] : OPS)} ${operand()}`
    case 'cond':
      return `${operand()} ? ${operand()} : ${operand()}`
    case 'call':
      return `min(${inner()}, ${inner()})`
    case 'array':
      return `[${inner()}, ${inner()}]`
    case 'tpl':
      // a template inside a template's part is left out: the lexer's business, not the printer's
      return o.template ? pick(ATOMS) : `\`n \${${formula(r, depth - 1, { ...o, template: true })}} m\``
    default:
      // a ± reads all before it and one value after it, so here it always has its own pair and so has what follows
      return `(${operand()} ${o.mark} (${inner()})${r() < 0.3 ? '%' : ''})`
  }
}

describe('print', () => {
  it('keeps the parentheses that change how a formula reads', () => {
    const cases: [string, string][] = [
      // #195: the answer of a comparison compared again, at either level
      ['(mode == "a") == flag', '(mode == "a") == flag'],
      ['(a != b) != (c == d)', '(a != b) != (c == d)'],
      ['(a < b) <= c', '(a < b) <= c'],
      ['a == (b == c)', 'a == (b == c)'],
      ['((a == b)) == c', '(a == b) == c'],
      // a chain stays the chain it was written as: the flat copy says what the files say
      ['a == b == c', 'a == b == c'],
      // precedence and associativity
      ['(a + b) * c', '(a + b) * c'],
      ['a - (b - c)', 'a - (b - c)'],
      ['a / (b * c)', 'a / (b * c)'],
      ['(a || b) && c', '(a || b) && c'],
      ['a && (b || c)', 'a && (b || c)'],
      ['(a == b) < c', '(a == b) < c'],
      ['-(a + b)', '-(a + b)'],
      ['!(a && b)', '!(a && b)'],
      ['(a ? b : c) + 1', '(a ? b : c) + 1'],
      ['(a ? b : c) ? d : e', '(a ? b : c) ? d : e'],
      ['a ? b : (c ? d : e)', 'a ? b : c ? d : e'],
      // a plus before a minus is two signs, never the "+-" of a capacity
      ['+(-a)', '+ -a'],
      ['a + -b', 'a + -b'],
      ['-(-a)', '--a'],
      // the pairs nobody needs go
      ['(a * b) + c', 'a * b + c'],
      ['(a - b) - c', 'a - b - c'],
      ['(a < b) == c', 'a < b == c'],
      ['(a && b) || (c)', 'a && b || c'],
      ['(a) + ((b))', 'a + b'],
      ['min((a), (b + c))', 'min(a, b + c)'],
      // a number and a text are copied as written, their parentheses too
      ['(1) + ("s")', '(1) + ("s")'],
    ]
    for (const [written, expected] of cases) expect(printed('1.6', written), written).toBe(expected)
    // a ± takes one value after it: its own pair stays where it stands in something larger
    expect(printed('1.6', 'estimated((a + b) +- (c * d), "x")')).toBe('estimated((a + b) +- (c * d), "x")')
    expect(printed('1.6', '(a +- b) + c')).toBe('(a +- b) + c')
    expect(printed('1.4', '(a ± b) * 2')).toBe('(a ± b) * 2')
    // "-5%" is a number with its unit, "(-5)%" a share of the value: the pair stays
    expect(printed('1.6', 'estimated(100 +- (-5)%, "x")')).toBe('estimated(100 +- (-5)%, "x")')
    expect(printed('1.6', 'estimated(100 +- (a)%, "x")')).toBe('estimated(100 +- a%, "x")')
    // before 1.5 the remainder is an operator of the level of "*"
    expect(printed('1.4', 'a % (b * c)')).toBe('a % (b * c)')
    expect(printed('1.4', '(a + b) % c')).toBe('(a + b) % c')
  })

  it.each([
    ['1.4', '±', 1],
    ['1.4', '±', 0.4],
    ['1.5', '±', 1],
    ['1.5', '±', 0.4],
    ['1.6', '+-', 1],
    ['1.6', '+-', 0.4],
  ] as const)(
    'prints any formula of %s (± as %s, %s of its operands in parentheses) as text that reads back the same',
    (version, mark, wrap) => {
      const r = random(195 + Number(version.slice(2)) * 10 + (wrap < 1 ? 1 : 0))
      for (let i = 0; i < 120; i++) {
        const text = file(version, formula(r, 4, { wrap, remainder: version === '1.4', mark }))
        const { body, tree } = read(text)
        const out = print(body, text)
        expect(read(out).tree, `${text}→ ${out}`).toEqual(tree)
        // printed again it is the same text: nothing is left to settle
        expect(print(read(out).body, out), text).toBe(out)
        // and format(), which flatten() lays it out with, changes no formula
        const laid = format(out)
        expect(laid.ok, out).toBe(true)
        expect(read(laid.text).tree, `${out}→ ${laid.text}`).toEqual(tree)
      }
    },
  )
})

describe('flatten', () => {
  // #195: the part's `(mode == "a") == flag` was written `mode == "a" == flag`, a chain, and the copy did not compile
  const files = {
    'main.loadmap': [
      'loadmap 1.6',
      'include "./part.loadmap"',
      'title: "repro"',
      'load "x" { max: 2 }',
      'param mode "Mode" { options: ["a", "b"]; default: "a" }',
      'param flag "Flag" { default: true }',
      'flow f "f" { rate: same ? 1 : 2; route: s; from: n }',
      'node n "N"',
      'node s "S" { pass; capacity: estimated(10, "req/s", "x"); over: "slow" }',
      'n -> s',
      '',
    ].join('\n'),
    'part.loadmap': 'loadmap 1.6\npart of "./main.loadmap"\n\nlet same = (mode == "a") == flag\n',
  }

  it('keeps the parentheses of a comparison that is compared again', () => {
    const o = { path: 'main.loadmap', files }
    const several = compile(files['main.loadmap'], o)
    expect(several.diagnostics).toEqual([])
    const flat = flatten(files['main.loadmap'], o)
    if ('error' in flat) throw new Error(`${flat.error}: ${flat.diagnostics.map((d) => d.message).join('; ')}`)
    expect(flat.text).toContain('let same = (mode == "a") == flag')
    const one = compile(flat.text)
    expect(one.diagnostics).toEqual([])
    for (const params of [{}, { mode: 'b' }, { flag: false }, { mode: 'b', flag: false }]) {
      const [x, y] = [one, several].map((r) => r.definition!.model.evaluate({ load: 1, ...params }))
      expect(x!.components, JSON.stringify(params)).toEqual(y!.components)
    }
  })

  it('writes the comparison an input was given in parentheses where it is compared again', () => {
    const lib = [
      'loadmap 1.6',
      'library "L"',
      'node gate "Gate" {',
      '  input ok',
      '  input flag = true',
      '  demand: ok == flag ? 1 : 2',
      '  capacity: estimated(10, "req/s", "x")',
      '  over: "slow"',
      '}',
      '',
    ].join('\n')
    const model = [
      'loadmap 1.6',
      'import "./lib.loadmap" { gate }',
      'load "x" { max: 2 }',
      'param mode "Mode" { options: ["a", "b"]; default: "a" }',
      'flow f "f" { rate: 1; route: g; from: n }',
      'node n "N"',
      'node g "G" {',
      '  like: gate',
      '  with { ok: mode == "a" }',
      '}',
      'n -> g',
      '',
    ].join('\n')
    const o = { path: 'm.loadmap', files: { 'lib.loadmap': lib } }
    // the formula given for `ok` stands for the one name: no chain in the files, none in the copy
    const several = compile(model, o)
    expect(several.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const flat = flatten(model, o)
    if ('error' in flat) throw new Error(`${flat.error}: ${flat.diagnostics.map((d) => d.message).join('; ')}`)
    expect(flat.text).toContain('demand: (mode == "a") == true ? 1 : 2')
    const one = compile(flat.text)
    expect(one.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    for (const [mode, demand] of [
      ['a', 1],
      ['b', 2],
    ] as const)
      for (const r of [one, several])
        expect(r.definition!.model.evaluate({ load: 1, mode }).components.g!.demand).toBe(demand)
  })
})
