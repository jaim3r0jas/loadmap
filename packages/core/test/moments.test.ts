import { describe, expect, it } from 'vitest'
import { cache, configured, defineModel, limit, lost, measured, p, pass, published, queue, sink, workers } from '../src'
import { kafka } from '../src/catalog'
import { moment } from '../src/moments'

// 100 requests a second at 1×; a pool of up to 12 pods of 100 req/s each, autoscaled at 70 %; a front on the same
// component turns away what the pool cannot take
const shop = (o: { ready?: number; ramp?: number; to?: number } = {}) =>
  defineModel({
    load: p.load({ max: 20 }),
    flows: { requests: { label: 'requests', rate: ({ load }) => 100 * load } },
    components: {
      api: {
        name: 'API',
        short: 'the API',
        demand: ({ flows }) => flows.requests,
        capacity: measured(12 * 100, 'req/s', 'load test, 12 pods'),
        over: 'x',
      },
    },
    stages: {
      front: pass('api'),
      api: workers('api', {
        autoscale: { min: 2, max: 12, target: 0.7, ...(o.ready != null ? { ready: o.ready } : {}) },
        perPod: 4,
      }),
      refused: lost({ from: ['front'] }),
      out: sink(),
    },
    routes: { requests: ['front', 'api', 'out'] },
    presets: { 'Flash sale': { load: o.to ?? 8 } },
    peaks: { 'Flash sale': 600 },
    ...(o.ramp != null ? { ramps: { 'Flash sale': o.ramp } } : {}),
  })

describe('a moment', () => {
  it('changes no steady figure', () => {
    const a = shop({ ready: 90, ramp: 30 }).evaluate({ load: 8 })
    const b = shop().evaluate({ load: 8 })
    expect(a.components.api.util).toBe(b.components.api.util)
    expect(a.lost).toEqual(b.lost)
    expect(a.stages.api).toMatchObject({ autoscale: { ready: 90 } })
  })

  it('keeps up on the way when its pods take work at once', () => {
    const m = moment(shop({ ramp: 30 }), {}, 'Flash sale')
    expect(m.text).toBe('8× in 30 s: everything keeps up on the way.')
    expect(m.lost.requests).toEqual({ units: 0, share: 0, worst: 0 })
    // 120 steps over the way up and a minute and a half, 30 for the rest
    expect(m.steps).toHaveLength(150)
  })

  it('loses what the pods not yet ready cannot take, until enough of them are', () => {
    // at 1× two pods run; at 8× twelve are wanted. With two ready the pool takes 200 of 800: 75 % is lost, until the
    // eighth pod (800 req/s) is ready
    const m = moment(shop({ ready: 90 }), {}, 'Flash sale')
    expect(m.text).toBe(
      '8× at once: up to 75 % of requests is lost for 90 s, until the twelfth pod of the API is ready.',
    )
    expect(m.lost.requests).toMatchObject({ worst: 0.75, from: 0, until: expect.closeTo(90, 6) })
    // 600 a second lost for 90 s, of 800 a second for 10 min
    expect(m.lost.requests!.units).toBeCloseTo(600 * 90, 6)
    expect(m.lost.requests!.share).toBeCloseTo((600 * 90) / (800 * 600), 9)
  })

  it('climbs over its ramp, and says which pod ends the loss', () => {
    const m = moment(shop({ ready: 90, ramp: 30 }), {}, 'Flash sale')
    expect(m.text).toBe(
      '8× in 30 s: up to 75 % of requests is lost for 103 s, until the eighth pod of the API is ready.',
    )
    // 120 steps over the ramp and twice the ready time, 210 s, each at its middle: the first at 0.875 s
    expect(m.steps[0]!.load).toBeCloseTo(1 + (7 * 0.875) / 30, 9)
    expect(m.steps.at(-1)!.ready).toEqual({ api: 12 })
  })

  it('gives a pool its whole capacity once every pod it wants is ready, short of its max', () => {
    // at 3× five pods are wanted of twelve: once they are ready nothing differs from the steady 3×
    const m = moment(shop({ ready: 90, to: 3 }), {}, 'Flash sale')
    const steady = shop().evaluate({ load: 3 })
    const last = m.steps.at(-1)!
    expect(last.ready).toEqual({ api: steady.stages.api.kind === 'workers' ? steady.stages.api.running : 0 })
    expect(last.over).toEqual([])
    expect(m.lost.requests!.until).toBeLessThanOrEqual(90)
  })

  it('says what the preset loses once every pod is ready', () => {
    // 1,400 a second against 1,200: 14 % for as long as it holds
    const m = moment(shop({ ready: 90, ramp: 30, to: 14 }), {}, 'Flash sale')
    expect(m.text).toBe(
      '14× in 30 s: up to 86 % of requests is lost for 102 s, until the twelfth pod of the API is ready, then 14 % as it holds.',
    )
    expect(moment(shop({ to: 14 }), {}, 'Flash sale').text).toBe(
      '14× at once: no more is lost on the way than as it holds, 14 % of requests.',
    )
  })

  it('never scales a published figure: a pool still starting pods has none', () => {
    const m = shop({ ready: 90 })
    const pub = defineModel({
      ...m.def,
      components: {
        api: {
          ...m.def.components.api,
          capacity: published(kafka, {
            brokers: 3,
            replication: 3,
            acks: 'all',
            messageSize: '1 KB',
            producers: 4,
            version: '4.4',
          }),
        },
      },
    } as never)
    const r = moment(pub, {}, 'Flash sale')
    expect(r.unknown).toEqual(['api'])
    expect(r.text).toBe(
      '8× at once: the API has no published benchmark while its pods start, so what is lost on the way is not known.',
    )
  })

  it('needs a preset that lasts, and a ramp only with one', () => {
    expect(() => moment(shop(), {}, 'Calm')).toThrow('preset "Calm" has no moment')
    expect(() => defineModel({ ...shop().def, peaks: undefined, ramps: { 'Flash sale': 30 } } as never)).toThrow(
      'preset "Flash sale" has a ramp, the way up to a moment: give it how long it lasts too',
    )
    expect(() => shop({ ramp: -1 })).toThrow('preset "Flash sale" ramps over -1 s')
    expect(() => shop({ ready: -1 }).evaluate({ load: 1 })).toThrow('needs a ready time from 0 seconds, not -1')
  })
})

describe('a moment that meets a cold cache, a bucket and a queue with a size', () => {
  it('warms a cold cache over its time: the loss ends while it warms', () => {
    // a cache of 90 % in front of a database of 300 a second; at 8× 800 arrive, all of them at the database at first
    const cached = (o: { warms?: number; cold?: boolean } = {}) =>
      defineModel({
        load: p.load({ max: 20 }),
        flows: { reads: { label: 'reads', rate: ({ load }) => 100 * load } },
        components: { db: { name: 'Database', short: 'the database', capacity: measured(300, 'req/s'), over: 'x' } },
        stages: {
          appCache: cache({ hit: 0.9, ...(o.warms != null ? { warms: o.warms } : {}) }),
          db: pass('db'),
          gone: lost({ from: ['db'] }),
          out: sink(),
        },
        routes: { reads: ['appCache', 'db', 'out'] },
        presets: { Sale: { load: 8 } },
        peaks: { Sale: 600 },
        ...(o.cold ? { colds: { Sale: ['appCache'] } } : {}),
      })
    const m = moment(cached({ warms: 300, cold: true }), {}, 'Sale')
    expect(m.text).toBe('8× at once: up to 62 % of reads is lost for 3 min, while the cache warms.')
    // it answers 90 % × the share warmed: past 69 % warm, 300 of 800 reach the database
    expect(m.lost.reads!.until).toBeCloseTo(207.5, 6)
    expect(m.steps.at(-1)!.warm).toEqual({ appCache: 1 })
    // warm from the start, it keeps up
    expect(moment(cached({ warms: 300 }), {}, 'Sale').text).toBe('8× at once: everything keeps up on the way.')
    expect(() => cached({ cold: true })).toThrow('starts cache "appCache" cold: give it warms')
  })

  it("spends a limit's bucket before the limit cuts in", () => {
    // a limit of 100 a second with a bucket of 500; at 6× 300 arrive, 200 above it
    const m = moment(
      defineModel({
        load: p.load({ max: 20 }),
        flows: { searches: { label: 'searches', rate: ({ load }) => 50 * load } },
        components: {
          limiter: {
            name: 'Rate limiter',
            short: 'the rate limiter',
            capacity: configured(100, 'req/s', 'gateway'),
            over: 'x',
          },
        },
        stages: { limiter: limit('limiter', { burst: 500 }), out: sink(), gone: lost({ from: ['limiter'] }) },
        routes: { searches: ['limiter', 'out'] },
        presets: { Rush: { load: 6 } },
        peaks: { Rush: 60 },
      }),
      {},
      'Rush',
    )
    expect(m.text).toBe(
      '6× at once: nothing is lost for 2.5 s, until the burst of the rate limiter is spent, then 67 % of searches as it holds.',
    )
    expect(m.steps[0]!.bucket.limiter).toBeLessThan(500)
    // what the bucket let through is not lost: 200 a second for 57.5 s
    expect(m.lost.searches!.units).toBeCloseTo(200 * 57.5, 6)
  })

  it('fills a queue with a size before it refuses anything', () => {
    // an inbox of 5,000 before runners of 200 a second; at 3× 300 arrive: full after 50 s
    const inbox = defineModel({
      load: p.load({ max: 10 }),
      flows: { jobs: { label: 'jobs', rate: ({ load }) => 100 * load } },
      components: {
        runners: {
          name: 'Runners',
          demand: ({ flows }) => flows.jobs * 0.01,
          capacity: measured(2, 'cores'),
          over: 'x',
        },
      },
      stages: {
        inbox: queue({ partitions: { jobs: 1 }, holds: 5000, label: 'the inbox' }),
        runners: workers('runners', { pods: 2, perPod: 4 }),
        refused: lost({ from: ['inbox'] }),
        out: sink(),
      },
      routes: { jobs: ['inbox', 'runners', 'out'] },
      presets: { Rush: { load: 3 } },
      peaks: { Rush: 600 },
    })
    const m = moment(inbox, {}, 'Rush')
    expect(m.text).toBe('3× at once: nothing is lost for 50 s, until the inbox is full, then 33 % of jobs as it holds.')
    expect(m.steps.at(-1)!.queued).toEqual({ inbox: 5000 })
  })
})
