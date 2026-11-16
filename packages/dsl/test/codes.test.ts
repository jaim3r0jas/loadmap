import { readdirSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { compile, quickFixes } from '../src'
import { CODES } from '../src/diagnostics'
import { FIXED_CODES } from '../src/fixes'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const cache = read('../../editor/src/templates/cache.loadmap')
const checkout = read('../../../examples/checkout/checkout.loadmap')
const search = read('../../../examples/search/search.loadmap')

/** For each code a quick fix keys on, a text that reports it. */
const BROKEN: Record<string, string> = {
  'missing-property': cache.replace('  rate: 2_000 * load\n', ''),
  'bare-capacity': cache.replace(
    'capacity: estimated(50_000, "ops/s", "vendor sizing for this node")',
    'capacity: 50_000',
  ),
  'colon-before-block': cache.replace('clients -> api', 'clients -> api: { when: true }'),
  // an old name under a stamp that has the new one
  deprecated: checkout.replace('{ underTarget: 7 }', '{ target: 7 }'),
  'missing-edge': checkout.replace('\nkafka -> workers\n', '\n'),
  'reversed-edge': checkout.replace('\nkafka -> workers\n', '\nworkers -> kafka\n'),
  // a lost box under a stamp from before them
  'language-version': search.replace(/^loadmap [\d.]+/, 'loadmap 1'),
  'unseen-loss': search.replace(/\nnode limiterRejected[^\n]*/, '').replace(/\nlimiter -> limiterRejected/, ''),
}

it('every code a quick fix keys on is reported, and gets its fix', () => {
  expect(Object.keys(BROKEN).sort()).toEqual([...FIXED_CODES].sort())
  for (const code of FIXED_CODES) {
    const src = BROKEN[code]!
    const list = compile(src).diagnostics
    const i = list.findIndex((d) => d.code === code)
    expect(i, `nothing reports ${code}`).toBeGreaterThanOrEqual(0)
    expect(quickFixes(src, list)[i]!.length, `${code} has no fix`).toBeGreaterThan(0)
  }
})

it('every code is reported somewhere', () => {
  const dir = (path: string) => {
    const url = new URL(path, import.meta.url)
    return readdirSync(url)
      .filter((f) => f.endsWith('.ts') && f !== 'diagnostics.ts')
      .map((f) => readFileSync(new URL(f, url), 'utf8'))
      .join('\n')
  }
  const sources = dir('../src/') + dir('../../cli/src/')
  // as a diagnostic's code: the first argument of a report (or of a choice there), the last of a parser failure, a
  // field of a diagnostic built by hand
  const reported = (code: string) =>
    new RegExp(
      String.raw`(?:(?:error|warning)\(\s*(?:[\w.]+ \? '[a-z-]+' : )?|\? |\? '[a-z-]+' : |undefined, |code: )'${code}'`,
    ).test(sources)
  const unused = Object.keys(CODES).filter((code) => !reported(code))
  expect(unused).toEqual([])
})
