import { readFileSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { compile, formatDiagnostic } from '../src'
import { reference } from '../src/internal'

const file = new URL('../../../docs/dsl.md', import.meta.url)
const START = '<!-- reference: written by reference() in packages/dsl; UPDATE_DOCS=1 pnpm test:node rewrites it -->'
const END = '<!-- end of reference -->'

it('docs/dsl.md holds the reference the schema writes', () => {
  const doc = readFileSync(file, 'utf8')
  const [head, rest] = doc.split(START)
  const tail = rest?.split(END)[1]
  expect(head != null && tail != null, 'docs/dsl.md lost its reference markers').toBe(true)
  const fresh = `${head}${START}\n\n${reference()}\n${END}${tail}`
  if (process.env.UPDATE_DOCS) writeFileSync(file, fresh)
  expect(doc, 'run UPDATE_DOCS=1 pnpm test:node to rewrite it').toBe(fresh)
})

it('every definition in docs/dsl.md and the README compiles', () => {
  const doc = readFileSync(file, 'utf8') + readFileSync(new URL('../../../README.md', import.meta.url), 'utf8')
  const blocks = [...doc.matchAll(/```\n(loadmap 1\n[\s\S]*?)```/g)]
    .map((m) => m[1]!)
    .filter((b) => b.trim() !== 'loadmap 1')
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
