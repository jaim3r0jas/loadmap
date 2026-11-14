import { type ComponentResult, defineModel, measured, p, queue, workers } from '@loadmap/core'
import { describe, expect, it } from 'vitest'
import { compile, format, hover, quickFixes, rename } from '../src'

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
      'error: "sticky" is not one of shared, exclusive',
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

  it("puts what the model refuses on the connection's line", () => {
    const src = SRC.replace('capacityPer: pod', 'owner: pod\n  capacityPer: worker')
    expect(errors(src)).toEqual([
      'error: connection "group" divides the capacity per worker, but a pod owns each part: capacityPer is the owner or a pod',
    ])
    expect(at(src)).toEqual(['group'])
  })
})
