import { describe, expect, it } from 'vitest'
import { check, defineModel, headroom, measured, p, pass, published, sink, store, workers } from '../src'
import { kafka } from '../src/catalog'
import { outages } from '../src/outages'

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
    expect(ev.components.api.out).toEqual({ domain: 'zone', name: 'Availability zone', count: 3, members: 6, left: 4 })
    expect(ev.components.api.util).toBeCloseTo(all.components.api.util! * 1.5, 12)
    expect(ev.components.api.full).toBeCloseTo((all.components.api.full! * 4) / 6, 6)
    // 5 in 3 zones stand 2, 2 and 1: the zone that goes is a fullest one
    expect(ev.components.search.out).toMatchObject({ members: 5, left: 3 })
    expect(ev.components.search.util).toBeCloseTo((all.components.search.util! * 5) / 3, 12)
    // what is not across the domain is as it was
    expect(ev.components.db.util).toBe(all.components.db.util)
    expect(ev.components.db.out).toBeUndefined()
  })

  it('makes a pool with a part down a smaller pool: no pod runs in the part that is down', () => {
    const ev = shop().evaluate({ load: 1, down: 'zone' })
    expect(ev.stages.api).toMatchObject({ kind: 'workers', pods: 4, running: 4 })
  })

  it('runs as many pods of an autoscaled pool as the same work needs, of the pods left', () => {
    const m = defineModel({
      load: p.load({ max: 20 }),
      domains: { zone: { name: 'Availability zone', count: 3 } },
      flows: { req: { rate: ({ load }) => 100 * load } },
      components: {
        api: { name: 'API', across: { domain: 'zone', members: 6 }, capacity: measured(1200, 'req/s'), over: 'x' },
      },
      stages: { api: workers('api', { perPod: 2, autoscale: { min: 2, max: 6, target: 0.7 } }), out: sink() },
      routes: { req: ['api', 'out'] },
    })
    // 500 a second is 2.5 pods' worth at 200 each: at 70 %, 4 pods, one zone out or not
    for (const down of ['none', 'zone']) expect(m.evaluate({ load: 5, down }).stages.api).toMatchObject({ running: 4 })
    expect(m.evaluate({ load: 5, down: 'zone' }).stages.api).toMatchObject({ pods: 4 })
    // past what the pods left can run, it runs them all
    expect(m.evaluate({ load: 8, down: 'zone' }).stages.api).toMatchObject({ pods: 4, running: 4 })
    expect(m.evaluate({ load: 8 }).stages.api).toMatchObject({ pods: 6, running: 6 })
  })

  it('says a name that starts with an acronym as it is', () => {
    const m = defineModel({
      load: p.load({ max: 2 }),
      domains: { region: { name: 'AWS region', count: 2 } },
      flows: { a: { rate: 1 } },
      components: { c: { name: 'C', capacity: measured(1, 'x'), over: 'x' } },
      stages: { c: pass('c') },
      routes: { a: ['c'] },
    })
    const down = m.params.find((x) => x.id === 'down')!.def
    expect(down.kind === 'select' && down.format?.('region')).toBe('one AWS region out')
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

  it('answers N−1 with every part up: where the target is reached with one part out, and what limits it then', () => {
    const m = shop()
    const [n1] = outages(m, { load: 1 })
    // the API reaches the 50 % target at 4× with 4 pods of 6; Search, 3 members of 5, at 3×
    expect(n1).toMatchObject({ domain: 'zone', with: 'with one availability zone out', firstLimit: 'search' })
    expect(n1!.target!.low).toBeCloseTo(3, 6)
    expect(n1!.components.api!.low).toBeCloseTo(4, 6)
    expect(n1!.components.db!.low).toBeCloseTo(10, 6)
    expect(n1!.text).toBe(
      'With one availability zone out, the 50 % target holds up to 3×, limited by Search, which keeps 3 of 5.',
    )
    // with a part already out, the verdict is that answer
    expect(outages(m, { load: 1, down: 'zone' })).toEqual([])
  })

  it('draws N−1 in the headroom chart: the shown line with one part out', () => {
    const h = headroom(shop(), { load: 1 }, { samples: 8 })
    expect(h.lines.map((l) => [l.label, l.selected, l.outage])).toEqual([
      [null, true, undefined],
      ['With one availability zone out', false, { domain: 'zone', of: null }],
    ])
    expect(h.lines[1]!.target).toBeCloseTo(3, 6)
    expect(headroom(shop(), { load: 1, down: 'zone' }, { samples: 8 }).lines).toHaveLength(1)
  })

  it('says when nothing reaches the target with a part out, and asks only for the parts its control offers', () => {
    const quiet = defineModel({
      load: p.load({ max: 2 }),
      searchMax: 50,
      domains: { zone: { name: 'Zone', count: 3 }, rack: { name: 'Rack', count: 2 } },
      params: { down: p.select({ label: 'Out', options: ['none', 'zone'], default: 'none' }) },
      flows: { a: { rate: 1 } },
      components: {
        c: { name: 'C', across: { domain: 'zone', members: 3 }, capacity: measured(1_000, 'x'), over: 'x' },
      },
      stages: { c: pass('c') },
      routes: { a: ['c'] },
    })
    expect(outages(quiet).map((o) => [o.domain, o.text])).toEqual([
      ['zone', 'With zone down, no component reaches the 50 % target up to 50×.'],
    ])
  })

  it('shards a store over the members left, with the parts of every key connection into it', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      domains: { zone: { name: 'Zone', count: 3 } },
      flows: { a: { rate: ({ load }) => 100 * load }, b: { rate: ({ load }) => 50 * load } },
      components: {
        g1: { name: 'G1', capacity: measured(10_000, 'u/s'), over: 'x' },
        g2: { name: 'G2', capacity: measured(10_000, 'u/s'), over: 'x' },
        db: { name: 'DB', across: { domain: 'zone', members: 3 }, capacity: measured(10_000, 'u/s'), over: 'x' },
      },
      stages: { g1: pass('g1'), g2: pass('g2'), db: store('db') },
      routes: { a: ['g1', 'db'], b: ['g2', 'db'] },
      connections: {
        ka: { from: 'g1', to: 'db', assign: 'key', members: 3, parts: 6, skew: measured(0.5, 'share') },
        kb: { from: 'g2', to: 'db', assign: 'key', members: 3, parts: 4 },
      },
    })
    expect(m.evaluate({ load: 1 }).stages.db!.shards).toEqual({ members: 3, parts: { a: 6, b: 4 }, skew: { a: 0.5 } })
    // one zone out: the parts are dealt over the two members left, as the spread deals them
    expect(m.evaluate({ load: 1, down: 'zone' }).stages.db!.shards).toMatchObject({ members: 2 })
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
