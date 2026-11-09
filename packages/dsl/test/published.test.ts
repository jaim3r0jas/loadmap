import { beforeAll, describe, expect, it } from 'vitest'
import { compile, completions, format, hover, loadCatalog, loadedCatalog, needsCatalog, rename } from '../src'
import { addPublished, edit, inspect } from '../src/internal'

const SRC = `loadmap 1
title: "Events"
load { max: 20 }
param brokers "Brokers" { options: [3, 6]; default: 3 }

published brokersRef kafka {
  edition: "2026-11"
  version: "4.4"
  brokers: brokers
  replication: 3
  acks: "all"
  messageSize: "1 KB"
  producers: 4
}

flow events "events" { unit: "MB"; from: producers; rate: 150 * load; route: kafka }

node producers "Producers"
cluster kafka "Brokers" {
  members: brokers
  queue topic { partitions { events: 12 } }
  short: "the brokers"
  plural: true
  demand: flows.events
  capacity: brokersRef
  over: "producers wait"
}

producers -> kafka
`

const errors = (src: string) =>
  compile(src).diagnostics.map((d) => `${d.severity}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)
const swap = (a: string, b: string) => SRC.replace(a, b)

describe('published', () => {
  it('waits for the catalog: a text that names it says so until it is loaded', async () => {
    expect(needsCatalog(SRC)).toBe(true)
    expect(needsCatalog('loadmap 1\n# published in a comment\nload { max: 2 }')).toBe(false)
    expect(needsCatalog('loadmap 1; published x kafka { edition: "2026-11" }')).toBe(true)
    expect(errors(SRC)).toContain(
      'error: the component catalog is not loaded | a host awaits loadCatalog() before it compiles',
    )
    await loadCatalog()
    expect(errors(SRC)).toEqual([])
  })
})

describe('a published statement', () => {
  beforeAll(() => loadCatalog())

  it('is a capacity: the figure for the defaults, and none for a configuration no run matches', () => {
    const r = compile(SRC)
    expect(r.ok).toBe(true)
    const m = r.definition!.model
    const three = m.evaluate()
    expect(three.components.kafka!.capacity).toMatchObject({ value: 605, unit: 'MB/s', provenance: 'published' })
    expect(three.verdict.text).toContain('the brokers are the first limit (capacity published, a best case)')
    const six = m.evaluate({ brokers: 6 } as never)
    expect(six.components.kafka!.missing).toBe('for 6 brokers: the published runs use 3 brokers')
    expect(six.verdict.text).toContain('The brokers have no published benchmark for 6 brokers')
  })

  it('warns when the conditions written match no run', () => {
    expect(errors(swap('replication: 3', 'replication: 2').replace('brokers: brokers', 'brokers: 3'))).toEqual([
      'warning: no published benchmark for replication factor 2: the published runs use replication factor 3 | the component is not ranked',
    ])
  })

  it('names what is wrong: a component, a condition, an edition, a figure, a margin', () => {
    expect(errors(swap('brokersRef kafka {', 'brokersRef redis {'))).toContain(
      'error: no component "redis" in the catalog | valkey (Valkey) covers redis',
    )
    expect(errors(swap('  acks: "all"', '  ack: "all"'))[0]).toBe(
      'error: Apache Kafka has no condition "ack" | did you mean "acks"?',
    )
    expect(errors(swap('edition: "2026-11"', 'edition: "2030-01"'))[0]).toBe(
      'error: no catalog edition "2030-01" | this loadmap has 2026-11; a later edition needs a later loadmap',
    )
    expect(errors(swap('producers: 4', 'producers: 4\n  figure: "x"'))[0]).toMatch(
      /^error: Apache Kafka has no figure "x"/,
    )
    expect(
      errors(
        SRC.replace('brokersRef kafka {', 'brokersRef kubernetes {')
          .replace(/ {2}(brokers|replication|acks|messageSize|producers): .*\n/g, '')
          .replace('version: "4.4"', 'margin: 0.2'),
      )[0],
    ).toBe('error: Kubernetes has documented limits: exact, so they take no margin')
    expect(errors(swap('producers: 4', 'producers: 4\n  margin: 2'))[0]).toBe(
      'error: margin is a share from 0 to below 1: 0.3 is 30 %',
    )
    expect(errors(swap('  edition: "2026-11"\n', ''))[0]).toMatch(/^error: "published" needs "edition: …"/)
  })

  it('formats as it is written, and renames its id with the capacity that reads it', () => {
    expect(format(SRC).text).toBe(SRC)
    const at = SRC.indexOf('brokersRef')
    const r = rename(SRC, at, 'kafkaFigure')
    expect('source' in r && r.source.match(/kafkaFigure/g)?.length).toBe(2)
  })

  it('completes components, their conditions, the values of their runs, editions and the id as a capacity', () => {
    const at = (src: string) => {
      const i = src.indexOf('|')
      return completions(src.slice(0, i) + src.slice(i + 1), i).options
    }
    const labels = (src: string) => at(src).map((o) => o.label)
    expect(labels(swap('brokersRef kafka {', 'brokersRef k| {'))).toContain('kafka')
    expect(labels(swap('  brokers: brokers\n', '  |\n'))).toEqual(['figure', 'margin', 'brokers'])
    expect(labels(swap('  acks: "all"', '  acks: |'))).toEqual(expect.arrayContaining(['all', '1']))
    expect(at(swap('  acks: "all"', '  acks: |')).find((o) => o.label === 'all')?.apply).toBe('"all"')
    expect(labels(swap('edition: "2026-11"', 'edition: |'))).toEqual(['2026-11'])
    expect(at(swap('  capacity: brokersRef', '  capacity: |')).find((o) => o.label === 'brokersRef')).toMatchObject({
      detail: 'published',
      boost: 3,
    })
  })

  it('hovers with the figure, its conditions and its source', () => {
    const r = compile(SRC)
    const h = hover(SRC, SRC.indexOf('capacity: brokersRef') + 12, r.definition)!
    expect(h.body.join('\n')).toContain('605 MB/s at the defaults: Apache Kafka, peak throughput')
    expect(h.body.join('\n')).toContain('(https://www.confluent.io/blog/kafka-fastest-messaging-system/)')
    const c = hover(SRC, SRC.indexOf('kafka {') + 2, r.definition)!
    expect(c.head).toBe('Apache Kafka')
    const k = hover(SRC, SRC.indexOf('messageSize') + 2, r.definition)!
    expect(k.body.join('\n')).toContain('Published runs: message size 1 KB, message size 100 B.')
  })
})

describe('the catalog picker', () => {
  beforeAll(() => loadCatalog())
  const kafka = () => loadedCatalog()!['2026-11']!.components.kafka!
  const conditions = { brokers: 3, replication: 3, acks: 'all', messageSize: '1 KB', producers: 4 }
  const base = `loadmap 1
load { max: 10 }
flow events "events" { from: producers; rate: 100 * load; route: workers }
node producers "Producers"
node workers "Workers" { pass; demand: flows.events; capacity: estimated(900, "MB/s"); over: "a backlog grows" }
producers -> workers
`

  it('adds a published statement and a box that uses it, with ids the text does not have', () => {
    const r = addPublished(base, { component: kafka(), conditions, version: '4.4', into: 'new' })
    if ('error' in r) throw new Error(r.error)
    expect(r).toMatchObject({ id: 'kafkaFigure', box: 'kafka' })
    expect(r.source).toContain(
      'published kafkaFigure kafka {\n  edition: "2026-11"\n  version: "4.4"\n  brokers: 3\n  replication: 3\n  acks: "all"\n  messageSize: "1 KB"\n  producers: 4\n}',
    )
    expect(r.source).toContain('node kafka "Apache Kafka" {\n  # what reaches it')
    const def = compile(r.source).definition!
    expect(def.model.evaluate().components.kafka!.capacity).toMatchObject({ value: 605, provenance: 'published' })
    // again: new ids
    const again = addPublished(r.source, { component: kafka(), conditions, into: 'new' })
    expect(again).toMatchObject({ id: 'kafkaFigure2', box: 'kafka2' })
  })

  it("sets a box's capacity to it, and the inspector shows its conditions as the values its runs used", () => {
    const r = addPublished(base, { component: kafka(), conditions, into: { box: 'workers' } })
    if ('error' in r) throw new Error(r.error)
    expect(r.source).toContain('capacity: kafkaFigure; over')
    const i = inspect(r.source, { node: 'workers' })!
    const s = i.sections.find((x) => x.keyword === 'published')!
    expect(s.title).toBe('Apache Kafka, published (kafkaFigure)')
    expect(s.fields.find((f) => f.label === 'Acks')).toMatchObject({
      kind: 'choice',
      value: 'all',
      choices: ['all', '1'],
    })
    const changed = edit(r.source, s.fields.find((f) => f.label === 'Message size')!.key, '100 B')
    expect('source' in changed && changed.source).toContain('messageSize: "100 B"')
    expect(addPublished(base, { component: kafka(), conditions, into: { box: 'nope' } })).toEqual({
      error: 'no box "nope"',
    })
    // a box with no body, last in the text: its new lines stay on it
    const bare = `${base}node cache "Cache"\n`
    const r2 = addPublished(bare, { component: kafka(), conditions, into: { box: 'cache' } })
    if ('error' in r2) throw new Error(r2.error)
    expect(r2.source).toContain(
      'node cache "Cache" {\n  demand: 0\n  capacity: kafkaFigure\n  over: "past its published capacity"\n}\n\npublished',
    )
    // a figure in another unit than the box's capacity is refused
    const msgs = base.replace('estimated(900, "MB/s")', 'estimated(900, "msg/s")')
    expect(addPublished(msgs, { component: kafka(), conditions, into: { box: 'workers' } })).toEqual({
      error: "workers's capacity is in msg/s, Apache Kafka's figure in MB/s",
    })
  })
})

it('takes a constant demand, as the picker writes for a new box', () => {
  const src = (d: string) => `loadmap 1
load { max: 10 }
flow events "events" { from: p; rate: 100 * load; route: w }
node p "P"
node w "W" { pass; demand: flows.events; capacity: estimated(900, "MB/s"); over: "x" }
node k "K" { demand: ${d}; capacity: estimated(10, "MB/s"); over: "y" }
p -> w
`
  for (const [d, util] of [
    ['5', 0.5],
    ['0', 0],
  ] as const) {
    const r = compile(src(d))
    expect(r.diagnostics, d).toEqual([])
    expect(r.definition!.model.evaluate().components.k!.util).toBe(util)
  }
})
