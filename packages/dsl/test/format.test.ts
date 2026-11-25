import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { compile, format, loadCatalog } from '../src'
import { applied, intoView, lex, parse, Reporter } from '../src/internal'

const root = new URL('../../../', import.meta.url)
const read = (f: string) => readFileSync(new URL(f, root), 'utf8')

/** Every definition the repository holds: the files, the docs' fences, the full ones in docs/dsl.md and the README. */
const definitions: [string, string][] = [
  // but the released ones, kept as they shipped (corpus.test.ts)
  ...execSync('git ls-files "*.loadmap" ":!packages/dsl/test/corpus/"', { cwd: root }).toString().trim().split('\n'),
  ...execSync('git ls-files "apps/docs/pages/*.md"', { cwd: root }).toString().trim().split('\n'),
  'docs/dsl.md',
  'README.md',
].flatMap((f): [string, string][] => {
  const src = read(f)
  if (f.endsWith('.loadmap')) return [[f, src]]
  // an @include is lines of a file that is already in the list
  const fences = [...src.matchAll(/```loadmap[^\n]*\n([\s\S]*?)```/g)].filter((m) => !m[1]!.startsWith('@include('))
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

// docs/every-statement.loadmap has a published statement
beforeAll(() => loadCatalog())

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
          '   describe: `${ pods }  pods`',
          '}',
        ].join('\n'),
      ),
    ).toBe(
      [
        'node a "A" {',
        '  pass',
        '  demand: flows.x * (2 + 1)',
        '  capacity: measured(10_000 +- 20%, "req/s", "a  test")',
        '  describe: `${ pods }  pods`',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('renames the direction from its old name, layout, and leaves a layout of the boxes alone', () => {
    const old =
      'loadmap 1.4\nlayout: down\nlayout: "right"\nlayout: stable\nnode layout "Layout" { sub: "layout: down" }\n'
    expect(fmt(old)).toBe(
      'loadmap 1.4\ndirection: down\ndirection: "right"\nlayout: stable\nnode layout "Layout" { sub: "layout: down" }\n',
    )
    // beside a direction, the old line sets nothing: renamed, it would set the direction twice
    expect(fmt('loadmap 1.4\ndirection: right\nlayout: down\n')).toBe('loadmap 1.4\ndirection: right\nlayout: down\n')
    // from 1.5 they live in view { … }: the old name goes there as direction, and beside one, where it sets nothing, goes
    expect(
      fmt('loadmap 1.5\nlayout: down\nlayout: stable\nrows: 2\nnode layout "Layout" { sub: "layout: down" }\n'),
    ).toBe('loadmap 1.5\nview { direction: down; layout: stable; rows: 2 }\nnode layout "Layout" "layout: down"\n')
    expect(fmt('loadmap 1.5\ndirection: right\nlayout: down\n')).toBe('loadmap 1.5\nview { direction: right }\n')
    expect(fmt('loadmap 1.5\nlayout: right\nview { direction: down }\n')).toBe(
      'loadmap 1.5\nview { direction: down }\n',
    )
  })

  it("renames a property's old name where the loadmap line has the new one, not beside it", () => {
    expect(fmt('loadmap 1.1\nexpect { target: 3; full: 9 }\n')).toBe(
      'loadmap 1.1\nexpect { underTarget: 3; notFull: 9 }\n',
    )
    // set beside its new name, renamed it would be set twice
    expect(fmt('loadmap 1.1\nexpect { target: 3; underTarget: 4 }\n')).toBe(
      'loadmap 1.1\nexpect { target: 3; underTarget: 4 }\n',
    )
    // 1.0 has only the old name: raising the line for it could make the strict checks of 1.1 errors
    expect(fmt('loadmap 1\nexpect { target: 3 }\n')).toBe('loadmap 1\nexpect { target: 3 }\n')
    // thresholds keep theirs: a target there is a utilization
    expect(fmt('loadmap 1.1\nthresholds { target: 0.6; full: 1 }\n')).toBe(
      'loadmap 1.1\nthresholds { target: 0.6; full: 1 }\n',
    )
  })

  it('tells signs, "%" and "?:" by what the parser read', () => {
    // before 1.5 a "%" between two values is the remainder, and one glued to a number before a value too
    const old =
      'loadmap 1.4\nx: - 2 * load\ny: a?b:c\nz: a %b\nw: !(a)\nv: estimated(1 +/- 5 %, "x")\nq: Math . min(1,2)'
    expect(fmt(old)).toBe(
      'loadmap 1.4\nx: -2 * load\ny: a ? b : c\nz: a % b\nw: !(a)\nv: estimated(1 +/- 5%, "x")\nq: Math.min(1, 2)\n',
    )
    expect(fmt('loadmap 1.4\na: 20ms*b\nc: estimated(1 ± 30%,"x")\nd: 10%3\ne: 80%  -  b\nf: 7×')).toBe(
      'loadmap 1.4\na: 20ms * b\nc: estimated(1 ± 30%, "x")\nd: 10 % 3\ne: 80% - b\nf: 7×\n',
    )
    // from 1.6 a capacity's ± is written "+-"; before, "+-" is a plus and a minus, and spaced so
    expect(fmt('loadmap 1.6\nc: estimated(1 ± 30%,"x")\nd: measured(2+/-1,"x")\ne: estimated(3 +-5%,"x")')).toBe(
      'loadmap 1.6\nc: estimated(1 +- 30%, "x")\nd: measured(2 +- 1, "x")\ne: estimated(3 +- 5%, "x")\n',
    )
    expect(fmt('loadmap 1.5\nx: a +- b\nc: estimated(1 ± 30%, "x")\n')).toBe(
      'loadmap 1.5\nx: a + -b\nc: estimated(1 ± 30%, "x")\n',
    )
    // a plus before a minus, both of them signs, stays two signs: glued they would be the ± of 1.6
    expect(fmt('loadmap 1.6\nx: + -a\ny: +  - a\nz: - +a\n')).toBe('loadmap 1.6\nx: + -a\ny: + -a\nz: -+a\n')
    // from 1.5 a unit is part of its number, a "%" one too, and the remainder is mod(a, b)
    expect(fmt('loadmap 1.5\nz: a %b\nd: 30%+1\ne: (a % b) % c\nf: (a * (b)) % (c)\ng: (a) * (b) % c\n')).toBe(
      'loadmap 1.5\nz: mod(a, b)\nd: 30% + 1\ne: mod(mod(a, b), c)\nf: mod(a * (b), c)\ng: mod((a) * (b), c)\n',
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

  it('keeps a comment after a ";" on its statement\'s line', () => {
    expect(fmt('title: "x"; # note\nnode a {\n  pass; # passes\n}')).toBe(
      'title: "x" # note\nnode a {\n  pass # passes\n}\n',
    )
  })

  it('keeps one-line blocks on one line, and a statement a line elsewhere', () => {
    expect(fmt('load { max: 10;  default: 2; }\nscenario "A" {  }\nscenario "B" {\n}\ntitle: "x"; speed: 5')).toBe(
      'load { max: 10; default: 2 }\nscenario "A" {}\nscenario "B" {}\nview { speed: 5 }\ntitle: "x"\n',
    )
    expect(fmt('node a { pass\n  describe: "x"; short: "y" }')).toBe(
      'node a {\n  pass\n  describe: "x"\n  short: "y"\n}\n',
    )
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

  it('breaks a text past 120 columns at a space, piece under piece, and puts one that fits back on a line', () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')
    const long = `loadmap 1.2\nstep "${words(30)}" {\n  load: 2\n}\n`
    const out = fmt(long)
    const lines = out.split('\n')
    expect(lines.every((l) => l.length <= 120)).toBe(true)
    // each piece ends with its space, the next starts under the first quote, and the block opens after the last
    expect(lines[1]).toMatch(/^step "word0 .* "$/)
    expect(lines[2]).toMatch(/^ {5}"word\d+ .*word29" \{$/)
    expect(fmt(out)).toBe(out)
    // one text still: the same value, the same tokens
    expect(meaning(out)).toEqual(meaning(long))
    const label = (src: string) => (parse(src).doc.body[1] as { args: { value: string }[] }).args[0]!.value
    expect(label(out)).toBe(words(30))
    // written in pieces though it fits: one line again
    expect(fmt('loadmap 1.2\nstep "a short "\n  "text" { load: 2 }\n')).toBe(
      'loadmap 1.2\nstep "a short text" { load: 2 }\n',
    )
    // a property's text, in a block
    const prop = fmt(`loadmap 1.2\nnode a {\n  over: "${words(30)}"\n}\n`).split('\n')
    expect(prop[2]).toMatch(/^ {2}over: "word0 .* "$/)
    expect(prop[3]).toMatch(/^ {8}"word\d+ .*word29"$/)
    // a text inside parentheses, a template and a text without a space stay as written
    for (const kept of [
      `loadmap 1.2\nnode a {\n  capacity: estimated(1, "x/s", "${words(30)}")\n}\n`,
      `loadmap 1.2\nstep \`${words(30)}\` {\n  load: 2\n}\n`,
      `loadmap 1.2\nstep "${'w'.repeat(150)}" {\n  load: 2\n}\n`,
    ])
      expect(fmt(kept)).toBe(kept)
    // nor one on a line of its own inside parentheses or brackets opened above it: no line break is a token there
    for (const kept of [
      `loadmap 1.2\nnode a {\n  capacity: estimated(\n    1,\n    "x/s",\n    "${words(30)}"\n  )\n}\n`,
      `loadmap 1.2\nparam p {\n  options: [\n    "${words(30)}",\n    "b"\n  ]\n}\n`,
    ])
      expect(fmt(kept)).toBe(kept)
    // a text continued over lines is from 1.2: an older stamp keeps its long line
    const old = long.replace('loadmap 1.2', 'loadmap 1.1')
    expect(fmt(old)).toBe(old)
  })

  it('writes what 1.5 left one spelling of, where the stamp says 1.5', () => {
    const pools = [
      'loadmap 1.5',
      'pool a "A" {',
      '  workers "the work" { pods: 2; perPod: 8 }',
      '  over: "lag"',
      '}',
      'pool b { workers { perPod: 4; autoscale { min: 1; max: 3; target: 0.7 } } }',
      'pool c {\n  workers {\n    pods: 2\n    perPod: 8\n  }\n}',
      'pool d { workers w { pods: 2; perPod: 8 } }',
      '',
    ].join('\n')
    expect(fmt(pools)).toBe(
      [
        'loadmap 1.5',
        'pool a "A" {',
        '  stageLabel: "the work"',
        '  pods: 2',
        '  perPod: 8',
        '  over: "lag"',
        '}',
        'pool b { perPod: 4; autoscale { min: 1; max: 3; target: 0.7 } }',
        'pool c {\n  pods: 2\n  perPod: 8\n}',
        // a stage with an id of its own: routes name it, and the pool has one id
        'pool d { workers w { pods: 2; perPod: 8 } }',
        '',
      ].join('\n'),
    )
    const lines =
      'node n { sub: "x" }\nnode m "M" { sub: `${p} pods`; pass }\na -> b { label: "x" }\nc -> d {\n  label: "y"\n  when: z\n}\n'
    expect(fmt(`loadmap 1.5\n${lines}`)).toBe(
      'loadmap 1.5\nnode n "n" "x"\nnode m "M" `${p} pods` { pass }\na -> b: "x"\nc -> d: "y" {\n  when: z\n}\n',
    )
    // an older stamp keeps them: its readers read them so
    const old = 'loadmap 1.4\npool a { workers { pods: 2; perPod: 8 } }\nz: a % b\nnode n { sub: "x" }\n'
    expect(fmt(old)).toBe(old)
    // === and derived.x read the same in every version: rewritten in each
    expect(fmt('loadmap 1.4\nf: a === b\ng: derived.x !== 2\n')).toBe('loadmap 1.4\nf: a == b\ng: x != 2\n')
  })

  it('moves the view settings written at the top into view { … }, where the stamp has it', () => {
    expect(fmt('loadmap 1.2\ntitle: "x"\nspeed: 5\nlayout: stable\ngrid: false\n')).toBe(
      'loadmap 1.2\ntitle: "x"\nview { speed: 5; grid: false }\nlayout: stable\n',
    )
    // into the block the definition has, a comment above a setting with it, and a setting beside others
    expect(fmt('loadmap 1.2\nview { lanes: striped }\ntitle: "x"; speed: 5\n# no dots\ngrid: false\n')).toBe(
      'loadmap 1.2\nview {\n  lanes: striped\n  speed: 5\n  # no dots\n  grid: false\n}\ntitle: "x"\n',
    )
    // the comment under the loadmap line is the file's
    expect(fmt('loadmap 1.2\n# A model.\nspeed: 5\ntitle: "x"\n')).toBe(
      'loadmap 1.2\n# A model.\nview { speed: 5 }\ntitle: "x"\n',
    )
    // two settings on one line, and the statement after them whole
    expect(fmt('loadmap 1.2\nspeed: 10; grid: false\nflow orders { rate: 1 }\n')).toBe(
      'loadmap 1.2\nview { speed: 10; grid: false }\nflow orders { rate: 1 }\n',
    )
    expect(fmt('loadmap 1.2\ntitle: "x"; speed: 10; grid: false; layout: stable\n')).toBe(
      'loadmap 1.2\nview { speed: 10; grid: false }\ntitle: "x"\nlayout: stable\n',
    )
    // set in both: the checker's to say, nothing moves
    const twice = 'loadmap 1.2\nview { speed: 5 }\nspeed: 6\n'
    expect(fmt(twice)).toBe(twice)
    // an older stamp keeps them where its readers look
    const old = 'loadmap 1.1\ntitle: "x"\nspeed: 5\n'
    expect(fmt(old)).toBe(old)
    const moved = fmt('loadmap 1.2\nspeed: 5\ngrid: false\n')
    expect(fmt(moved)).toBe(moved)
    // from 1.5 the grid is no view setting: moved, it would be an error there too
    expect(fmt('loadmap 1.5\nspeed: 5\ngrid: false\n')).toBe('loadmap 1.5\nview { speed: 5 }\ngrid: false\n')
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

  // every-statement compiles twice over for each slice, and its breaker asks its flow's failures at each load the
  // ranking scans. It holds every statement there is, so it grows with the language: two minutes, not the default 30 s
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
          // the one thing it moves: a view setting at the top, into view { … }
          expect(meaning(r.text)).toEqual(meaning(applied(piece, intoView(piece, parse(piece).doc.body))))
          expect(format(r.text).text).toBe(r.text)
          expect(compile(r.text).diagnostics.map((d) => d.message)).toEqual(
            compile(piece).diagnostics.map((d) => d.message),
          )
        }
      }
    expect(formatted).toBeGreaterThan(50)
  }, 120_000)
})
