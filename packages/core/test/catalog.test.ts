import { describe, expect, it } from 'vitest'
import { boundOf, check, defineModel, estimated, p, pass, published } from '../src'
import { CATALOG, EDITIONS, kafka, kubernetes, nginx, opensearch, postgresql, rabbitmq } from '../src/catalog'

const DAY = /^\d{4}-\d{2}-\d{2}$/

describe('the catalog', () => {
  it('names every component once, with sources, dates and conditions it declares', () => {
    for (const [id, c] of Object.entries(CATALOG.components)) {
      expect(c.id).toBe(id)
      expect(c.edition).toBe(CATALOG.edition)
      expect(new Set(c.figures.map((f) => f.id)).size).toBe(c.figures.length)
      for (const f of c.figures) {
        const at = `${id}/${f.id}`
        expect(f.value, at).toBeGreaterThan(0)
        expect(f.unit, at).not.toBe('')
        expect(f.source.url, at).toMatch(/^https:\/\//)
        expect(f.source.checked, at).toMatch(DAY)
        if (f.source.date) expect(f.source.date, at).toMatch(DAY)
        expect(f.versions.length, at).toBeGreaterThan(0)
        for (const k of Object.keys(f.when)) expect(Object.keys(c.conditions), at).toContain(k)
      }
      // two figures of one measure under the same conditions would make the choice arbitrary
      const keys = c.figures.map((f) => JSON.stringify([f.measure, f.unit, f.what, f.when]))
      expect(new Set(keys).size, id).toBe(keys.length)
    }
  })

  it('never changes a released edition', async () => {
    for (const [name, e] of Object.entries(EDITIONS))
      await expect(`${JSON.stringify(e, null, 2)}\n`).toMatchFileSnapshot(`./__snapshots__/catalog-${name}.json.snap`)
  })
})

describe('published', () => {
  const config = { brokers: 3, replication: 3, acks: 'all', messageSize: '1 KB', producers: 4 }

  it('gives the figure whose conditions all match, as a best case with its reference', () => {
    const c = published(kafka, { ...config, version: '4.4' })
    expect(c).toMatchObject({ value: 605, unit: 'MB/s', provenance: 'published', ceiling: true })
    expect(c.source).toBe('Apache Kafka, run by Confluent, 2020-08-21')
    expect(c.ref).toMatchObject({ component: 'kafka', figure: 'omb-2020', edition: '2026-11', version: '4.4' })
    expect(c.ref?.conditions.slice(0, 5)).toEqual([
      '3 brokers',
      'replication factor 3',
      'acks all',
      'message size 1 KB',
      '4 producers',
    ])
    expect(c.missing).toBeUndefined()
  })

  it('never scales a figure: another broker count has none', () => {
    const c = published(kafka, { ...config, brokers: 6 })
    expect(c.missing).toBe('for 6 brokers: the published runs use 3 brokers')
    expect(c.ref).toBeUndefined()
    expect(published(kafka, { brokers: 3 }).missing).toBe(
      'without replication factor, acks, message size and producers',
    )
  })

  it('matches the version only where a source shows it changing the figure', () => {
    // Kafka: the version is metadata
    expect(published(kafka, { ...config, version: '0.1' }).value).toBe(605)
    const q = { nodes: 1, queueType: 'quorum', protocol: 'AMQP 1.0', messageSize: '12 B', flowControl: 'raised' }
    expect(published(rabbitmq, { ...q, version: '4.0.5' }).value).toBe(83_181)
    expect(published(rabbitmq, { ...q, version: '3.13' }).missing).toBe('for version 3.13')
    expect(published(rabbitmq, q).missing).toBe('without version (runs on 4.0)')
  })

  it('reads a published table by its cells only', () => {
    const at = (cpus: number) => published(nginx, { cpus, traffic: 'HTTP', responseSize: '1 KB' })
    expect(at(16).value).toBe(972_382)
    expect(at(12).missing).toBe(
      'for 12 CPUs: the published runs use 1 CPU, 2 CPUs, 4 CPUs, 8 CPUs, 16 CPUs, 32 CPUs or 36 CPUs',
    )
  })

  it('says so for a component that publishes nothing, or no capacity', () => {
    expect(published(postgresql).missing).toBe('(nothing is published for PostgreSQL with its conditions)')
    expect(published(opensearch, { nodes: 1, workload: 'Big5', version: '3.3' }).missing).toBe(
      '(OpenSearch has a published latency, not a capacity)',
    )
  })

  it('takes a documented limit as exact, and refuses what a component does not have', () => {
    expect(published(kubernetes, { figure: 'pods-per-node' })).toMatchObject({ value: 110, unit: 'pods' })
    expect(published(kubernetes).ceiling).toBeUndefined()
    expect(() => published(kubernetes, { margin: 0.2 })).toThrow(/documented limit: exact/)
    expect(() => published(kafka, { partitions: 12 })).toThrow('Apache Kafka has no condition "partitions"')
    // acks 1 is the run's "1"
    expect(published(kafka, { brokers: 3, replication: 3, acks: 1, messageSize: '100 B', producers: 1 }).value).toBe(
      75.1,
    )
    expect(() => {
      ;(kafka.figures[0] as { value: number }).value = 1
    }).toThrow()
    expect(() => published(kafka, { figure: 'x' })).toThrow(/no figure "x"/)
  })

  it('lowers a best case by its margin, never raises it', () => {
    const c = published(kafka, { ...config, margin: 0.3 })
    expect(boundOf(c, 'low')).toBeCloseTo(423.5)
    expect(boundOf(c, 'high')).toBe(605)
  })
})

describe('a model with a published capacity', () => {
  const model = (brokers: number) =>
    defineModel({
      load: p.load({ max: 100 }),
      params: { brokers: p.select({ label: 'Brokers', options: [3, 6] as number[], default: brokers }) },
      flows: { events: { rate: ({ load }: any) => 150 * load } },
      components: {
        brokers: {
          name: 'Brokers',
          short: 'the brokers',
          plural: true,
          demand: ({ flows }: any) => flows.events,
          capacity: ({ brokers }: any) =>
            published(kafka, { brokers, replication: 3, acks: 'all', messageSize: '1 KB', producers: 4 }),
          over: 'producers wait',
        },
        workers: {
          name: 'Workers',
          short: 'the workers',
          plural: true,
          demand: ({ flows }: any) => flows.events,
          capacity: estimated(750, 'MB/s'),
          over: 'a backlog grows',
        },
      },
      stages: { brokers: pass('brokers') },
      routes: { events: ['brokers'] },
      expect: [{ target: 1.5 }],
    } as any)

  it('ranks it and says it is published', () => {
    const ev = model(3).evaluate()
    expect(ev.firstLimit?.id).toBe('brokers')
    expect(ev.verdict.text).toContain('the brokers are the first limit (capacity published, a best case)')
    expect(ev.assumptions[0]).toMatchObject({ kind: 'capacity', capacity: { provenance: 'published', value: 605 } })
    expect(check(model(3))[0]!.ok).toBe(true)
  })

  it('leaves it out of the ranking without a published figure, and says why', () => {
    const ev = model(6).evaluate()
    expect(ev.components.brokers!).toMatchObject({
      util: null,
      state: 'off',
      missing: 'for 6 brokers: the published runs use 3 brokers',
    })
    expect(ev.components.brokers!.capacity?.missing).toBeDefined()
    expect(ev.firstLimit?.id).toBe('workers')
    expect(ev.verdict.tier).toBe('warn')
    expect(ev.verdict.text).toMatch(
      /The brokers have no published benchmark for 6 brokers: the published runs use 3 brokers, so they are not ranked\.$/,
    )
    expect(check(model(6))[0]).toMatchObject({
      ok: false,
      message:
        'the brokers have no published benchmark for 6 brokers: the published runs use 3 brokers; among the rest, the 50 % target holds up to 2.5×, limited by the workers (capacity estimated)',
    })
  })
})
