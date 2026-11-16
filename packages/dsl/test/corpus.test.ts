import { readdirSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { compile, loadCatalog } from '../src'

/**
 * Definitions as released, one folder per @loadmap/dsl release, frozen: the examples, templates and docs' definitions
 * each release shipped. A file that compiled under its version keeps compiling and computing the same on every later
 * loadmap 1 (docs/dsl.md, "Versions"). Never edit one; a release adds its files in a folder of its own. The snapshot
 * of what their expectations find moves only with a fix of a figure that was wrong, which its changeset names.
 */
const dir = new URL('corpus/', import.meta.url)
const files = readdirSync(dir).flatMap((release) =>
  readdirSync(new URL(`${release}/`, dir)).map((f): [string, string] => [
    `${release}/${f}`,
    readFileSync(new URL(`${release}/${f}`, dir), 'utf8'),
  ]),
)

beforeAll(() => loadCatalog())

describe('released definitions', () => {
  it('holds every release since the first', () => {
    expect(files.length).toBeGreaterThanOrEqual(20)
    expect(files.map(([f]) => f)).toContain('0.1.0/template-web-app.loadmap')
  })

  it.each(files)('%s still compiles, and its expectations come out the same', (_, src) => {
    const r = compile(src)
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(r.definition).toBeDefined()
    expect(r.expectations.map((e) => ({ outcome: e.result.outcome, full: e.result.full }))).toMatchSnapshot()
  })
})
