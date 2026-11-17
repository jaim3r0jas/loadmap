import { readFileSync, writeFileSync } from 'node:fs'
import { beforeAll, expect, it } from 'vitest'
import { compile, formatDiagnostic, loadCatalog } from '../src'
import { codeReference, parse, reference, SCHEMA, type Stmt } from '../src/internal'

const file = new URL('../../../docs/dsl.md', import.meta.url)
const START = '<!-- reference: written by reference() in packages/dsl; UPDATE_DOCS=1 pnpm test:node rewrites it -->'
const END = '<!-- end of reference -->'

/** The multi-file example: a model, its part, the library it imports and a variant of it, by their paths. */
const MULTI = ['shop.loadmap', 'shop.story.loadmap', 'platform.loadmap', 'shop.big.loadmap'].map(
  (f) => `docs/multi-file/${f}`,
)
const multi = Object.fromEntries(MULTI.map((f) => [f, readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8')]))

beforeAll(() => loadCatalog())

it('docs/dsl.md holds the reference the schema writes', () => {
  const doc = readFileSync(file, 'utf8')
  const [head, rest] = doc.split(START)
  const tail = rest?.split(END)[1]
  expect(head != null && tail != null, 'docs/dsl.md lost its reference markers').toBe(true)
  const fresh = `${head}${START}\n\n${reference()}\n${END}${tail}`
  if (process.env.UPDATE_DOCS) writeFileSync(file, fresh)
  expect(doc, 'run UPDATE_DOCS=1 pnpm test:node to rewrite it').toBe(fresh)
})

it('docs/dsl.md lists every diagnostic code', () => {
  const start = '<!-- codes: written from CODES in packages/dsl; UPDATE_DOCS=1 pnpm test:node rewrites it -->'
  const doc = readFileSync(file, 'utf8')
  const [head, rest] = doc.split(start)
  const tail = rest?.split('<!-- end of codes -->')[1]
  expect(head != null && tail != null, 'docs/dsl.md lost its codes markers').toBe(true)
  const fresh = `${head}${start}\n\n${codeReference()}\n<!-- end of codes -->${tail}`
  if (process.env.UPDATE_DOCS) writeFileSync(file, fresh)
  expect(doc, 'run UPDATE_DOCS=1 pnpm test:node to rewrite it').toBe(fresh)
})

it('every definition in docs/dsl.md and the README compiles', () => {
  const doc = readFileSync(file, 'utf8') + readFileSync(new URL('../../../README.md', import.meta.url), 'utf8')
  const blocks = [...doc.matchAll(/```loadmap\n(loadmap \d+(?:\.\d+)?\n[\s\S]*?)```/g)]
    .map((m) => m[1]!)
    .filter((b) => !/^loadmap [\d.]+$/.test(b.trim()))
  expect(blocks.length).toBeGreaterThan(1)
  for (const b of blocks) expect(compile(b).diagnostics).toEqual([])
})

it('shows the error the checker gives', () => {
  const src = readFileSync(new URL('../../../examples/checkout/checkout.loadmap', import.meta.url), 'utf8').replace(
    'demand: flows.orders + flows.events',
    'demand: flows.order + flows.events',
  )
  const d = compile(src).diagnostics[0]!
  expect(readFileSync(file, 'utf8')).toContain(formatDiagnostic(d, src, 'checkout.loadmap'))
})

it('docs/multi-file compiles clean from each of its files: the model, its part, the library alone and the variant', () => {
  const of = (f: string) => compile(multi[`docs/multi-file/${f}`]!, { path: `docs/multi-file/${f}`, files: multi })
  const model = of('shop.loadmap')
  expect(model.diagnostics).toEqual([])
  expect(model.role).toBe('model')
  expect(model.files).toEqual(MULTI.slice(0, 3))
  expect(model.expectations.map((e) => e.result.ok)).toEqual([true])
  // the subsystem's stages under its id, the database under its own
  expect(model.definition!.model.stageIds).toEqual(['gateway', 'orderLine.topic', 'orderLine.consumers', 'db'])
  expect(model.definition!.model.componentIds).toEqual(['gateway', 'orderLine.consumers', 'db'])
  // a part is read through its model: the same model, and its own lines are the text that was asked about
  const part = of('shop.story.loadmap')
  expect(part.diagnostics).toEqual([])
  expect(part.role).toBe('part')
  expect(part.definition!.model.story.length).toBe(3)
  const library = of('platform.loadmap')
  expect(library.diagnostics).toEqual([])
  expect(library.role).toBe('library')
  const variant = of('shop.big.loadmap')
  expect(variant.diagnostics).toEqual([])
  expect(variant.role).toBe('variant')
  expect(variant.definition!.model.title).toBe('A shop, on the big cluster')
  expect(variant.definition!.model.defaults().pods).toBe(6)
  // alone, the model says which file it lacks, where it names it
  expect(compile(multi['docs/multi-file/shop.loadmap']!).diagnostics.map((d) => d.code)).toContain('missing-file')
})

it('docs/every-statement.loadmap and docs/multi-file hold every statement and top-level property, edges with and without a block, and compile clean', () => {
  const src = readFileSync(new URL('../../../docs/every-statement.loadmap', import.meta.url), 'utf8')
  const r = compile(src)
  expect(r.diagnostics).toEqual([])
  // its promises hold, as `loadmap check` would say
  expect(r.expectations.map((e) => e.result.ok)).toEqual([true, true, true])
  const seen = new Set<string>()
  const walk = (body: Stmt[]) => {
    for (const s of body) {
      if (s.kind === 'decl') seen.add(s.keyword.name)
      if (s.kind === 'edge') seen.add(s.body ? 'a -> b { … }' : 'a -> b')
      if (s.kind === 'prop') seen.add(`${s.key.name}:`)
      if ('body' in s && s.body) walk(s.body)
    }
  }
  walk(parse(src).doc.body)
  // what a single file cannot hold (a part, a library, a variant) is in the multi-file example
  for (const text of Object.values(multi)) walk(parse(text).doc.body)
  const top = Object.keys(SCHEMA['']!.props).map((k) => `${k}:`)
  const want = [...Object.keys(SCHEMA).filter((k) => k), ...top, 'a -> b', 'a -> b { … }']
  expect(want.filter((k) => !seen.has(k))).toEqual([])
})
