import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { completions, decodeShare, encodeShare, MAX_SHARED_BYTES } from '../src'

const checkout = readFileSync(new URL('../../../examples/checkout/checkout.loadmap', import.meta.url), 'utf8')
const alerts = readFileSync(new URL('../../../examples/alerts/alerts.loadmap', import.meta.url), 'utf8')

/** Completions where "|" is in `src`. */
function at(src: string) {
  const i = src.indexOf('|')
  const text = src.slice(0, i) + src.slice(i + 1)
  const c = completions(text, i)
  return { labels: c.options.map((o) => o.label), word: text.slice(c.from, c.to), c }
}

/** The checkout definition with `line` added inside the block that starts with `opener`. */
const inside = (opener: string, line: string) => checkout.replace(opener, `${opener}\n  ${line}`)

describe('completions', () => {
  it('offers the entries of a table after its dot', () => {
    expect(at(inside('flow orders "orders" {', 'rate: flows.ev|')).labels).toEqual(['orders', 'events'])
    expect(at(inside('flow orders "orders" {', 'rate: util.|')).labels).toEqual(['gateway', 'workers', 'db'])
    expect(at(inside('flow orders "orders" {', 'rate: at.|')).labels).toEqual(['gateway', 'topic', 'workers', 'db'])
    // at.<stage>.: only the flows that reach that stage (events ends at the workers)
    expect(at(inside('flow orders "orders" {', 'rate: at.db.o|')).labels).toEqual(['orders'])
    expect(at(inside('flow orders "orders" {', 'rate: at.workers.|')).labels).toEqual(['orders', 'events'])
  })

  it("offers a block's properties and statements at the start of a line", () => {
    const { labels, word, c } = at(`${checkout}\nflow q {\n  pri|\n}`)
    expect(word).toBe('pri')
    expect(labels).toEqual(['unit', 'rate', 'priority', 'route', 'from', 'color', 'drop', 'merge', 'retry'])
    expect(c.options.find((o) => o.label === 'rate')).toMatchObject({ apply: 'rate: ', detail: 'required', boost: 2 })
    // what the block already sets is not offered again, but for the line being written
    expect(at(inside('flow orders "orders" {', 'pri|')).labels).toEqual(['drop', 'merge', 'retry'])
    expect(at(checkout.replace('rate: 40 * load', 'rat|e: 40 * load')).labels).toContain('rate')
  })

  it('offers stages in a route, nodes in an edge and after from', () => {
    const route = at(inside('flow orders "orders" {', 'route: gateway -> |')).labels
    expect(route).toEqual(['gateway', 'topic', 'workers', 'db', 'kafka'])
    expect(at(`${checkout}\nphones -> |`).labels).toEqual(['gateway', 'kafka', 'workers', 'db'])
    expect(at(inside('flow orders "orders" {', 'from: |')).labels).toContain('phones')
  })

  it('offers the names a formula can read', () => {
    const { labels } = at(inside('flow orders "orders" {', 'rate: |'))
    expect(labels).toEqual(
      expect.arrayContaining(['load', 'pods', 'batch', 'flows', 'workerCores', 'compact', 'measured']),
    )
    expect(at(inside('param rows "Rows per batch" {', 'hint: |')).labels).toEqual([])
    expect(at(`${checkout.replace('title: "Checkout pipeline"', 'title: |')}`).labels).toEqual([])
    expect(at(inside('node db "Postgres" "primary" {', 'plural: |')).labels).toEqual(['true', 'false'])
    expect(at(checkout.replace('memberLabel: `broker ${i}`', 'memberLabel: |')).labels).toEqual(['i'])
  })

  it('offers the values of an enum and the flows of a fan-out', () => {
    expect(at(inside('node db "Postgres" "primary" {', 'shape: c|')).labels).toEqual(['box', 'cylinder'])
    expect(at(checkout.replace('speed: 10', 'fullScreen: [verdict, li|]')).labels).toContain('limits')
    expect(at(inside('flow orders "orders" {', 'color: |')).labels).toEqual([
      'accent',
      'alt',
      'ok',
      'warn',
      'drop',
      'muted',
    ])
    const fan = at(alerts.replace('alerts -> contacts: 1', 'alerts -> contacts: 1\n    positions -> |'))
    expect(fan.labels).toEqual(expect.arrayContaining(['contacts', 'responders', 'watchers']))
  })

  it('works in a block that is not closed yet', () => {
    expect(at('loadmap 1\nflow a {\n  ra|').labels).toContain('rate')
  })
})

describe('share links', () => {
  it('give back the definition and the values', async () => {
    const link = await encodeShare(alerts, { load: 25, merge: false, posPods: 8 })
    expect(link.startsWith('v1.')).toBe(true)
    expect(link.endsWith('&load=25&merge=false&posPods=8')).toBe(true)
    // values come back as written; the editor reads them by each parameter's kind
    expect(await decodeShare(`#${link}`)).toEqual({
      source: alerts,
      values: { load: '25', merge: 'false', posPods: '8' },
    })
  })

  it('stay short enough to paste', async () => {
    expect((await encodeShare(alerts)).length).toBeLessThan(3000)
    expect((await encodeShare(checkout)).length).toBeLessThan(3000)
  })

  it('say what is wrong with a broken link instead of throwing', async () => {
    const link = await encodeShare(checkout)
    expect(await decodeShare('#example=checkout')).toEqual({ error: 'this link holds no loadmap definition' })
    expect(await decodeShare(link.slice(0, 40))).toEqual({ error: 'this link is cut or garbled' })
    expect(await decodeShare('v1.***')).toEqual({ error: 'this link is cut or garbled' })
    const bomb = await encodeShare('x'.repeat(MAX_SHARED_BYTES + 1))
    expect(await decodeShare(bomb)).toEqual({ error: 'this link unpacks to more than 1 MB' })
  })
})

describe('completions for expect', () => {
  it('offer the scenarios by their labels, quoted when they need it', () => {
    const src = checkout.replace('scenario "Proposed"', 'scenario "Two gateways" { gateways: 2 }\nscenario "Proposed"')
    const { labels, c } = at(`${src}\nexpect { scenario: | }`)
    expect(labels).toEqual(['Today', 'Two gateways', 'Proposed'])
    expect(c.options.map((o) => o.apply)).toEqual(['Today', '"Two gateways"', 'Proposed'])
    expect(at(`${checkout}\nexpect { component: | }`).labels).toEqual(['gateway', 'workers', 'db'])
  })
})

describe('completions for tier', () => {
  it('offer the tiers declared', () => {
    expect(at(checkout.replace('  tier: edge', '  tier: |')).labels).toEqual(['edge', 'services', 'data'])
    // declared further down, read without a compile
    expect(at(`${checkout.replace('  tier: edge', '  tier: |')}\ntier late "Late"`).labels).toContain('late')
    expect(at(checkout.replace('  tier: edge', '  ti|')).labels).toContain('tier')
    expect(at(`${checkout}\nti|`).labels).toContain('tier')
  })
})

const cache = readFileSync(new URL('../../editor/src/templates/cache.loadmap', import.meta.url), 'utf8')
const DB = 'node db "Database" "primary" {'
const PG = 'node db "Postgres" "primary" {'
/** The cache template with `line` added at the top of the database box. */
const inDb = (line: string) => cache.replace(DB, `${DB}\n  ${line}`)
const ranked = (src: string) =>
  [...at(src).c.options].sort((a, b) => (b.boost ?? 0) - (a.boost ?? 0)).map((o) => o.label)

describe('completions that know where they are', () => {
  it('offer the capacity forms first in a capacity, as snippets', () => {
    expect(ranked(inDb('capacity: |')).slice(0, 3)).toEqual(['measured', 'estimated', 'configured'])
    const estimated = at(inDb('capacity: |')).c.options.find((o) => o.label === 'estimated')
    expect(estimated?.snippet).toBe('estimated(${1:value}, "${2:unit}", "${3:source}")${0}')
    // elsewhere they wait at the end
    expect(ranked(inDb('demand: |')).slice(0, 3)).not.toContain('measured')
  })

  it('offer ± after a capacity value, not for a configured limit, not twice', () => {
    expect(at(inDb('capacity: estimated(3000 |)')).c.options).toMatchObject([
      { label: '± 30%', snippet: '± ${1:30}%${0}' },
    ])
    expect(at(inDb('capacity: measured(pods * (1 + 2) |)')).labels).toEqual(['± 30%'])
    expect(at(inDb('capacity: configured(3000 |)')).labels).toEqual([])
    expect(at(inDb('capacity: estimated(3000 ± 30% |)')).labels).toEqual([])
    expect(at(inDb('capacity: estimated(3000 +/- 30% |)')).labels).toEqual([])
    // after the ± only a number fits
    expect(at(inDb('capacity: estimated(3000 ± |)')).labels).toEqual([])
    // after a whole operand anywhere else only an operator fits
    expect(at(cache.replace('rate: 2_000 * load', 'rate: 2_000 |')).labels).toEqual([])
    expect(at(cache.replace('rate: 2_000 * load', 'rate: max(load, 2) |')).labels).toEqual([])
  })

  it('offer the units the file uses, then common ones, inside the quotes or with them', () => {
    const typing = at(inDb('capacity: measured(300, "q|")'))
    expect(typing.word).toBe('q')
    expect(typing.labels.slice(0, 4)).toEqual(['cores', 'ops/s', 'queries/s', 'req/s'])
    expect(typing.c.options[0]).toMatchObject({ apply: 'cores', detail: 'used here' })
    expect(at(inDb('capacity: measured(300, "|")')).word).toBe('')
    expect(at(inDb('capacity: measured(300, |)')).c.options[0]!.apply).toBe('"cores"')
    // the source is free text
    expect(at(inDb('capacity: measured(300, "x", "|")')).labels).toEqual([])
    expect(at(inDb('capacity: measured(300, "x", |)')).labels).toEqual([])
    // a quote left open right at the cursor is a text too
    // (the open parenthesis takes the rest of the box into this line: its own unit is not read)
    expect(at(inDb('capacity: measured(300, "|')).labels.slice(0, 2)).toEqual(['cores', 'ops/s'])
    expect(at(`${checkout}\nexpect { scenario: "|`).labels).toEqual(['Today', 'Proposed'])
    // a unit already written takes no other
    expect(at(inDb('capacity: measured(300, "req/s" |)')).labels).toEqual([])
  })

  it('read nothing into comments and plain texts', () => {
    expect(at(cache.replace('# no demand line', '# no dem| line')).labels).toEqual([])
    expect(at(cache.replace('"Database" "primary"', '"Data|base" "primary"')).labels).toEqual([])
    expect(at(cache.replace('"Cache in front of a database"', '"a # b|"')).labels).toEqual([])
    expect(at(cache.replace('`${pods} pods`', '`${pods} po|ds`')).labels).toEqual([])
    expect(at(cache.replace('over: "queries queue', 'over: "flows.|queries queue')).labels).toEqual([])
    // the line under a comment is code again
    expect(at(cache.replace('# no demand line', '# no demand line\n  dem|')).labels).toContain('demand')
    expect(at(`${cache}\n# Section\n\nflo|`).labels).toContain('flow')
  })

  it("complete the formulas in a template's parts by where the template is", () => {
    expect(at(cache.replace('compact(at.db.reads)', 'compact(|)')).labels).toEqual(
      expect.arrayContaining(['load', 'pods', 'hit', 'flows']),
    )
    expect(at(cache.replace('compact(at.db.reads)', 'compact(at.db.|)')).labels).toEqual(['reads'])
    expect(at(cache.replace('`${pods} pods`', '`${p|} pods`')).labels).toContain('pods')
    expect(at(checkout.replace('memberLabel: `broker ${i}`', 'memberLabel: `broker ${|}`')).labels).toEqual(['i'])
    // a title is a constant: its template reads nothing
    expect(at(cache.replace('"Cache in front of a database"', '`x ${|}`')).labels).toEqual([])
  })

  it('rank the flows that reach a box first in its demand', () => {
    const { c } = at(inside(PG, 'demand: |'))
    expect(c.options.find((o) => o.label === 'flows.orders')).toMatchObject({ boost: 3, detail: 'reaches this box' })
    expect(c.options.some((o) => o.label === 'flows.events')).toBe(false)
    const dot = at(inside(PG, 'demand: flows.|')).c.options
    expect(dot.map((o) => [o.label, o.boost])).toEqual([
      ['orders', 3],
      ['events', undefined],
    ])
  })

  it('leave out what would read itself', () => {
    expect(at(`${checkout}\nlet x = |`).labels).not.toContain('x')
    expect(at(`${checkout}\nlet y = 1\nlet x = derived.|`).labels).toEqual(['y'])
    expect(at(inside(PG, 'demand: util.|')).labels).toEqual(['gateway', 'workers'])
    expect(at(inside(PG, 'demand: demand.|')).labels).toEqual(['gateway', 'workers'])
    expect(at(inside(PG, 'capacity: estimated(demand.|)')).labels).toContain('db')
    expect(at(inside(PG, 'capacity: estimated(util.|)')).labels).not.toContain('db')
    // its texts may show its own utilization
    expect(at(inside(PG, 'over: `${pct(util.|)} full`')).labels).toContain('db')
  })

  it('offer the values of a parameter in a scenario, a preset or a step', () => {
    expect(at(`${checkout}\nscenario "S" { pods: | }`).labels).toEqual(['2', '3', '4', '6'])
    expect(at(`${checkout}\nstep "s" { batch: | }`).labels).toEqual(['true', 'false'])
    expect(at(`${checkout}\nscenario "S" { pods: 2; | }`).labels).not.toContain('pods')
    // and its own options for its default
    expect(at(`${checkout}\nparam p "P" { options: [1, 5, 10]; default: | }`).labels).toEqual(['1', '5', '10'])
    expect(at(`${checkout}\nparam p "P" { min: 1; max: 9; default: | }`).labels).toEqual([])
  })

  it('rank the switches first where a formula wants true or false', () => {
    expect(ranked(inside(PG, 'when: |')).slice(0, 3)).toEqual(['batch', 'true', 'false'])
  })

  it('offer the builtins and fits with their arguments', () => {
    const o = at(inside('flow orders "orders" {', 'rate: |')).c.options
    expect(o.find((x) => x.label === 'pow')).toMatchObject({ detail: '(x, y)', snippet: 'pow(${1:x}, ${2:y})${0}' })
    expect(o.find((x) => x.label === 'min')).toMatchObject({ detail: '(a, b, …)' })
    expect(o.find((x) => x.label === 'workerCores')).toMatchObject({ snippet: 'workerCores(${1:rate})${0}' })
  })

  it('offer the stages right after the last one along an edge first', () => {
    const { c } = at(inside('flow orders "orders" {', 'route: gateway -> |'))
    expect(c.options.find((o) => o.label === 'topic')).toMatchObject({ boost: 2 })
    expect(c.options.find((o) => o.label === 'db')?.boost).toBeUndefined()
  })
})

describe('completions on a box with one stage of another name', () => {
  // a route naming the box goes through its stage, as the compiler reads it
  const src = cache.replace(
    'node cache "Cache" `${hit * 100} % hits` {\n  cache { hit: hit }',
    'node cache "Cache" `${hit * 100} % hits` {\n  cache lookup { hit: hit }',
  )

  it('count the flows that go through it by the box', () => {
    expect(at(src.replace('compact(at.db.reads)', 'compact(at.lookup.|)')).labels).toEqual(['reads'])
    const { c } = at(
      src.replace(
        'node cache "Cache" `${hit * 100} % hits` {',
        'node cache "Cache" `${hit * 100} % hits` {\n  demand: |',
      ),
    )
    expect(c.options.find((o) => o.label === 'flows.reads')).toMatchObject({ boost: 3 })
  })
})

describe('completions while typing', () => {
  it('keep the rest of the file after a block left open', () => {
    const src = cache.replace('node clients', 'flow q {\n  rate: \n  route: api -> |\n\nnode clients')
    expect(at(src).labels).toEqual(['api', 'cache', 'db'])
    expect(at(`${cache}\nnode x "X" {\n  capacity: |`).labels).toContain('estimated')
    expect(at(`${cache}\nnode x "X" {\n  |`).labels).toContain('capacity')
  })

  it('never throw, at any offset and on any prefix of a file', () => {
    // every 7th offset in one file, every 23rd in the others: each lands on new kinds of places
    for (const [src, step] of [
      [cache, 7],
      [checkout, 23],
      [alerts, 23],
    ] as const)
      for (let i = 0; i <= src.length; i += step) {
        completions(src, i)
        completions(src.slice(0, i), i)
      }
  })

  it('cost a small part of a compile: nothing is run', async () => {
    const { compile } = await import('../src')
    const cpu = (f: () => void) => {
      f()
      const t = process.threadCpuUsage()
      for (let i = 0; i < 10; i++) f()
      return process.threadCpuUsage(t).user
    }
    const offset = checkout.indexOf('demand: flows.orders + flows.events') + 'demand: '.length
    expect(cpu(() => completions(checkout, offset)) * 5).toBeLessThan(cpu(() => compile(checkout)))
  })
})
