import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compile, format, LANGUAGE_VERSION, quickFixes } from '../src'
import { before, parseVersion } from '../src/versions'

const root = new URL('../../../', import.meta.url)

/** A small definition stamped `version`, with `extra` at the end; client -> api is its one hop. */
const def = (version: string, extra = '', edge = 'client -> api') => `loadmap ${version}
load { max: 10; default: 2 }
flow req { rate: 100 * load; route: api; from: client }
node client "Client"
node api "API" {
  pass
  demand: flows.req
  capacity: measured(400, "req/s", "load test")
  over: "requests fail"
}
${edge}
${extra}`

const found = (src: string) => compile(src).diagnostics.map((d) => ({ severity: d.severity, message: d.message }))

describe('the version line', () => {
  it('reads a major and a minor from the text', () => {
    expect(parseVersion('1')).toEqual([1, 0])
    expect(parseVersion('1.1')).toEqual([1, 1])
    expect(parseVersion('1.10')).toEqual([1, 10])
    for (const bad of ['1.05', '01', '1.1.0', '1.', '1e1', '1.1ms']) expect(parseVersion(bad)).toBeUndefined()
    expect(before([1, 9], [1, 10])).toBe(true)
    expect(before([1, 10], [2, 0])).toBe(true)
    expect(before([1, 1], [1, 1])).toBe(false)
  })

  it('reads every version up to its own, and says "update" for a later one', () => {
    expect(LANGUAGE_VERSION).toBe('1.3')
    for (const v of ['1', '1.0', '1.1', '1.2', '1.3']) expect(found(def(v)), v).toEqual([])
    for (const v of ['1.4', '1.10', '2'])
      expect(compile(def(v)).diagnostics).toMatchObject([
        {
          code: 'language-version',
          message: `this definition is written in language version ${v}; this loadmap reads version 1.3`,
          hint: 'update @loadmap/dsl',
        },
      ])
    for (const v of ['0', '1.05'])
      expect(found(def(v))).toEqual([
        { severity: 'error', message: `there is no language version ${v}; the first is 1` },
      ])
    // 0.32 read any spelling of the number 1
    for (const v of ['1.00', '1e0']) expect(found(def(v)), v).toEqual([])
  })

  it('says only "update" for a later version, not every statement it does not know', () => {
    expect(found(def('1.4', 'widget w "W"\nnode x { pass; newProp: 1 }'))).toEqual([
      {
        severity: 'error',
        message: 'this definition is written in language version 1.4; this loadmap reads version 1.3',
      },
    ])
  })
})

describe('what a version added', () => {
  it('needs the version that added it on the first line, with a fix that writes it', () => {
    const cases: [string, string][] = [
      ['node gone "Gone" { lost }\napi -> gone', '"lost" is from loadmap 1.1; this definition says loadmap 1'],
      [
        'preset "S" { load: 3× }',
        'a number with a unit (20ms, 80%, 7×) is from loadmap 1.1; this definition says loadmap 1',
      ],
    ]
    for (const [extra, message] of cases) {
      const src = def('1', extra)
      const list = compile(src).diagnostics
      const i = list.findIndex((d) => d.code === 'language-version')
      expect(list[i], extra).toMatchObject({
        severity: 'error',
        message,
        hint: 'write "loadmap 1.1" on the first line',
      })
      const [fix] = quickFixes(src, list)[i]!
      expect(fix).toMatchObject({ title: 'Write "loadmap 1.1"', changes: [{ insert: '1.1' }] })
      expect(found(def('1.1', extra))).not.toContainEqual(expect.objectContaining({ severity: 'error' }))
    }
    const as = def('1').replace('demand: flows.req', 'demand: flows.req * 0.01 as "cores"')
    expect(found(as)).toContainEqual({
      severity: 'error',
      message: '"as" after a demand is from loadmap 1.1; this definition says loadmap 1',
    })
  })

  it('names each thing once, at its first use', () => {
    const src = def('1', 'preset "S" { load: 3× }\npreset "T" { load: 4× }')
    expect(compile(src).diagnostics.filter((d) => d.code === 'language-version')).toHaveLength(1)
  })

  it('a quick fix that adds something newer raises the first line with it', () => {
    // a limiter whose losses no lost box counts: the warning's fix adds one, which is 1.1
    const src = def('1').replace('  pass\n', '  limit\n')
    const list = compile(src).diagnostics
    const i = list.findIndex((d) => d.code === 'unseen-loss')
    expect(i).toBeGreaterThanOrEqual(0)
    const [fix] = quickFixes(src, list)[i]!
    expect(fix!.changes[0]).toMatchObject({ from: 'loadmap '.length, insert: '1.1' })
    let after = src
    for (const c of [...fix!.changes].sort((a, b) => b.from - a.from))
      after = after.slice(0, c.from) + c.insert + after.slice(c.to)
    expect(found(after)).not.toContainEqual(expect.objectContaining({ severity: 'error' }))
  })

  it('counts "± 30%" as 1.0: it is no number with a unit', () => {
    expect(found(def('1').replace('measured(400,', 'measured(400 ± 30%,'))).toEqual([])
  })
})

describe('a check a version made strict', () => {
  it('a hop without its edge is a warning before loadmap 1.1, and the file still draws', () => {
    for (const v of ['1', '1.0']) {
      const r = compile(def(v, '', ''))
      expect(r.diagnostics).toMatchObject([
        {
          severity: 'warning',
          code: 'missing-edge',
          message: '"req" goes from "client" to "api", and no edge joins them (an error from loadmap 1.1)',
          hint: 'draw client -> api',
        },
      ])
      expect(r.ok).toBe(true)
      expect(r.definition?.view.def.edges).toEqual([])
      // the quick fix keys on the code: the same for the warning
      expect(quickFixes(def(v, '', ''), r.diagnostics)[0]![0]).toMatchObject({ title: 'Add the edge client -> api' })
    }
    expect(compile(def('1', '', 'api -> client')).diagnostics).toMatchObject([
      { severity: 'warning', code: 'reversed-edge' },
    ])
  })

  it('and an error from loadmap 1.1', () => {
    const r = compile(def('1.1', '', ''))
    expect(r.diagnostics).toMatchObject([
      { severity: 'error', code: 'missing-edge', message: '"req" goes from "client" to "api", and no edge joins them' },
    ])
    expect(r.definition).toBeUndefined()
  })
})

describe('format', () => {
  it('raises the version line to what the definition uses, and never lowers it', () => {
    const lost = 'node gone "Gone" { lost }\napi -> gone\n'
    expect(format(def('1', lost)).text.split('\n')[0]).toBe('loadmap 1.1')
    expect(format(def('1.0', 'preset "S" { load: 3× }\n')).text.split('\n')[0]).toBe('loadmap 1.1')
    expect(format(def('1', '')).text.split('\n')[0]).toBe('loadmap 1')
    expect(format(def('1.1', '')).text.split('\n')[0]).toBe('loadmap 1.1')
    // a later version than this loadmap reads, or no version, is the compiler's to name, not fmt's to change
    expect(format(def('1.10', lost)).text.split('\n')[0]).toBe('loadmap 1.10')
    expect(format(def('0', lost)).text.split('\n')[0]).toBe('loadmap 0')
  })
})

it('every definition in the repository says the newest version, but the released ones', () => {
  const files = execSync('git ls-files "*.loadmap"', { cwd: root })
    .toString()
    .trim()
    .split('\n')
    .filter((f) => !f.startsWith('packages/dsl/test/corpus/'))
  expect(files.length).toBeGreaterThanOrEqual(13)
  for (const f of files)
    expect(readFileSync(new URL(f, root), 'utf8').split('\n')[0], f).toBe(`loadmap ${LANGUAGE_VERSION}`)
})
