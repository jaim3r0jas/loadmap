import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compile, formatDiagnostic } from '../src'
import { lex, parse, Reporter } from '../src/internal'

const examples = ['checkout/checkout.loadmap', 'alerts/alerts.loadmap'].map((f) =>
  readFileSync(new URL(`../../../examples/${f}`, import.meta.url), 'utf8'),
)

/** The line and column where `needle` starts, as a diagnostic reports them. */
function at(src: string, needle: string) {
  const i = src.indexOf(needle)
  if (i < 0) throw new Error(`no "${needle}"`)
  const before = src.slice(0, i).split('\n')
  return { line: before.length, column: before.at(-1)!.length + 1 }
}

describe('lex', () => {
  it('reads numbers, texts, templates and comments with their places', () => {
    const src = 'cap: 20_000 # a comment\nlabel: "a \\"b\\"" `x ${compact(flows.a)} y`'
    const toks = lex(src, new Reporter(src))
    expect(toks.map((t) => t.kind)).toEqual([
      'ident',
      'punct',
      'number',
      'newline',
      'ident',
      'punct',
      'string',
      'template',
      'eof',
    ])
    expect(toks[2]!.value).toBe(20000)
    expect(toks[6]!.value).toBe('a "b"')
    const tpl = toks[7]!
    expect(tpl.quasis).toEqual(['x ', ' y'])
    expect(src.slice(tpl.parts![0]!.from, tpl.parts![0]!.to)).toBe('compact(flows.a)')
  })

  it('lets a formula wrap inside parentheses', () => {
    const src = 'rate: (1 +\n  2)\nnext: 1'
    const kinds = lex(src, new Reporter(src)).map((t) => t.kind)
    expect(kinds.filter((k) => k === 'newline')).toHaveLength(1)
  })
})

describe('parse', () => {
  it('reads every statement form', () => {
    const src = [
      'loadmap 1',
      'let x = a ? 1 : 2',
      'node api "API" `${pods} pods` { pass "the api"; shape: cylinder }',
      'a -> b -> c',
      'a -> b: "label" { when: on }',
      'points rate cores {\n  1 2\n  -3 4.5\n}',
    ].join('\n')
    const { doc, report } = parse(src)
    expect(report.list).toEqual([])
    const [header, let_, node, chain, labelled, points] = doc.body
    expect(header).toMatchObject({ kind: 'decl', keyword: { name: 'loadmap' }, args: [{ t: 'num', value: 1 }] })
    expect(let_).toMatchObject({ kind: 'decl', args: [{ t: 'id', name: 'x' }], init: { t: 'cond' } })
    expect(node).toMatchObject({
      kind: 'decl',
      args: [{ t: 'id', name: 'api' }, { t: 'str', value: 'API' }, { t: 'tpl' }],
      body: [
        { kind: 'decl', keyword: { name: 'pass' } },
        { kind: 'prop', key: { name: 'shape' } },
      ],
    })
    expect(chain).toMatchObject({ kind: 'edge', chain: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] })
    expect(labelled).toMatchObject({ kind: 'edge', value: { t: 'str', value: 'label' }, body: [{ kind: 'prop' }] })
    expect(points).toMatchObject({ kind: 'decl', body: [{ kind: 'row' }, { kind: 'row' }] })
  })

  it('reads a route as a chain', () => {
    const { doc } = parse('route: gateway -> topic -> workers')
    expect(doc.body[0]).toMatchObject({
      kind: 'prop',
      chain: [{ name: 'gateway' }, { name: 'topic' }, { name: 'workers' }],
    })
  })

  it('follows the precedence of TypeScript', () => {
    const { doc } = parse('x: 1 + 2 * 3 > 6 && !b || c ? d : e')
    expect(doc.body[0]).toMatchObject({
      value: {
        t: 'cond',
        test: { t: 'bin', op: '||', left: { t: 'bin', op: '&&', left: { op: '>', left: { op: '+' } } } },
      },
    })
  })

  it('reports every error with its line and column, and goes on', () => {
    const src = ['loadmap 1', 'flow a { rate: 1 + }', 'let b = = 1', 'c -> : 1', 'node ok "OK"'].join('\n')
    const { doc, report } = parse(src)
    expect(report.list.map((d) => [d.line, d.column])).toEqual([
      [2, 20],
      [3, 9],
      [4, 6],
    ])
    expect(doc.body.at(-1)).toMatchObject({ kind: 'decl', args: [{ name: 'ok' }, { value: 'OK' }] })
  })

  it('reports an unclosed block where it opens', () => {
    const src = 'loadmap 1\nnode a "A" {\n  pass\n'
    const { report } = parse(src)
    expect(report.list).toMatchObject([{ line: 2, column: 12, message: 'this "{" of "node" is never closed' }])
  })

  it('refuses formulas nested too deep instead of overflowing the stack', () => {
    const { report } = parse(`x: ${'('.repeat(5000)}1${')'.repeat(5000)}`)
    expect(report.list[0]!.message).toContain('nested more than 64 deep')
  })

  it('refuses blocks and templates nested too deep instead of overflowing the stack', () => {
    const blocks = compile(`loadmap 1\n${'a{'.repeat(5000)}`)
    expect(blocks.diagnostics.map((d) => d.message)).toContain('blocks are nested more than 64 deep')
    const templates = compile(`loadmap 1\nlet x = ${'`${'.repeat(3000)}1${'}`'.repeat(3000)}`)
    expect(templates.diagnostics.map((d) => d.message)).toContain('templates are nested more than 16 deep')
  })

  it('reports a template part that is never closed', () => {
    const src = 'loadmap 1\ntitle: `a ${load\n} b`'
    expect(compile(src).diagnostics.find((d) => d.message.includes('${'))).toMatchObject({
      message: 'this "${" has no closing "}"',
      line: 2,
      column: 11,
    })
  })

  it('reads an exponent only with its digits', () => {
    const src = 'x: 1e+'
    const toks = lex(src, new Reporter(src))
    expect(toks.map((t) => t.text)).toEqual(['x', ':', '1', 'e', '+', ''])
    expect(lex('2.5e-3', new Reporter('2.5e-3'))[0]!.value).toBe(0.0025)
  })

  it('stays fast on a page of garbage, listing at most 200 problems', () => {
    // this thread's CPU time, not the wall clock or the process: other test files run beside this one
    const t0 = process.threadCpuUsage()
    const r = compile('@'.repeat(60_000))
    const used = process.threadCpuUsage(t0)
    expect((used.user + used.system) / 1000).toBeLessThan(1000)
    expect(r.diagnostics).toHaveLength(201)
    expect(r.diagnostics.at(-1)!.message).toBe('more than 200 problems; fix these first')
  })

  it('never throws, whatever slice of a definition it gets', () => {
    let seed = 11
    const rnd = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    for (const src of examples)
      for (let k = 0; k < 300; k++) {
        const a = Math.floor(rnd() * src.length)
        const b = a + Math.floor(rnd() * 400)
        const cut = src.slice(0, a) + src.slice(b)
        for (const piece of [cut, src.slice(a, b)])
          for (const d of compile(piece).diagnostics) expect(d.message).not.toContain('internal error')
      }
  })
})

describe('formatDiagnostic', () => {
  it('shows the line and marks the place', () => {
    const src = 'loadmap 1\nload { max: 10 }\nflow a { rate: flows.b; route: x; from: y }\n'
    const d = compile(src).diagnostics.find((x) => x.message.includes('unknown flow'))!
    expect(d).toMatchObject(at(src, 'b; route'))
    expect(formatDiagnostic(d, src, 'a.loadmap')).toBe(
      [
        'a.loadmap:3:22 error: unknown flow "b"',
        '  3 | flow a { rate: flows.b; route: x; from: y }',
        '    |                      ^ did you mean "a"?',
      ].join('\n'),
    )
  })
})

export { at }
