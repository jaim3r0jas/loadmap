import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { compile, definition, loadCatalog, references, rename } from '../src'
import { parse, Reporter } from '../src/internal'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const cache = read('../../editor/src/templates/cache.loadmap')
const checkout = read('../../../examples/checkout/checkout.loadmap')
const every = read('../../../docs/every-statement.loadmap')

/** The text of each place the name `k` characters into `needle` is written. */
function refs(src: string, needle: string, k: number) {
  const i = src.indexOf(needle) + k
  return references(src, i)?.map((s) => src.slice(s.from, s.to))
}
const at = (src: string, needle: string, k: number) => src.indexOf(needle) + k

// docs/every-statement.loadmap has a published statement: each rename must compile
beforeAll(() => loadCatalog())

describe('references and definition', () => {
  it('find a box by its id, the stage and the component that take it, wherever they are written', () => {
    const i = at(cache, 'at.db.reads', 3)
    const spans = references(cache, i)!
    expect(spans.map((s) => s.from)).toEqual([
      at(cache, 'api -> cache -> db', 16),
      at(cache, 'node db', 5),
      at(cache, 'cache -> db:', 9),
      at(cache, 'at.db.reads', 3),
    ])
    expect(definition(cache, i)).toEqual({ from: at(cache, 'node db', 5), to: at(cache, 'node db', 7) })
  })

  it('find parameters, flows, tiers and scenarios', () => {
    expect(refs(cache, 'pods * 1', 1)).toEqual(['pods', 'pods', 'pods', 'pods'])
    expect(refs(cache, 'hit: hit', 6)).toHaveLength(4)
    expect(refs(cache, 'flows.reads', 7)).toEqual(['reads', 'reads', 'reads'])
    expect(refs(checkout, 'tier: edge', 7)).toEqual(['edge', 'edge'])
    // a scenario's label, quoted where it is declared and bare where it is named
    expect(refs(checkout, 'scenario: Proposed', 11)).toEqual(['Proposed', 'Proposed', 'Proposed'])
  })

  it('find nothing for what is not a declared name', () => {
    expect(references(cache, at(cache, 'max: 50', 1))).toBeNull()
    expect(references(cache, at(cache, 'compact(', 2))).toBeNull()
    expect(references(cache, at(cache, '# no demand', 4))).toBeNull()
    expect(definition(cache, at(cache, 'demand: flows.reads * 0', 1))).toBeNull()
  })
})

describe('rename', () => {
  it('renames a box with its stage and component, and the result compiles', () => {
    const r = rename(cache, at(cache, 'node db', 6), 'primary')
    expect('source' in r && r.changes).toHaveLength(4)
    if (!('source' in r)) return
    expect(compile(r.source).ok).toBe(true)
    expect(r.source).toContain('route: api -> cache -> primary')
    expect(r.source).toContain('compact(at.primary.reads)')
  })

  it('quotes a scenario label where it is named bare and must be', () => {
    const r = rename(checkout, at(checkout, 'scenario: Proposed', 11), 'Two gateways')
    if (!('source' in r)) throw new Error(r.error)
    expect(r.source).toContain('scenario "Two gateways" {')
    expect(r.source).toContain('scenario: "Two gateways"')
    expect(compile(r.source).ok).toBe(true)
  })

  it('refuses a name that is not one, is reserved or taken, and the load', () => {
    const pods = at(cache, 'pods * 1', 1)
    expect(rename(cache, pods, 'hit')).toEqual({ error: '"hit" is taken' })
    expect(rename(cache, pods, 'flows')).toEqual({ error: '"flows" is reserved' })
    expect(rename(cache, pods, 'constructor')).toEqual({ error: '"constructor" is reserved' })
    expect(rename(cache, pods, '9x')).toMatchObject({ error: expect.stringMatching(/^"9x" is not a name/) })
    expect(rename(cache, at(cache, '2_000 * load', 9), 'traffic')).toEqual({ error: 'the load keeps its name' })
    expect(rename(cache, at(cache, 'max: 50', 1), 'x')).toEqual({ error: 'nothing to rename here' })
  })

  it('renames every declared name of the examples there and back, compiling each way', () => {
    // checkout and every-statement hold every statement: enough, and each rename compiles twice (a minute on CI)
    for (const src of [checkout, every]) {
      const { doc } = parse(src, new Reporter(src))
      const names = new Set<string>()
      // every name a statement declares, by where it is written
      const visit = (list: typeof doc.body) => {
        for (const s of list)
          if (s.kind === 'decl') {
            const a = s.args[0]
            if (a?.t === 'id' && !['points', 'loadmap'].includes(s.keyword.name)) names.add(`${a.from}`)
            if (s.body) visit(s.body)
          }
      }
      visit(doc.body)
      for (const from of names) {
        const i = Number(from)
        const old = src.slice(i, src.slice(i).search(/\W/) + i)
        const there = rename(src, i, `${old}Renamed`)
        // rename refuses a result that would not compile
        if (!('source' in there)) throw new Error(`${old}: ${there.error}`)
        // the declaration moved by what changed before it
        const moved =
          i + there.changes.filter((c) => c.to <= i).reduce((n, c) => n + c.insert.length - (c.to - c.from), 0)
        const back = rename(there.source, moved, old)
        if (!('source' in back)) throw new Error(`${old} back: ${back.error}`)
        expect(back.source).toBe(src)
      }
    }
  }, 90_000)
})
