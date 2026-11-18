import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compile, quickFixes, type TextChange } from '../src'
import { completions } from '../src/completion'

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

  it('rename an old name to the new one', () => {
    const [fix] = fixes(checkout.replace('{ underTarget: 7 }', '{ target: 7 }'))
    expect(fix).toMatchObject({ title: 'Rename to "underTarget"', text: checkout })
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

  it('add held to a component whose on names the stages that hold it', () => {
    const [fix] = fixes(checkout.replace('  held: 20ms\n', ''))
    expect(fix?.d.code).toBe('missing-property')
    expect(fix?.title).toBe('Add "held: 1"')
    expect(fix?.text).toBe(checkout.replace('  held: 20ms\n', '').replace('{\n  on: db', '{\n  held: 1\n  on: db'))
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

  it('write a "%" glued to a number as the share or as the remainder, in a file from before 1.5', () => {
    const cache14 = readFileSync(new URL('corpus/0.36.0/template-cache.loadmap', import.meta.url), 'utf8')
    const glued = cache14.replace('2_000 * load', '2_000 * load * (30%+1)')
    expect(fixes(glued).map((f) => f.title)).toEqual(['Make it the share: 30% + 1', 'Keep the remainder: mod(30, +1)'])
    const [share, mod] = fixes(glued)
    expect(share!.text).toBe(cache14.replace('2_000 * load', '2_000 * load * (30% + 1)'))
    expect(mod!.text).toBe(cache14.replace('2_000 * load', '2_000 * load * (mod(30, +1))'))
    // the template as 1.4 shipped it still has its workers block, which warns
    for (const f of [share, mod]) expect(compile(f!.text).diagnostics.filter((d) => d.code !== 'removed')).toEqual([])
    // in a file from before mod(), the fix brings the version it needs
    const top = (src: string) => src.replace('view { speed: 10 }', 'speed: 10')
    const old = top(glued).replace('loadmap 1.4', 'loadmap 1.1')
    expect(fixes(old)[1]!.text).toBe(top(mod!.text).replace('loadmap 1.4', 'loadmap 1.2'))
  })

  it('write what 1.5 left one spelling of the way that is left', () => {
    const fixed = (from: string, to: string) => {
      const src = cache.replace(from, to)
      expect(src).not.toBe(cache)
      const [fix] = fixes(src)
      expect(compile(fix!.text).diagnostics).toEqual([])
      return { title: fix!.title, text: fix!.text }
    }
    expect(fixed('  pods: pods\n  perPod: 8\n', '  workers { pods: pods; perPod: 8 }\n')).toEqual({
      title: 'Write its lines on the pool',
      text: cache.replace('  pods: pods\n  perPod: 8\n', '  pods: pods; perPod: 8\n'),
    })
    expect(
      fixed('node clients "Clients" "web and mobile"', 'node clients "Clients" { sub: "web and mobile" }'),
    ).toEqual({
      title: 'Write it on the first line',
      text: cache,
    })
    expect(fixed('clients -> api', 'clients -> api { label: "HTTPS" }')).toEqual({
      title: 'Write it after the edge',
      text: cache.replace('clients -> api', 'clients -> api: "HTTPS"'),
    })
    const hit = 'param hit "Cache hit ratio" { options: [0.5, 0.8, 0.95]; default: 0.8 }'
    const tagged = 'param hit "Cache hit ratio" {\n  options: [0.5, 0.8, 0.95]\n  default: 0.8\n  tag: "estimate"\n}'
    expect(fixed(hit, tagged)).toEqual({
      title: 'Remove "tag"',
      text: cache.replace(hit, 'param hit "Cache hit ratio" {\n  options: [0.5, 0.8, 0.95]\n  default: 0.8\n}'),
    })
    expect(fixed('2_000 * load', '2_000 * load * (1 + pods % 2)')).toEqual({
      title: 'Write it as mod(a, b)',
      text: cache.replace('2_000 * load', '2_000 * load * (1 + mod(pods, 2))'),
    })
    expect(fixed('2_000 * load', '2_000 * load * (pods === 2 ? 1 : 2)')).toEqual({
      title: 'Rename to "=="',
      text: cache.replace('2_000 * load', '2_000 * load * (pods == 2 ? 1 : 2)'),
    })
    expect(fixed('view { speed: 10 }', 'view { speed: 10 }\nlayout: down')).toEqual({
      title: 'Move the view settings into view { … }',
      text: cache.replace('view { speed: 10 }', 'view { speed: 10; direction: down }'),
    })
    // beside a direction the old name sets nothing: it goes
    expect(fixed('view { speed: 10 }', 'view { speed: 10; direction: down }\nlayout: right')).toEqual({
      title: 'Remove "layout"',
      text: cache.replace('view { speed: 10 }', 'view { speed: 10; direction: down }'),
    })
    // the grid goes from its line, and a view block it was the last line of goes with it
    expect(fixed('view { speed: 10 }', 'view { speed: 10; grid: false }')).toEqual({
      title: 'Remove "grid"',
      text: cache,
    })
    expect(fixed('view { speed: 10 }\n', 'view { grid: false }\n')).toEqual({
      title: 'Remove "grid"',
      text: cache.replace('view { speed: 10 }\n', ''),
    })
  })

  it('move the view settings at the top into view { … }', () => {
    const top = cache.replace('view { speed: 10 }', 'speed: 10\nlanes: striped')
    expect(top).not.toBe(cache)
    const [fix] = fixes(top)
    expect(fix!.title).toBe('Move the view settings into view { … }')
    expect(fix!.text).toBe(cache.replace('view { speed: 10 }', 'view { speed: 10; lanes: striped }'))
    expect(compile(fix!.text).diagnostics).toEqual([])
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

describe('a hop without an edge', () => {
  const SRC = `loadmap 1.1
load { max: 10 }
flow req "requests" { rate: 100 * load; route: gw -> db; from: users }
node users "Users"
node gw "Gateway" { pass; capacity: measured(1_000, "req/s"); over: "clients wait" }
node api "API" { pass; capacity: measured(1_000, "req/s"); over: "clients wait" }
node db "Database" { store; capacity: measured(1_000, "req/s"); over: "writes queue" }
users -> gw
gw -> api -> db
`

  it('adds the edge after the last one leaving its box, or routes the flow through the boxes the edges join', () => {
    const [add, through] = fixes(SRC)
    expect(add).toMatchObject({ title: 'Add the edge gw -> db' })
    expect(add!.text).toContain('gw -> api -> db\ngw -> db\n')
    expect(compile(add!.text).ok).toBe(true)
    expect(through).toMatchObject({ title: 'Route it through api' })
    expect(through!.text).toContain('route: gw -> api -> db;')
    expect(compile(through!.text).ok).toBe(true)
  })

  it('routes through no box a flow would end in', () => {
    const src = SRC.replace('node api "API" { pass;', 'node api "API" { store;')
    expect(fixes(src).map((f) => f.title)).toEqual(['Add the edge gw -> db'])
  })

  it('puts back an edge deleted from a file, where it was', () => {
    const src = checkout.replace(/\nkafka -> workerPool[^\n]*/, '')
    const [add, ...rest] = fixes(src)
    expect(rest).toEqual([])
    expect(add!.title).toBe('Add the edge kafka -> workerPool')
    expect(compile(add!.text).ok).toBe(true)
  })
})

describe('a loss no lost box counts', () => {
  it('adds a lost box after the box that loses it, and the edge into it', () => {
    const search = read('../../../examples/search/search.loadmap')
    const src = search.replace(/\nnode limiterRejected[^\n]*/, '').replace(/\nlimiter -> limiterRejected/, '')
    const [fix, ...rest] = fixes(src)
    expect(rest).toEqual([])
    expect(fix!.title).toBe('Add a lost box for what limiter loses')
    // the fix puts back what the example has, line for line
    expect(fix!.text).toBe(search)
  })

  it('leaves a comment at the end of the box on the box', () => {
    const src = `loadmap 1.1
load { max: 10 }
flow req "requests" { rate: 100 * load; route: limiter; from: users }
node users "Users"
node limiter "Limiter" { limit; capacity: configured(1_500, "req/s", "gateway config"); over: "429s" } # the gateway
users -> limiter
`
    const [fix] = fixes(src)
    expect(fix!.text).toContain('over: "429s" } # the gateway\nnode limiterRejected "Turned away"')
    expect(compile(fix!.text).diagnostics).toEqual([])
  })
})
