import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { completions, decodeShare, encodeShare, LANGUAGE_VERSION, MAX_SHARED_BYTES } from '../src'

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
  it('offers what the language writes now: a pool its workers, view its direction, nothing 1.5 dropped', () => {
    const pool = at(inside('pool workerPool "Workers" `${pods} pods × ${threads} threads` {', '|')).labels
    expect(pool).toEqual(expect.arrayContaining(['placement', 'stageLabel', 'autoscale']))
    // pods and perPod are written already; the workers block and sub: are gone
    for (const gone of ['pods', 'perPod', 'workers', 'sub']) expect(pool).not.toContain(gone)
    const top = at(checkout.replace('\ntitle:', '\n|\ntitle:')).labels
    for (const moved of ['direction', 'rows', 'layout', 'grid', 'speed']) expect(top).not.toContain(moved)
    expect(at(checkout.replace('view {\n  speed: 10', 'view {\n  |\n  speed: 10')).labels).toEqual([
      'fullScreen',
      'lanes',
      'direction',
      'rows',
      'closed',
    ])
    expect(at(`${checkout}\nphones -> db {\n  |\n}\n`).labels).toEqual(['when'])
    // a file of 1.4 is offered what 1.4 writes: the direction at the top, a pool's workers in their block
    const v14 = checkout.replace('loadmap 1.5', 'loadmap 1.4')
    expect(at(v14.replace('\ntitle:', '\n|\ntitle:')).labels).toContain('direction')
    const snippet = (src: string) =>
      at(src.replace('\ntitle:', '\npo|\ntitle:')).c.options.find((o) => o.label === 'pool')?.snippet
    expect(snippet(v14)).toContain('workers { pods: ')
    expect(snippet(checkout)).not.toContain('workers')
    expect(snippet(checkout)).toContain('perPod: ')
  })

  it('offers the entries of a table after its dot', () => {
    expect(at(inside('flow orders "orders" {', 'rate: flows.ev|')).labels).toEqual(['orders', 'events'])
    expect(at(inside('flow orders "orders" {', 'rate: util.|')).labels).toEqual([
      'gateway',
      'workerPool',
      'db',
      'conns',
    ])
    expect(at(inside('flow orders "orders" {', 'rate: at.|')).labels).toEqual([
      'gateway',
      'topic',
      'kafkaDropped',
      'workerPool',
      'db',
    ])
    // at.<stage>.: only the flows that reach that stage (events ends at the workers)
    expect(at(inside('flow orders "orders" {', 'rate: at.db.o|')).labels).toEqual(['orders'])
    expect(at(inside('flow orders "orders" {', 'rate: at.workerPool.|')).labels).toEqual(['orders', 'events'])
  })

  it("offers a block's properties and statements at the start of a line", () => {
    const { labels, word, c } = at(`${checkout}\nflow q {\n  pri|\n}`)
    expect(word).toBe('pri')
    expect(labels).toEqual(['unit', 'rate', 'priority', 'timeout', 'route', 'from', 'color', 'drop', 'merge', 'retry'])
    expect(c.options.find((o) => o.label === 'rate')).toMatchObject({ apply: 'rate: ', detail: 'required', boost: 2 })
    // what the block already sets is not offered again, but for the line being written
    expect(at(inside('flow orders "orders" {', 'pri|')).labels).toEqual(['timeout', 'drop', 'merge', 'retry'])
    expect(at(checkout.replace('rate: 40 * load', 'rat|e: 40 * load')).labels).toContain('rate')
  })

  it('offers stages in a route, nodes in an edge and after from', () => {
    // not the stage before, nor kafka beside its one queue (topic)
    const route = at(inside('flow orders "orders" {', 'route: gateway -> |')).labels
    expect(route).toEqual(['topic', 'workerPool', 'db'])
    // phones -> gateway is drawn already
    expect(at(`${checkout}\nphones -> |`).labels).toEqual(['kafka', 'kafkaDropped', 'workerPool', 'db'])
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
    const link = await encodeShare(alerts, { load: 25, mergeNewest: false, posPods: 8 })
    expect(link.startsWith('v1.')).toBe(true)
    expect(link.endsWith('&load=25&mergeNewest=false&posPods=8')).toBe(true)
    // values come back as written; the editor reads them by each parameter's kind
    expect(await decodeShare(`#${link}`)).toEqual({
      source: alerts,
      values: { load: '25', mergeNewest: 'false', posPods: '8' },
    })
  })

  it('stay short enough to paste', async () => {
    expect((await encodeShare(alerts)).length).toBeLessThan(3100)
    expect((await encodeShare(checkout)).length).toBeLessThan(3100)
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
    expect(at(`${checkout}\nexpect { component: | }`).labels).toEqual(['gateway', 'workerPool', 'db', 'conns'])
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
    expect(at(inside(PG, 'demand: util.|')).labels).toEqual(['gateway', 'workerPool', 'conns'])
    expect(at(inside(PG, 'demand: demand.|')).labels).toEqual(['gateway', 'workerPool', 'conns'])
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

  it('offer the stages right after the last one along an edge first, the others drawing the edge they need', () => {
    const src = inside('flow orders "orders" {', 'route: gateway -> |')
    const { c } = at(src)
    expect(c.options.find((o) => o.label === 'topic')).toMatchObject({ boost: 2, detail: 'stage, next along an edge' })
    const db = c.options.find((o) => o.label === 'db')!
    expect(db).toMatchObject({ boost: -1, detail: 'stage, draws gateway -> db' })
    // after the file's last edge
    const last = src.replace('|', '').trimEnd()
    expect(db.edits).toEqual([{ from: last.length, to: last.length, insert: '\ngateway -> db' }])
    // a route's first stage: the one its from node has an edge to
    const first = at(inside('flow orders "orders" {', 'route: |')).c.options
    expect(first.find((o) => o.label === 'gateway')).toMatchObject({ boost: 2 })
    expect(first.find((o) => o.label === 'db')?.edits?.[0]?.insert).toBe('\nphones -> db')
    // another stage's on: or a fan-out draws no edge
    expect(at(checkout.replace('  on: db', '  on: |')).c.options.some((o) => o.edits)).toBe(false)
  })
})

describe('completions on a box with one stage of another name', () => {
  // a route naming the box goes through its stage, as the compiler reads it
  const src = cache.replace(
    'node readCache "Cache" `${hit * 100} % hits` {\n  cache { hit: hit }',
    'node readCache "Cache" `${hit * 100} % hits` {\n  cache lookup { hit: hit }',
  )

  it('count the flows that go through it by the box', () => {
    expect(at(src.replace('compact(at.db.reads)', 'compact(at.lookup.|)')).labels).toEqual(['reads'])
    const { c } = at(
      src.replace(
        'node readCache "Cache" `${hit * 100} % hits` {',
        'node readCache "Cache" `${hit * 100} % hits` {\n  demand: |',
      ),
    )
    expect(c.options.find((o) => o.label === 'flows.reads')).toMatchObject({ boost: 3 })
  })
})

describe('completions while typing', () => {
  it('keep the rest of the file after a block left open', () => {
    const src = cache.replace('node clients', 'flow q {\n  rate: \n  route: api -> |\n\nnode clients')
    expect(at(src).labels).toEqual(['readCache', 'db'])
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

describe('completions that leave out what would not compile', () => {
  it('start a file with its version, and offer the head lines only in the head', () => {
    expect(at('|').c.options).toMatchObject([{ label: `loadmap ${LANGUAGE_VERSION}`, boost: 9 }])
    expect(at('loadmap |').labels).toEqual([LANGUAGE_VERSION])
    const head = at(`loadmap ${LANGUAGE_VERSION}\n|\n`).c.options
    for (const k of ['include', 'import', 'library', 'part', 'extends'])
      expect(head.find((o) => o.label === k)).toMatchObject({ boost: 5 })
    expect(head.find((o) => o.label === 'part')?.snippet).toBe('part of "${1:./model.loadmap}"')
    // after an include, the file is a model: no part of, library or extends
    const model = at(`loadmap ${LANGUAGE_VERSION}\ninclude "./a.loadmap"\n|\n`).labels
    expect(model).toEqual(expect.arrayContaining(['include', 'import']))
    for (const k of ['library', 'part', 'extends']) expect(model).not.toContain(k)
    // once a statement is written, the head is closed
    const body = at(`${checkout}\n|`).labels
    for (const k of ['include', 'import', 'library', 'part', 'extends', 'loadmap']) expect(body).not.toContain(k)
  })

  it('offer a part, a library and a variant what each may hold', () => {
    const part = at(`loadmap ${LANGUAGE_VERSION}\npart of "./m.loadmap"\n|`).labels
    expect(part).toEqual(expect.arrayContaining(['flow', 'node', 'step']))
    for (const k of ['title', 'assume', 'load', 'view', 'import', 'include']) expect(part).not.toContain(k)
    const library = at(`loadmap ${LANGUAGE_VERSION}\nlibrary "L"\nnode a "A" { pass }\n|`).labels
    expect(library).toEqual(expect.arrayContaining(['let', 'node', 'subsystem', 'published']))
    // no flows, no properties, no edges (a box's name would start one)
    for (const k of ['flow', 'title', 'step', 'connection', 'a']) expect(library).not.toContain(k)
    const variant = at(`loadmap ${LANGUAGE_VERSION}\nextends "./m.loadmap"\n|`).labels
    expect(variant).toEqual(expect.arrayContaining(['title', 'param', 'scenario', 'let', 'growth']))
    for (const k of ['node', 'flow', 'view', 'load']) expect(variant).not.toContain(k)
  })

  it('offer a node one stage and a box one component', () => {
    const db = at(inside('node db "Postgres" "primary" {', '|')).labels
    for (const k of ['pass', 'cache', 'limit', 'sink']) expect(db).not.toContain(k)
    // its own lines (demand, capacity) are its component already
    expect(db).not.toContain('component')
    const fresh = at(`${checkout}\nnode x "X" {\n  |\n}`).labels
    expect(fresh).toEqual(expect.arrayContaining(['pass', 'store', 'cache', 'component']))
    const owned = at(`${checkout}\nnode x "X" {\n  pass\n  component c { capacity: 1 }\n  |\n}`).labels
    expect(owned).not.toContain('component')
    // and with a component block, the box takes none of a component's lines
    for (const k of ['capacity', 'demand', 'over']) expect(owned).not.toContain(k)
    // a cluster holds several queues
    expect(at(checkout.replace('  members: 3', '  members: 3\n  |')).labels).toContain('queue')
    // an input only at the top of a library's box or subsystem
    expect(fresh).not.toContain('input')
    const library = `loadmap ${LANGUAGE_VERSION}\nlibrary\nsubsystem s {\n  |\n  node n "N" {\n    pass\n  }\n}\n`
    expect(at(library).labels).toContain('input')
    expect(at(library.replace('|\n', '').replace('    pass\n', '    pass\n    |\n')).labels).not.toContain('input')
    // with sets the inputs of what the box is like: only after a like
    expect(fresh).not.toContain('with')
    expect(at(`${checkout}\nnode x "X" {\n  like: db\n  |\n}`).labels).toContain('with')
  })
})

describe('completions for prototypes and subsystems in one file', () => {
  const src = `loadmap ${LANGUAGE_VERSION}
load { max: 10 }
flow orders { rate: 10 * load; route: line -> db; from: users }
node users "Users"
node proto "Proto" {
  input rate = 1
  pass
  demand: |DEMAND
  capacity: estimated(100, "req/s", "x")
}
pool workers "Workers" { pods: 2; perPod: 1; capacity: estimated(10, "cores", "x") }
subsystem queue "Queue" {
  input flow main
  input pods = 3
  cluster kafka "Kafka" { queue topic { partitions { |PARTS } } }
  pool consumers "Consumers" { pods: pods; perPod: 2; demand: flows.main; capacity: estimated(1, "cores", "x") }
  kafka -> consumers
  |EDGE
  route: kafka -> consumers
}
subsystem line "Line" {
  like: queue
  with { main: |MAIN }
}
node db "DB" { like: |LIKE }
users -> line
line -> db
|TOP
`
  /** What each place holds when the cursor is elsewhere. */
  const held: Record<string, string> = {
    DEMAND: 'rate',
    PARTS: 'main: 4',
    EDGE: '',
    MAIN: 'orders',
    LIKE: 'proto',
    TOP: '',
  }
  /** The model with the cursor at `mark`, after `add`. */
  const text = (mark: string, add = '') => {
    let out = src
    for (const [m, value] of Object.entries(held)) out = out.replace(`|${m}`, m === mark ? `${add}|` : value)
    return out
  }
  const pick = (mark: string, add = '') => at(text(mark, add))

  it('offer the boxes of the kind being written to be like, those with inputs first', () => {
    const { c } = pick('LIKE')
    expect(c.options.map((o) => o.label)).toEqual(['users', 'proto'])
    expect(c.options.find((o) => o.label === 'proto')).toMatchObject({ detail: 'node with inputs', boost: 2 })
    expect(c.options.map((o) => o.label)).not.toContain('workers')
  })

  it("offer a prototype's inputs in its formulas, over a parameter of that name, and a flow for a flow input", () => {
    const shadowed = at(text('DEMAND').replace('load { max: 10 }', 'load { max: 10 }\nparam rate { default: 1 }'))
    expect(shadowed.c.options.filter((o) => o.label === 'rate')).toMatchObject([{ detail: 'input' }])
    expect(pick('DEMAND').c.options.find((o) => o.label === 'rate')).toMatchObject({ detail: 'input', boost: 1 })
    expect(pick('PARTS').labels).toEqual(['orders', 'main'])
    expect(pick('MAIN').labels).toEqual(['orders'])
  })

  it("offer a subsystem's own boxes inside it, its boxes after its id outside, and itself in a route", () => {
    expect(pick('EDGE').labels).toEqual(expect.arrayContaining(['kafka', 'consumers']))
    expect(pick('EDGE').labels).not.toContain('queue.kafka')
    // a subsystem made from another: its boxes are what the like brought
    const made = text('TOP').replaceAll('|', '').replace('  like: queue\n', '  like: queue\n  |\n')
    expect(at(made).labels).toEqual(expect.arrayContaining(['kafka', 'consumers']))
    expect(pick('TOP', 'line.').labels).toEqual(['kafka', 'consumers'])
    expect(pick('TOP', 'users -> line.').labels).toEqual(['kafka', 'consumers'])
    // after a subsystem, not its own boxes
    expect(pick('TOP', 'line -> ').labels).not.toContain('line.kafka')
    const route = at(text('TOP').replaceAll('|', '').replace('route: line -> db', 'route: |')).labels
    expect(route).toEqual(expect.arrayContaining(['line', 'line.topic', 'db']))
    expect(at(text('TOP').replaceAll('|', '').replace('route: line -> db', 'route: line.|')).labels).toEqual(
      expect.arrayContaining(['topic', 'consumers']),
    )
  })
})

describe('completions after a keyword line', () => {
  const every = readFileSync(new URL('../../../docs/every-statement.loadmap', import.meta.url), 'utf8')

  it("offer the metrics after a measure's id", () => {
    const text = every.replace('measure orderRate ordersPlaced {', 'measure orderRate | {')
    expect(at(text).labels).toEqual(['ordersPlaced', 'apiCpu', 'signupsLogged'])
  })

  it("rank numbers over a published figure in a capacity's value", () => {
    const text = every.replace('capacity: brokersRef', 'capacity: measured(|)')
    const first = ranked(text).slice(0, 3)
    expect(first).not.toContain('brokersRef')
    expect(ranked(every.replace('capacity: brokersRef', 'capacity: |')).slice(0, 3)).toContain('brokersRef')
  })
})

describe('completions ranked by what the model already says', () => {
  const every = readFileSync(new URL('../../../docs/every-statement.loadmap', import.meta.url), 'utf8')
  const first = (src: string, n = 1) => ranked(src).slice(0, n)

  it('offer a node that runs no stage first after from', () => {
    const o = at(every.replace('  from: users\n  color: accent', '  from: |\n  color: accent')).c.options
    expect(first(every.replace('  from: users\n  color: accent', '  from: |\n  color: accent'))).toEqual(['users'])
    expect(o.find((x) => x.label === 'users')).toMatchObject({ detail: 'node, runs no stage', boost: 2 })
  })

  it('leave out an edge drawn already, and offer where a route goes next first', () => {
    const drawn = at(every.replace('mailer -> sms\n', 'mailer -> sms\napi -> |\n')).labels
    for (const k of ['resultCache', 'mailer', 'api']) expect(drawn).not.toContain(k)
    // a route that goes limiter -> db, with no edge yet
    const src = every
      .replace('route: gateway -> limiter -> api -> resultCache -> db', 'route: gateway -> limiter -> db')
      .replace('mailer -> sms\n', 'mailer -> sms\nlimiter -> |\n')
    expect(at(src).c.options.find((o) => o.label === 'db')).toMatchObject({
      detail: 'node, a route goes here',
      boost: 2,
    })
  })

  it('offer the flows that pass a queue, a box or a hop first', () => {
    expect(first(every.replace('partitions { events: 12 }', 'partitions { | }'))).toEqual(['events'])
    // a component of its own, on the database: the orders reach it
    expect(first(every.replace('held { orders: 0.05 }', 'held { | }'))).toEqual(['orders'])
    expect(first(every.replace('flows: [events]', 'flows: [|]'))).toEqual(['events'])
  })
})

describe('completions in a route through a subsystem', () => {
  const shop = `loadmap ${LANGUAGE_VERSION}
load { max: 10 }
subsystem line "Line" {
  cluster kafka "Kafka" { members: 3; queue topic {} }
  pool consumers "Consumers" { pods: 2; perPod: 2 }
  kafka -> consumers
  route: kafka -> consumers
}
flow orders { rate: 10 * load; route: gateway -> line -> db; from: users }
node users "Users"
node gateway "Gateway" { pass }
node db "DB" { store }
users -> gateway
gateway -> line
line -> db
`
  it('offer neither a subsystem after its own boxes nor its boxes after it', () => {
    const after = at(shop.replace('route: gateway -> line -> db', 'route: gateway -> line -> |')).labels
    for (const k of ['line.topic', 'line.consumers', 'line.kafka']) expect(after).not.toContain(k)
    expect(after).toContain('db')
    const inner = at(shop.replace('route: gateway -> line -> db', 'route: gateway -> line.topic -> |')).c.options
    expect(inner.map((o) => o.label)).not.toContain('line')
    // its own edge joins its boxes
    expect(inner.find((o) => o.label === 'line.consumers')).toMatchObject({ boost: 2 })
  })
})
