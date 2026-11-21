import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compile, format } from '../src'
import { applyOperations, OPERATIONS, type Operation, type OperationsApplied, type Project } from '../src/ops'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const shop: Project = {
  entry: 'shop.loadmap',
  files: { 'shop.loadmap': read('../../../examples/shop-live/shop.loadmap') },
}
const regionNames = [
  'regions.loadmap',
  'regions.story.loadmap',
  'regions.even.loadmap',
  'region.loadmap',
  'platform.loadmap',
]
const regions: Project = {
  entry: 'regions.loadmap',
  files: Object.fromEntries(regionNames.map((n) => [n, read(`../../../examples/regions/${n}`)])),
}

function applied(p: Project, ops: Operation[]): OperationsApplied {
  const r = applyOperations(p, ops)
  if (!r.ok) throw new Error(`refused at ${r.index}: ${r.error}`)
  return r
}
const text = (r: OperationsApplied, path = r.project.entry) => r.project.files[path]!
const compiles = (r: OperationsApplied) =>
  compile(text(r), { path: r.project.entry, files: r.project.files }).diagnostics.filter((d) => d.severity === 'error')

describe('operations by name', () => {
  it('renames a box everywhere it is written', () => {
    const r = applied(shop, [{ op: 'rename', target: 'orderWorkers', to: 'checkoutWorkers' }])
    expect(text(r)).not.toMatch(/\borderWorkers\b/)
    expect(text(r)).toContain('route: web -> checkoutWorkers -> db')
    expect(text(r)).toContain('checkoutWorkers -> db')
    expect(r.notes).toEqual(['Renamed orderWorkers to checkoutWorkers'])
    expect(compiles(r)).toEqual([])
  })

  it('sets a property that is there, writes one that is not, and takes one out', () => {
    const r = applied(shop, [
      { op: 'set', target: 'db.capacity', value: 'estimated(9_000 ± 30%, "queries/s")' },
      { op: 'set', target: 'web.describe', value: '"the front door"' },
      { op: 'unset', target: 'web.short' },
    ])
    expect(text(r)).toContain('capacity: estimated(9_000 +- 30%, "queries/s")')
    expect(text(r)).toMatch(/node web "Web" \{[^}]*describe: "the front door"/)
    expect(text(r)).not.toContain('short: "the web tier"')
    expect(r.changed).toEqual(['shop.loadmap'])
  })

  it('sets a property of the model', () => {
    const r = applied(shop, [{ op: 'set', target: 'title', value: '"The shop"' }])
    expect(text(r)).toContain('title: "The shop"')
    expect(text(r)).not.toContain('title: "Shop, live"')
  })

  it('puts a new statement after the last of its kind, and replaces one with the same name', () => {
    const r = applied(shop, [
      { op: 'put', text: 'scenario "Sixteen" { pods: 8 }' },
      { op: 'put', text: 'expect "Now keeps 3×" { underTarget: 3 }' },
    ])
    const lines = text(r).split('\n')
    expect(lines.indexOf('scenario "Sixteen" { pods: 8 }')).toBe(
      lines.indexOf('scenario "More workers" { pods: 8 }') + 1,
    )
    expect(text(r)).toContain('expect "Now keeps 3×" { underTarget: 3 }')
    const again = applied(r.project, [
      {
        op: 'put',
        text: 'node db "Database" {\n  shape: cylinder\n  store\n  demand: queryRate * load\n  capacity: estimated(10_000 ± 30%, "queries/s")\n  over: "queries queue"\n}',
      },
    ])
    expect(text(again).match(/node db /g)).toHaveLength(1)
    expect(text(again)).toContain('estimated(10_000 ± 30%, "queries/s")')
    expect(again.notes).toEqual(['Replaced node db'])
  })

  it('removes a box with its edges and its place in routes', () => {
    const r = applied(shop, [{ op: 'remove', target: 'orderWorkers' }])
    expect(text(r)).not.toMatch(/\borderWorkers\b/)
    expect(text(r)).toContain('route: web -> db')
    expect(r.notes).toEqual(['Removed pool orderWorkers with 2 edges, 1 route'])
    expect(compiles(r)).toEqual([])
  })

  it('refuses a list that ends with a formula reading what was removed, and passes one that mends it', () => {
    const broken = applyOperations(shop, [{ op: 'remove', target: 'coresNow' }])
    expect(broken).toMatchObject({ ok: false, index: -1 })
    expect(!broken.ok && broken.error).toMatch(/^shop\.loadmap:\d+: .*coresNow/)
    const mended = applied(shop, [
      { op: 'remove', target: 'coresNow' },
      { op: 'set', target: 'orderWorkers.demand', value: '0.6 * load' },
    ])
    expect(compiles(mended)).toEqual([])
  })

  it('removes a parameter with its values in scenarios', () => {
    const r = applyOperations(shop, [
      { op: 'remove', target: 'pods' },
      { op: 'set', target: 'orderWorkers.pods', value: '4' },
      { op: 'set', target: 'orderWorkers.capacity', value: 'measured(4, "cores", "pod CPU limit")' },
      {
        op: 'put',
        text: 'pool orderWorkers "Order workers" "4 pods" {\n  pods: 4\n  perPod: 4\n  demand: coresNow * load\n  capacity: measured(4, "cores", "pod CPU limit")\n  over: "orders wait"\n}',
      },
    ])
    expect(r.ok && r.project.files['shop.loadmap']).not.toContain('scenario "More workers" { pods: 8 }')
    expect(r.ok && r.notes[0]).toMatch(/^Removed param pods with 1 value; still named in shop\.loadmap:\d+/)
  })

  it('connects and disconnects boxes, splitting a chain', () => {
    const r = applied(shop, [{ op: 'connect', from: 'shoppers', to: 'db', label: '"reads"' }])
    expect(text(r)).toContain('shoppers -> db: "reads"')
    expect(applyOperations(shop, [{ op: 'connect', from: 'web', to: 'db' }])).toMatchObject({
      ok: false,
      error: 'web -> db is there already',
    })
    const chained: Project = {
      entry: 'm.loadmap',
      files: {
        'm.loadmap': 'loadmap 1.6\nload "x" { max: 2; default: 1 }\nnode a "A"\nnode b "B"\nnode c "C"\na -> b -> c\n',
      },
    }
    const split = applied(chained, [{ op: 'disconnect', from: 'b', to: 'c' }])
    expect(text(split)).toContain('a -> b\n')
    expect(text(split)).not.toContain('b -> c')
  })

  it('names what it cannot find, with the name it may mean', () => {
    expect(applyOperations(shop, [{ op: 'set', target: 'dbb.capacity', value: '3' }])).toEqual({
      ok: false,
      error: 'nothing is named "dbb.capacity": did you mean "db"?',
      index: 0,
    })
    expect(applyOperations(shop, [{ op: 'rename', target: 'db', to: 'not a name' }])).toMatchObject({ ok: false })
    expect(applyOperations(shop, [{ op: 'nope' } as never])).toMatchObject({ ok: false, error: 'no operation "nope"' })
  })

  it('applies all of a list or none of it', () => {
    const r = applyOperations(shop, [
      { op: 'set', target: 'db.short', value: '"the store"' },
      { op: 'remove', target: 'nothing' },
    ])
    expect(r).toMatchObject({ ok: false, index: 1 })
  })

  it('keeps a file that format() laid out laid out', () => {
    const r = applied(shop, [{ op: 'put', text: 'scenario   "Odd"    {pods:2}' }])
    expect(format(text(r)).text).toBe(text(r))
  })

  it('lists every operation by its name', () => {
    expect(OPERATIONS).toHaveLength(11)
  })
})

describe('operations across files', () => {
  it('adds a part and moves a box into it, naming it from the model', () => {
    const r = applied(shop, [
      { op: 'addFile', path: 'workers.loadmap', role: 'part' },
      { op: 'move', target: 'orderWorkers', to: 'workers.loadmap' },
    ])
    expect(r.added).toEqual(['workers.loadmap'])
    expect(text(r, 'workers.loadmap')).toMatch(/^loadmap 1\.6\npart of "\.\/shop\.loadmap"\n\npool orderWorkers /)
    expect(text(r)).toMatch(/^loadmap 1\.6\ninclude "\.\/workers\.loadmap"\n/)
    expect(text(r)).not.toContain('pool orderWorkers')
    expect(compiles(r)).toEqual([])
  })

  it('renames across a model and its part', () => {
    const r = applied(shop, [
      { op: 'addFile', path: 'workers.loadmap', role: 'part' },
      { op: 'move', target: 'orderWorkers', to: 'workers.loadmap' },
      { op: 'rename', target: 'orderWorkers', to: 'cw' },
    ])
    expect(text(r, 'workers.loadmap')).toContain('pool cw ')
    expect(text(r)).toContain('route: web -> cw -> db')
  })

  it('renames a name of a library, and the files that import it keep theirs', () => {
    const r = applied(regions, [{ op: 'rename', target: 'postgres', to: 'pg' }])
    expect(r.changed.sort()).toEqual(['platform.loadmap', 'region.loadmap'])
    expect(text(r, 'platform.loadmap')).toContain('node pg "Postgres"')
    expect(text(r, 'region.loadmap')).toMatch(/import "\.\/platform\.loadmap" \{ postgres: pg; pipeline \}/)
  })

  it('renames and removes files with the head lines that name them', () => {
    const moved = applied(regions, [{ op: 'renameFile', from: 'platform.loadmap', to: 'lib/platform' }])
    expect(moved.renamed).toEqual([{ from: 'platform.loadmap', to: 'lib/platform.loadmap' }])
    expect(text(moved, 'region.loadmap')).toContain('import "./lib/platform.loadmap"')
    const gone = applied(regions, [{ op: 'removeFile', path: 'regions.story.loadmap' }])
    expect(gone.removed).toEqual(['regions.story.loadmap'])
    expect(text(gone)).not.toContain('include "./regions.story.loadmap"')
  })

  it('moves only between a model and its parts', () => {
    expect(applyOperations(regions, [{ op: 'move', target: 'postgres', to: 'regions.loadmap' }])).toMatchObject({
      ok: false,
      index: 0,
    })
  })

  it('refuses a name in two files without the file, and takes one with it', () => {
    const two: Project = {
      entry: 'm.loadmap',
      files: {
        'm.loadmap':
          'loadmap 1.6\nimport "./a.loadmap" { }\nimport "./b.loadmap" { }\nload "x" { max: 2; default: 1 }\n',
        'a.loadmap': 'loadmap 1.6\nlibrary "a"\nlet k = 1\n',
        'b.loadmap': 'loadmap 1.6\nlibrary "b"\nlet k = 2\n',
      },
    }
    expect(applyOperations(two, [{ op: 'set', target: 'k', value: '3' }])).toMatchObject({ ok: false })
    expect(applyOperations(two, [{ op: 'remove', target: 'k', file: 'b.loadmap' }])).toMatchObject({
      ok: true,
      notes: ['Removed let k'],
    })
  })
})
