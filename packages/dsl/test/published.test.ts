import { beforeAll, describe, expect, it } from 'vitest'
import { compile, completions, format, hover, loadCatalog, needsCatalog, rename } from '../src'

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
