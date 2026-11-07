import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compile, completions, quickFixes, type TextChange } from '../src'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const cache = read('../../editor/src/templates/cache.loadmap')
const checkout = read('../../../examples/checkout/checkout.loadmap')

const apply = (src: string, changes: readonly TextChange[]) =>
  [...changes].sort((a, b) => b.from - a.from).reduce((s, c) => s.slice(0, c.from) + c.insert + s.slice(c.to), src)

/** The fixes of the first diagnostic of `src`, and the text each one makes. */
function fixes(src: string) {
  const r = compile(src)
  const d = r.diagnostics[0]!
  return quickFixes(src, r.diagnostics)[0]!.map((f) => ({ title: f.title, text: apply(src, f.changes), d }))
}

describe('quick fixes', () => {
  it('apply the did-you-mean, to a name, a property or a scenario', () => {
    for (const [broken, original] of [
      [cache.replace('demand: flows.reads', 'demand: flows.read'), cache],
      [cache.replace('short: "the API"', 'shrt: "the API"'), cache],
      [checkout.replace('scenario: Proposed', 'scenario: Propsed'), checkout],
    ] as const) {
      const [fix] = fixes(broken)
      expect(fix?.text).toBe(original)
      expect(fix?.title).toMatch(/^Change to "/)
    }
  })

  it('add a missing required property, in the block laid out as it is', () => {
    const [fix] = fixes(cache.replace('  rate: 2_000 * load\n', ''))
    expect(fix).toMatchObject({ title: 'Add "rate: 1"' })
    expect(compile(fix!.text).ok).toBe(true)
    expect(fix!.text).toContain('flow reads "reads" {\n  rate: 1\n  unit: "read"')
    // one line, and no block at all
    const one = fixes(
      cache.replace('load "Traffic, × today" { max: 50; default: 1 }', 'load "Traffic, × today" { default: 1 }'),
    )[0]!
    expect(one.text).toContain('load "Traffic, × today" { max: 1; default: 1 }')
    expect(
      fixes(cache.replace('load "Traffic, × today" { max: 50; default: 1 }', 'load "Traffic, × today"'))[0]!.text,
    ).toContain('load "Traffic, × today" { max: 1 }')
  })

  it('add to a block whose first line shares the "{", and to a box\'s component', () => {
    const shared = cache.replace(
      'flow reads "reads" {\n  unit: "read"\n  rate: 2_000 * load',
      'flow reads "reads" { unit: "read"',
    )
    const [fix] = fixes(shared)
    expect(fix?.text).toContain('flow reads "reads" { rate: 1; unit: "read"')
    expect(compile(fix!.text).ok).toBe(true)
    // the component's error sits at the box's id
    const box = fixes(cache.replace('  capacity: estimated(50_000, "ops/s", "vendor sizing for this node")\n', ''))
    expect(box[0]).toMatchObject({ title: 'Add "capacity: estimated(1, "cores", "source")"' })
    expect(compile(box[0]!.text).ok).toBe(true)
  })

  it("make a bare number a capacity, in the file's own unit", () => {
    const broken = cache.replace(
      'capacity: estimated(50_000, "ops/s", "vendor sizing for this node")',
      'capacity: 50_000',
    )
    const all = fixes(broken)
    expect(all.map((f) => f.title)).toEqual([
      'Make it estimated(50_000, "cores", "source")',
      'Make it measured(50_000, "cores", "source")',
    ])
    expect(compile(all[0]!.text).ok).toBe(true)
  })

  it('drop the ":" before an edge block', () => {
    const [fix] = fixes(cache.replace('clients -> api', 'clients -> api: { when: true }'))
    expect(fix?.text).toBe(cache.replace('clients -> api', 'clients -> api { when: true }'))
  })

  it('offer nothing where there is no sure fix', () => {
    const r = compile(cache.replace('rate: 2_000 * load', 'rate: 2_000 * ('))
    expect(quickFixes(cache, r.diagnostics).every((f) => Array.isArray(f))).toBe(true)
    expect(quickFixes('', [])).toEqual([])
  })
})

describe('statement snippets', () => {
  const top = completions(`${cache}\n`, cache.length + 1).options
  const snippet = (k: string) => top.find((o) => o.label === k)?.snippet

  it('hold the id, the label and the required properties, and for a box a stage and a capacity', () => {
    expect(snippet('flow')).toBe(
      'flow ${1:id} "${2:label}" {\n  rate: ${3:rate}\n  route: ${4:a} -> ${5:b}\n  from: ${6:node}\n}',
    )
    expect(snippet('node')).toBe(
      'node ${1:id} "${2:label}" {\n  ${3:pass}\n  capacity: estimated(${4:value}, "${5:unit}", "${6:source}")\n}',
    )
    expect(snippet('growth')).toBe('growth {\n  rate: ${1:rate}\n  per: ${2:month}\n  asOf: "${3:asOf}"\n}')
    expect(snippet('let')).toBe('let ${1:id} = ${2:formula}')
    expect(snippet('tier')).toBe('tier ${1:id} "${2:label}"')
    expect(top.find((o) => o.label === 'thresholds')?.snippet).toBeUndefined()
    // a fit needs two distinct x: two rows
    expect(snippet('fit')).toContain('${5:1} ${6:1}\n    ${7:2} ${8:2}')
  })

  it('stay keywords where the line already holds the rest of a statement', () => {
    const i = cache.indexOf('node db') + 2
    const before = completions(cache, i).options.find((o) => o.label === 'node')
    expect(before).toMatchObject({ label: 'node' })
    expect(before?.snippet).toBeUndefined()
  })

  it('give a definition that compiles once the fields are filled as they are', () => {
    // every field left at its name or value: the shape is right, what is missing is the reader's
    for (const k of ['param', 'step', 'expect', 'tier', 'load'])
      expect(snippet(k)!.replace(/\$\{\d+:([^}]*)\}/g, '$1')).toMatch(new RegExp(`^${k}\\b`))
  })
})
