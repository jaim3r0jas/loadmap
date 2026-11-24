import { describe, expect, it } from 'vitest'
import { check, defineModel, measured, p, pass, published, sink, store, workers } from '../src'
import { kafka } from '../src/catalog'

const figure = published(kafka, { brokers: 3, replication: 3, acks: 'all', messageSize: '1 KB', producers: 4 })

// 100 a second at 1×: 6 API pods across 3 zones, 5 search members, a database in one place
const shop = (o: { brokers?: true } = {}) =>
  defineModel({
    load: p.load({ max: 20 }),
    domains: { zone: { name: 'Availability zone', count: 3 } },
    flows: { req: { rate: ({ load }) => 100 * load } },
    components: {
      api: { name: 'API', across: { domain: 'zone', members: 6 }, capacity: measured(1200, 'req/s'), over: 'x' },
      search: {
        name: 'Search',
        across: { domain: 'zone', members: 5 },
        capacity: o.brokers ? figure : measured(1000, 'req/s'),
        over: 'x',
      },
      db: { name: 'Database', capacity: measured(2000, 'req/s'), over: 'x' },
    },
    stages: {
      api: workers('api', { pods: 6, perPod: 2 }),
      search: pass('search'),
      db: store('db'),
      out: sink(),
    },
    routes: { req: ['api', 'search', 'db', 'out'] },
  })

describe('a failure domain', () => {
  it('gives the model an Outage control', () => {
    const down = shop().params.find((x) => x.id === 'down')!.def
    expect(down).toMatchObject({ kind: 'select', label: 'Outage', options: ['none', 'zone'], default: 'none' })
    expect(down.kind === 'select' && down.format?.('zone')).toBe('one availability zone out')
    expect(shop().evaluate({}).components.api.out).toBeUndefined()
  })

  it('takes the members of the fullest part out: the rest carry the work', () => {
    const m = shop()
    const all = m.evaluate({ load: 1 })
    const ev = m.evaluate({ load: 1, down: 'zone' })
    // 6 pods in 3 zones lose 2: 4 left, so 6 ÷ 4 = 1.5 times the utilization
    expect(ev.components.api.out).toEqual({ domain: 'zone', name: 'Availability zone', members: 6, left: 4 })
    expect(ev.components.api.util).toBeCloseTo(all.components.api.util! * 1.5, 12)
    expect(ev.components.api.full).toBeCloseTo((all.components.api.full! * 4) / 6, 6)
    // 5 in 3 zones stand 2, 2 and 1: the zone that goes is a fullest one
    expect(ev.components.search.out).toMatchObject({ members: 5, left: 3 })
    expect(ev.components.search.util).toBeCloseTo((all.components.search.util! * 5) / 3, 12)
    // what is not across the domain is as it was
    expect(ev.components.db.util).toBe(all.components.db.util)
    expect(ev.components.db.out).toBeUndefined()
  })

  it('runs no pod in the part that is down', () => {
    const ev = shop().evaluate({ load: 1, down: 'zone' })
    expect(ev.stages.api).toMatchObject({ kind: 'workers', pods: 6, running: 4 })
  })

  it('leaves a published figure without a benchmark: its run had every member', () => {
    const ev = shop({ brokers: true }).evaluate({ load: 1, down: 'zone' })
    expect(ev.components.search.util).toBeNull()
    expect(ev.components.search.missing).toBe('with one availability zone out')
    expect(ev.verdict.text).toContain('has no published benchmark with one availability zone out')
    expect(shop({ brokers: true }).evaluate({ load: 1 }).components.search.missing).toBeUndefined()
  })

  it('is what an expectation with down checks', () => {
    const m = shop()
    // with a zone out the API is full at 12 × 4 ÷ 6 = 8×
    const [holds, fails] = check(m, [
      { label: 'N−1 at 7×', down: 'zone', component: 'api', notFull: 7 },
      { label: 'N−1 at 9×', down: 'zone', component: 'api', notFull: 9 },
    ])
    expect(holds!.outcome).toBe('pass')
    expect(fails!.outcome).toBe('fail')
    expect(() => check(m, [{ down: 'region', notFull: 2 }])).toThrow('no domain "region"')
  })

  it('is checked', () => {
    const def = (o: object) => () =>
      defineModel({
        load: p.load({ max: 2 }),
        flows: { a: { rate: 1 } },
        components: { c: { name: 'C', capacity: measured(1, 'x'), over: 'x' } },
        stages: { c: pass('c') },
        routes: { a: ['c'] },
        ...o,
      })
    expect(def({ domains: { zone: { name: 'Zone', count: 1 } } })).toThrow('from 2 up')
    expect(
      def({
        components: { c: { name: 'C', across: { domain: 'rack', members: 2 }, capacity: measured(1, 'x'), over: 'x' } },
      }),
    ).toThrow('unknown domain "rack"')
    expect(
      def({
        domains: { zone: { name: 'Zone', count: 2 } },
        params: { down: p.select({ label: 'Out', options: ['none', 'rack'], default: 'none' }) },
      }),
    ).toThrow('parameter "down" takes "none" and the ids of the domains')
  })
})
