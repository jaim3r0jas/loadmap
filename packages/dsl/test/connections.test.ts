import { type ComponentResult, defineModel, measured, p, queue, workers } from '@loadmap/core'
import { describe, expect, it } from 'vitest'
import { compile, completions, format, hover, loadCatalog, needsCatalog, quickFixes, rename } from '../src'

const SRC = `loadmap 1
load { max: 100 }
param parts "Partitions" { options: [6, 12, 16]; default: 12 }

flow orders "orders" { rate: 100 * load; from: shop; route: topic -> pool }
flow events "events" { rate: 50 * load; from: shop; route: topic -> pool }

node shop "Shop"
cluster kafka "Kafka" {
  members: 3
  queue topic { partitions { orders: parts; events: 4 } }
}
pool pool "Consumers" {
  workers { pods: 4; perPod: 4 }
  demand: (flows.orders + flows.events) * 0.01
  capacity: measured(4, "cores", "pod CPU limit")
  over: "orders wait in their topic"
}

connection group {
  hop: topic -> pool
  assign: exclusive
  capacityPer: pod
  flows: [orders]
}

shop -> kafka
kafka -> pool
`

const errors = (src: string) =>
  compile(src).diagnostics.map((d) => `${d.severity}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)
const at = (src: string) => compile(src).diagnostics.map((d) => src.slice(d.from, d.to))

describe('connections in the language', () => {
  it('draws what the TypeScript connection draws', () => {
    expect(format(SRC).text).toBe(SRC)
    const r = compile(SRC)
    expect(r.diagnostics).toEqual([])
    const ts = defineModel({
      load: p.load({ max: 100 }),
      params: { parts: p.select({ label: 'Partitions', options: [6, 12, 16], default: 12 }) },
      flows: { orders: { rate: ({ load }) => 100 * load }, events: { rate: ({ load }) => 50 * load } },
      components: {
        pool: {
          name: 'Consumers',
          demand: ({ flows }) => (flows.orders + flows.events) * 0.01,
          capacity: measured(4, 'cores', 'pod CPU limit'),
          over: 'orders wait in their topic',
        },
      },
      stages: {
        topic: queue({ partitions: ({ parts }) => ({ orders: parts as number, events: 4 }) }),
        pool: workers('pool', { pods: 4, perPod: 4 }),
      },
      routes: { orders: ['topic', 'pool'], events: ['topic', 'pool'] },
      connections: {
        group: { from: 'topic', to: 'pool', assign: 'exclusive', capacityPer: 'pod', flows: ['orders'] },
      },
    })
    const runs: { load: number; parts?: 6 | 12 | 16 }[] = [{ load: 1 }, { load: 2, parts: 6 }, { load: 3, parts: 16 }]
    for (const values of runs) {
      const a = r.definition!.model.evaluate(values)
      const b = ts.evaluate(values)
      expect(a.components.pool!.util).toBeCloseTo(b.components.pool!.util!, 12)
      expect(a.components.pool!.spread).toEqual(b.components.pool!.spread)
    }
    // 6 partitions on 4 pods read 2, 2, 1, 1: orders are 2/3 of the work, events spread evenly
    const six = r.definition!.model.evaluate({ load: 1, parts: 6 })
    expect(six.components.pool!.util).toBeCloseTo(0.375 * ((2 / 3) * (2 / 6) + 1 / 3 / 4) * 4, 12)
    expect(six.assumptions.find((a) => a.kind === 'connection')).toEqual({
      kind: 'connection',
      name: 'group',
      text: 'Each partition of topic (orders) is read by one worker of pool (exclusive). The partitions are dealt in turn to workers alternating pods: the most even case.',
    })
  })

  it('takes a hop of two stages, its words and flows the definition declares', () => {
    const swap = (from: string, to: string) => SRC.replace(from, to)
    expect(errors(swap('hop: topic -> pool', 'hop: topic'))).toEqual(['error: a hop is two stages: from -> to'])
    expect(errors(swap('hop: topic -> pool', 'hop: topic -> nowhere'))).toEqual(['error: unknown stage "nowhere"'])
    expect(errors(swap('assign: exclusive', 'assign: sticky'))).toEqual([
      'error: "sticky" is not one of shared, exclusive, key, leader',
    ])
    expect(errors(swap('flows: [orders]', 'flows: [order]'))).toEqual([
      'error: unknown flow "order" | did you mean "orders"?',
    ])
    expect(errors(swap('  hop: topic -> pool\n', ''))).toEqual([
      'error: "connection" needs "hop: …" | The two stages it joins: from -> to.',
    ])
    expect(errors(swap('connection group', 'connection pool'))).toEqual([
      'error: "pool" names a component too: give the connection its own name',
    ])
  })

  it('refuses a name every object has, a flow listed twice and an empty list', () => {
    const swap = (from: string, to: string) => SRC.replace(from, to)
    expect(errors(swap('connection group', 'connection __proto__'))).toEqual([
      'error: "__proto__" cannot be used as a name',
    ])
    expect(errors(swap('flows: [orders]', 'flows: [orders, orders]'))).toEqual(['error: "orders" is listed twice'])
    expect(errors(swap('flows: [orders]', 'flows: []'))).toEqual([
      'error: an empty list covers no flow | leave flows out for every flow on the hop',
    ])
  })

  it('is hovered, renamed and fixed like any statement', () => {
    const i = SRC.indexOf('connection group') + 'connection '.length
    expect(hover(SRC, i + 1, compile(SRC).definition)?.body).toEqual([
      'Each partition of topic (orders) is read by one worker of pool (exclusive). The partitions are dealt in turn to workers alternating pods: the most even case.',
    ])
    expect(hover(SRC, SRC.indexOf('hop:') + 1)?.head).toBe('hop: a -> b')
    const renamed = rename(SRC, i, 'consumers')
    expect('source' in renamed && renamed.source).toBe(SRC.replace('connection group', 'connection consumers'))
    expect(rename(SRC, i, 'pool')).toEqual({ error: '"pool" is taken' })
    // a missing hop: the first two stages a route joins
    const src = SRC.replace('  hop: topic -> pool\n', '')
    const [fix] = quickFixes(src, compile(src).diagnostics)[0]!
    expect(fix?.changes.map((c) => c.insert).join('')).toContain('hop: topic -> pool')
  })

  it("reads a pool's fill and a connection's max under their new names from 1.1, which fmt writes", () => {
    const v11 = SRC.replace('loadmap 1\n', 'loadmap 1.1\n')
      .replace('workers { pods: 4; perPod: 4 }', 'workers { pods: 4; perPod: 4; fill: "in-order" }')
      .replace(
        '  flows: [orders]\n}',
        '  flows: [orders]\n  open: 2\n  max: configured(100, "connections", "max.connections")\n}',
      )
    expect(errors(v11)).toEqual([
      'warning: fill is now placement | loadmap fmt rewrites it',
      'warning: max is now accepts | loadmap fmt rewrites it',
    ])
    const ev = compile(v11).definition!.model.evaluate({ load: 1 })
    expect(ev.stages.pool).toMatchObject({ placement: 'in-order' })
    // 16 workers × 2 open
    expect((ev.components as Record<string, ComponentResult>).group!.demand).toBe(32)
    const text = format(v11).text
    expect(text).toContain('workers { pods: 4; perPod: 4; placement: "in-order" }')
    expect(text).toContain('  accepts: configured(100, "connections", "max.connections")\n')
    expect(errors(text)).toEqual([])
    // a definition of 1.0 has only the old names: fmt leaves them
    const v1 = v11.replace('loadmap 1.1\n', 'loadmap 1\n')
    expect(errors(v1)).toEqual([])
    expect(format(v1).text).toBe(v1)
  })

  it('counts what a connection holds open against the most the other side accepts', () => {
    const src = SRC.replace(
      'connection group {',
      'connection brokerPool {\n  hop: topic -> pool\n  owner: pod\n  open: 3\n  max: configured(100, "connections", "max.connections")\n  flows: [events]\n}\n\nconnection group {',
    )
    expect(format(src).text).toBe(src)
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    const c = (r.definition!.model.evaluate({ load: 1 }).components as Record<string, ComponentResult>).brokerPool!
    // 4 pods × 3 connections to the brokers
    expect(c.name).toBe('Connections to topic')
    expect(c.demand).toBe(12)
    expect(c.describe).toBe('4 pods × 3 = 12 open')
    // its id is a limit's: expect and formulas read it
    const held = src.replace(
      'shop -> kafka',
      'expect "The brokers take the consumers" { component: brokerPool; full: 100 }\nlet open = demand.brokerPool\n\nshop -> kafka',
    )
    expect(errors(held)).toEqual([])
    // and a rename follows it there
    const renamed = rename(held, held.indexOf('connection brokerPool') + 'connection '.length, 'brokerLinks')
    expect('source' in renamed && renamed.source).toBe(held.replaceAll('brokerPool', 'brokerLinks'))
  })

  it("sends by key to a cluster's queue: its members by default, a hot key's share on partition 0", () => {
    const src = `loadmap 1
load { max: 100 }

flow orders "orders" { rate: 100 * load; from: shop; route: gateway -> topic }

node shop "Shop"
node gateway "Gateway" {
  pass
  capacity: estimated(100_000, "req/s")
  over: "x"
}
cluster kafka "Kafka" {
  members: 5
  queue topic { partitions { orders: 12 } }
  capacity: estimated(1_000, "orders/s")
  over: "producers wait"
}

connection produce {
  hop: gateway -> topic
  assign: key
  skew: estimated(0.25, "share", "busiest customer")
}

shop -> gateway
gateway -> kafka
`
    expect(format(src).text).toBe(src)
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    const ev = r.definition!.model.evaluate({ load: 1 })
    // 12 partitions on the cluster's 5 members; member 0 holds 0, 5 and 10, a quarter of the orders on 0
    expect(ev.components.kafka!.util).toBeCloseTo(0.1 * (0.25 + 2 * (0.75 / 11)) * 5, 12)
    const topic = ev.stages.topic!
    expect(topic.kind === 'queue' && topic.skew).toEqual({ orders: 0.25 })
  })

  it('takes a rule from the catalog: its assign and owner, its source cited', async () => {
    await loadCatalog()
    expect(needsCatalog('connection g {\n  rule: "kafka/consumer-group"\n}')).toBe(true)
    const src = SRC.replace('  assign: exclusive\n', '  rule: "kafka/consumer-group"\n')
    expect(format(src).text).toBe(src)
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    const ev = r.definition!.model.evaluate({ load: 1, parts: 6 })
    expect(ev.components.pool!.spread?.factor).toBeGreaterThan(1)
    expect((ev.assumptions.find((a) => a.kind === 'connection') as { text: string }).text).toContain(
      '(Apache Kafka: Design, the Apache Kafka project).',
    )
    expect(errors(src.replace('kafka/consumer-group', 'kafka/consumer-groups'))).toEqual([
      'error: no connection rule "kafka/consumer-groups" in the catalog | did you mean "kafka/consumer-group"?',
    ])
    const at = src.indexOf('kafka/consumer-group')
    const labels = completions(src.slice(0, at) + src.slice(at + 'kafka/consumer-group'.length), at)!.options.map(
      (o) => o.label,
    )
    expect(labels).toContain('kafka/consumer-group')
    expect(labels).toContain('valkey/cluster-slots')
    // a documented default as a connection's max
    const counted = src.replace(
      'connection group {',
      'published dbMax postgresql { edition: "2026-12"; figure: "max-connections" }\n\nconnection brokerPool {\n  hop: topic -> pool\n  owner: pod\n  open: 3\n  max: dbMax\n  flows: [events]\n}\n\nconnection group {',
    )
    expect(errors(counted)).toEqual([])
    const limit = (compile(counted).definition!.model.evaluate().components as Record<string, ComponentResult>)
      .brokerPool!
    expect(limit.capacity?.value).toBe(97)
  })

  it("puts what the model refuses on the connection's line", () => {
    const src = SRC.replace('capacityPer: pod', 'owner: pod\n  capacityPer: worker')
    expect(errors(src)).toEqual([
      'error: connection "group" divides the capacity per worker, but a pod owns each part: capacityPer is the owner or a pod',
    ])
    expect(at(src)).toEqual(['group'])
  })
})
