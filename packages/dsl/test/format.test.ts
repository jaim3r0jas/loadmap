import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compile, format } from '../src'
import { lex, Reporter } from '../src/internal'

const root = new URL('../../../', import.meta.url)
const read = (f: string) => readFileSync(new URL(f, root), 'utf8')

/** Every definition the repository holds: the files, the docs' fences, the full ones in docs/dsl.md and the README. */
const definitions: [string, string][] = [
  ...execSync('git ls-files "*.loadmap"', { cwd: root }).toString().trim().split('\n'),
  ...execSync('git ls-files "apps/docs/pages/*.md"', { cwd: root }).toString().trim().split('\n'),
  'docs/dsl.md',
  'README.md',
].flatMap((f): [string, string][] => {
  const src = read(f)
  if (f.endsWith('.loadmap')) return [[f, src]]
  const fences = [
    ...src.matchAll(/```loadmap[^\n]*\n([\s\S]*?)```/g),
    ...src.matchAll(/```\n(loadmap 1\n[\s\S]*?)```/g),
  ]
  return fences.map((m, i): [string, string] => [`${f} #${i + 1}`, m[1]!])
})

/** The tokens the parser reads, without the line breaks and ";" that only lay statements out. */
const meaning = (src: string) =>
  lex(src, new Reporter(src))
    .filter((t) => t.kind !== 'newline' && !(t.kind === 'punct' && t.text === ';'))
    .map((t) => t.text)

/** The same tokens on the same lines, with no indent and one to three spaces between any two of them. */
function scramble(src: string, seed: number) {
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  let out = ''
  let line = true
  for (const t of lex(src, new Reporter(src), 0, src.length, true)) {
    if (t.kind === 'newline') out += '\n'
    else out += (line ? '' : ' '.repeat(1 + Math.floor(rnd() * 3))) + t.text
    line = t.kind === 'newline'
  }
  return out
}

const fmt = (src: string) => {
  const r = format(src)
  expect(r.diagnostics).toEqual([])
  return r.text
}

describe('format', () => {
  it('finds the definitions it checks', () => {
    expect(definitions.filter(([f]) => f.endsWith('.loadmap')).length).toBeGreaterThanOrEqual(13)
    expect(definitions.length).toBeGreaterThan(16)
  })

  it.each(definitions)('%s is laid out the one way already', (_, src) => {
    expect(fmt(src)).toBe(src)
  })

  it.each(definitions)('%s comes back from any indent and spacing', (_, src) => {
    for (const seed of [1, 2, 3]) {
      const messy = scramble(src, seed)
      expect(meaning(messy)).toEqual(meaning(src))
      expect(fmt(messy)).toBe(src)
    }
  })

  it('indents, spaces operators and keeps numbers, texts and parentheses as written', () => {
    expect(
      fmt(
        [
          'node a "A"   {',
          'pass',
          '        demand:flows.x*(2+1)',
          ' capacity:measured( 10_000 ±20 % ,"req/s",  "a  test")',
          '   sub: `${ pods }  pods`',
          '}',
        ].join('\n'),
      ),
    ).toBe(
      [
        'node a "A" {',
        '  pass',
        '  demand: flows.x * (2 + 1)',
        '  capacity: measured(10_000 ± 20%, "req/s", "a  test")',
        '  sub: `${ pods }  pods`',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('tells signs, "%" and "?:" by what the parser read', () => {
    expect(fmt('x: - 2 * load\ny: a?b:c\nz: a %b\nw: !(a)\nv: estimated(1 +/- 5 %, "x")\nq: Math . min(1,2)')).toBe(
      'x: -2 * load\ny: a ? b : c\nz: a % b\nw: !(a)\nv: estimated(1 +/- 5%, "x")\nq: Math.min(1, 2)\n',
    )
    // in a row, "-2" is a second value, never a subtraction
    expect(fmt('fit f {\npoints a b {\n1 -2\n- 3 4\n}\n}')).toBe(
      'fit f {\n  points a b {\n    1 -2\n    -3 4\n  }\n}\n',
    )
  })

  it('keeps at most one blank line, none at the edges of a block or the file', () => {
    expect(fmt('\n\n\nloadmap 1\n\n\n\ntitle: "x"\nnode a {\n\n  pass\n\n\n  sub: "b"\n\n}\n\n\n')).toBe(
      'loadmap 1\n\ntitle: "x"\nnode a {\n  pass\n\n  sub: "b"\n}\n',
    )
  })

  it('keeps comments where they are', () => {
    expect(fmt('# top\nnode a { # the box\n      # its stage\n  pass    # passes\n}   # done\n#end')).toBe(
      '# top\nnode a { # the box\n  # its stage\n  pass # passes\n} # done\n#end\n',
    )
  })

  it('keeps one-line blocks on one line, and a statement a line elsewhere', () => {
    expect(fmt('load { max: 10;  default: 2; }\nscenario "A" {  }\nscenario "B" {\n}\ntitle: "x"; speed: 5')).toBe(
      'load { max: 10; default: 2 }\nscenario "A" {}\nscenario "B" {}\ntitle: "x"\nspeed: 5\n',
    )
    expect(fmt('node a { pass\n  sub: "x"; short: "y" }')).toBe('node a {\n  pass\n  sub: "x"\n  short: "y"\n}\n')
  })

  it('splits a one-line block that runs past 120 columns, the outermost first', () => {
    const long = `flow a { unit: "${'u'.repeat(60)}"; retry { times: 3; budget: 0.1 }; route: b -> c; from: d }`
    expect(fmt(long)).toBe(
      `flow a {\n  unit: "${'u'.repeat(60)}"\n  retry { times: 3; budget: 0.1 }\n  route: b -> c\n  from: d\n}\n`,
    )
    const fits = `step "${'s'.repeat(90)}" { load: 2 }`
    expect(fits.length).toBeLessThanOrEqual(120)
    expect(fmt(fits)).toBe(`${fits}\n`)
  })

  it('re-indents a formula wrapped inside parentheses', () => {
    expect(fmt('node a {\ncapacity: estimated(\n20_000,\n      "req/s"\n    )\n}')).toBe(
      'node a {\n  capacity: estimated(\n    20_000,\n    "req/s"\n  )\n}\n',
    )
  })

  it('leaves a text with a syntax error alone', () => {
    const src = 'node a {\n  demand: flows.x +\n}\n'
    const r = format(src)
    expect(r.ok).toBe(false)
    expect(r.text).toBe(src)
    expect(r.diagnostics[0]).toMatchObject({ severity: 'error', line: 2 })
    // the checker's errors are not the formatter's business
    expect(format('node a { demand: flows.nope }').ok).toBe(true)
  })

  it('never throws, and whatever it formats stays the same definition', () => {
    let seed = 7
    const rnd = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    let formatted = 0
    for (const [, src] of definitions.slice(0, 4))
      for (let k = 0; k < 150; k++) {
        const a = Math.floor(rnd() * src.length)
        const b = a + Math.floor(rnd() * 300)
        for (const piece of [src.slice(0, a) + src.slice(b), src.slice(a, b)]) {
          const r = format(piece)
          if (!r.ok) continue
          formatted++
          expect(meaning(r.text)).toEqual(meaning(piece))
          expect(format(r.text).text).toBe(r.text)
          expect(compile(r.text).diagnostics.map((d) => d.message)).toEqual(
            compile(piece).diagnostics.map((d) => d.message),
          )
        }
      }
    expect(formatted).toBeGreaterThan(50)
  })
})
