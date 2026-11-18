import { beforeAll, describe, expect, it } from 'vitest'
import { compile, format, hover, loadCatalog, loadedCatalog, needsCatalog, rename } from '../src'
import { addPublished, catalogBox, catalogStage } from '../src/add'
import { completions } from '../src/completion'
import { edit, inspect } from '../src/internal'

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
      'error: no catalog edition "2030-01" | this loadmap has 2026-11, 2026-12, 2027-01; a later edition needs a later loadmap',
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
    expect(labels(swap('edition: "2026-11"', 'edition: |'))).toEqual(['2027-01', '2026-12', '2026-11'])
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
    // a stream is a cluster with a queue, as many members as the run's brokers, its demand at the run's message size:
    // in MB, as a file from before sizes (loadmap 1.2) counts it
    expect(r.source).toContain(
      'cluster kafka "Apache Kafka" {\n  members: 3\n  queue { partitions {} }\n  # each unit at the size its published run used (1KB), in MB/s\n  demand: at.kafka * 0.001\n',
    )
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
  describe('a new box runs the stage its kind needs, and goes on routes', () => {
    const latest = () => {
      const e = loadedCatalog()!
      return e[Object.keys(e).at(-1)!]!.components
    }
    const kc = { brokers: 3, replication: 3, acks: 'all', messageSize: '1 KB', producers: 4 }
    const shop = `loadmap 1.5
load { max: 10 }
flow orders "orders" { from: phones; rate: 100 * load; route: gateway -> consumers }
flow pings "pings" { from: phones; rate: 10 * load; route: gateway }
node phones "Phones"
node gateway "Gateway" { pass; capacity: estimated(1000, "req/s"); over: "x" }
pool consumers "Consumers" { pods: 2; perPod: 4; capacity: estimated(1000, "req/s"); over: "y" }
phones -> gateway
gateway -> consumers
`
    const added = (r: ReturnType<typeof addPublished>) => {
      if ('error' in r) throw new Error(r.error)
      return r
    }
    const errors = (src: string) => compile(src).diagnostics.filter((d) => d.severity === 'error')

    it("draws every component in the box its kind's stage lives in", () => {
      for (const c of Object.values(latest())) expect(catalogBox(c).box, c.id).toBe(c.box)
    })

    it("runs a store where every route ends at it, a pass where one goes on, its kind's stage otherwise", () => {
      const db = latest().cockroachdb!
      expect([catalogStage(db, []), catalogStage(db, [true, true]), catalogStage(db, [true, false])]).toEqual([
        'store',
        'store',
        'pass',
      ])
      expect(catalogStage(latest().kafka!, [false])).toBe('queue')
      expect(catalogStage(latest().kubernetes!, [])).toBeUndefined()
    })

    it('puts a Kafka topic between two stages: route, edges, partitions, the consumer group, bytes in MB/s', () => {
      const r = added(
        addPublished(shop, {
          component: latest().kafka!,
          conditions: kc,
          into: 'new',
          use: { routes: [{ flow: 'orders', at: 1 }], partitions: 12, rule: 'kafka/consumer-group' },
        }),
      )
      expect(r.source).toContain('route: gateway -> kafka -> consumers }')
      expect(r.source).toContain(
        'cluster kafka "Apache Kafka" {\n  members: 3\n  queue { partitions { orders: 12 } }\n  # each unit at the size its published run used, as MB/s\n  demand: at.kafka * 1KB\n  capacity: kafkaFigure\n',
      )
      expect(r.source).toContain(
        'connection kafkaConsumers {\n  hop: kafka -> consumers\n  rule: "kafka/consumer-group"\n}',
      )
      // the hop it now stands in is taken by no route: its edge goes, and the new ones follow the box
      expect(r.source).toContain('phones -> gateway\n\npublished kafkaFigure')
      expect(r.source).not.toContain('gateway -> consumers\n')
      expect(r.source.endsWith('}\n\ngateway -> kafka\nkafka -> consumers\n')).toBe(true)
      expect(errors(r.source)).toEqual([])
      expect(format(r.source).text).toBe(r.source)
      // 100 orders a second of 1 KB: 0.1 MB/s against the published 605
      const kafka = compile(r.source).definition!.model.evaluate().components.kafka!
      expect(kafka.demand).toBeCloseTo(0.1)
      expect(kafka.capacity).toMatchObject({ value: 605, unit: 'MB/s', provenance: 'published' })
    })

    it('keeps an edge another flow still takes, and starts a route at its source', () => {
      const r = added(
        addPublished(shop, {
          component: latest().kafka!,
          conditions: kc,
          into: 'new',
          use: { routes: [{ flow: 'orders', at: 0 }] },
        }),
      )
      expect(r.source).toContain('route: kafka -> gateway -> consumers }')
      expect(r.source).toContain('phones -> gateway\ngateway -> consumers\n')
      expect(r.source).toContain('  over: "past its published capacity"\n}\n\nphones -> kafka\nkafka -> gateway\n')
      expect(r.source).toContain('queue { partitions { orders: 1 } }')
      expect(errors(r.source)).toEqual([])
    })

    it('keeps comments with the lines they are on', () => {
      const commented = shop.replace(
        'phones -> gateway\ngateway -> consumers\n',
        'phones -> gateway # https\ngateway -> consumers # async\nnode spare "Spare"\n',
      )
      const r = added(
        addPublished(commented, {
          component: latest().kafka!,
          conditions: kc,
          into: 'new',
          use: { routes: [{ flow: 'orders', at: 1 }] },
        }),
      )
      // the edge it replaces goes with its comment; the new ones after the last edge's comment
      expect(r.source).toContain(
        'phones -> gateway # https\ngateway -> kafka\nkafka -> consumers\nnode spare "Spare"\n',
      )
      expect(r.source).not.toContain('# async')
    })

    it('a cache answers its hit ratio; a database stores where a route ends and passes in its middle', () => {
      const cache = added(
        addPublished(shop, {
          component: latest().valkey!,
          conditions: {},
          into: 'new',
          use: { hit: 0.9, routes: [{ flow: 'orders', at: 1 }] },
        }),
      )
      expect(cache.source).toContain('node valkey "Valkey" {\n  cache { hit: 0.9 }\n  capacity: valkeyFigure\n')
      expect(errors(cache.source)).toEqual([])
      const db = latest().cockroachdb!
      const end = added(
        addPublished(shop, {
          component: db,
          conditions: { nodes: 3, warehouses: 1000 },
          into: 'new',
          use: { routes: [{ flow: 'orders', at: 2 }], worth: 60 },
        }),
      )
      expect(end.source).toContain(
        'node cockroachdb "CockroachDB" {\n  shape: cylinder\n  store\n  # what one unit a second reaching it is worth, in tpmC\n  demand: at.cockroachdb * 60\n',
      )
      expect(errors(end.source)).toEqual([])
      const middle = added(
        addPublished(shop, {
          component: db,
          conditions: { nodes: 3, warehouses: 1000 },
          into: 'new',
          use: { routes: [{ flow: 'orders', at: 1 }] },
        }),
      )
      expect(middle.source).toContain('  shape: cylinder\n  pass\n')
      // the stage asked for, of the ones its kind runs
      const asked = added(
        addPublished(shop, {
          component: db,
          conditions: {},
          into: 'new',
          use: { stage: 'store', routes: [{ flow: 'orders', at: 1 }] },
        }),
      )
      expect(asked.source).toContain('  shape: cylinder\n  store\n')
    })

    it("writes the demand in the unit of the figure picked, a documented default's too", () => {
      const r = added(
        addPublished(shop, { component: latest().postgresql!, conditions: {}, figure: 'max-connections', into: 'new' }),
      )
      expect(r.source).toContain(
        '# what one unit a second reaching it is worth, in connections\n  demand: at.postgresql * 1\n',
      )
    })

    it('without routes, a box of its kind that no flow passes yet; a platform runs no stage', () => {
      const q = added(addPublished(shop, { component: latest().rabbitmq!, conditions: { nodes: 1 }, into: 'new' }))
      expect(q.source).toContain(
        'cluster rabbitmq "RabbitMQ" {\n  members: 1\n  queue { partitions {} }\n  demand: at.rabbitmq\n',
      )
      const k = added(addPublished(shop, { component: latest().kubernetes!, conditions: {}, into: 'new' }))
      expect(k.source).toContain('node kubernetes "Kubernetes" {\n  # what reaches it, in')
      expect(k.source).toContain('  demand: 0\n')
    })

    it('refuses what it cannot write, and says why', () => {
      const kafka = latest().kafka!
      const pick = (use: object) => addPublished(shop, { component: kafka, conditions: kc, into: 'new', use })
      expect(pick({ routes: [{ flow: 'nope', at: 0 }] })).toEqual({ error: 'no flow "nope"' })
      expect(pick({ routes: [{ flow: 'orders', at: 3 }] })).toEqual({ error: '"orders" has no place 3 on its route' })
      expect(pick({ stage: 'cache' })).toEqual({ error: 'Apache Kafka runs queue, not cache' })
      expect(pick({ rule: 'kafka/nope' })).toEqual({ error: 'Apache Kafka has no connection rule "kafka/nope"' })
      expect(pick({ id: 'gateway' })).toEqual({ error: 'the text has a "gateway" already' })
      expect(pick({ id: '9x' })).toEqual({ error: '"9x" is no id: letters, digits and _' })
      expect(pick({ rule: 'kafka/consumer-group', routes: [{ flow: 'orders', at: 2 }] })).toEqual({
        error: 'a connection rule needs a pool right after it on a route',
      })
      expect(addPublished(shop, { component: kafka, conditions: { ack: 'all' }, into: 'new' })).toEqual({
        error: 'Apache Kafka has no condition "ack": brokers, replication, acks, messageSize, producers',
      })
      const valkey = addPublished(shop, { component: latest().valkey!, conditions: {}, into: 'new', use: { hit: 2 } })
      expect(valkey).toEqual({ error: 'a hit ratio is a share from 0 to 1' })
      const k8s = addPublished(shop, {
        component: latest().kubernetes!,
        conditions: {},
        into: 'new',
        use: { routes: [{ flow: 'orders', at: 1 }] },
      })
      expect(k8s).toEqual({ error: 'Kubernetes runs no stage: no flow can pass it' })
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
