import { describe, expect, it } from 'vitest'
import { defineModel, lost, measured, p, pass, published, sink, workers } from '../src'
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
    expect(m.steps).toHaveLength(120)
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
      '8× in 30 s: up to 75 % of requests is lost for 100 s, until the eighth pod of the API is ready.',
    )
    // 120 steps over 630 s, each at its middle: the first at 2.625 s
    expect(m.steps[0]!.load).toBeCloseTo(1 + (7 * 2.625) / 30, 9)
    expect(m.steps.at(-1)!.ready).toEqual({ api: 12 })
  })

  it('says what the preset loses once every pod is ready', () => {
    // 1,400 a second against 1,200: 14 % for as long as it holds
    const m = moment(shop({ ready: 90, ramp: 30, to: 14 }), {}, 'Flash sale')
    expect(m.text).toBe(
      '14× in 30 s: up to 86 % of requests is lost for 100 s, until the twelfth pod of the API is ready, then 14 % as it holds.',
    )
    expect(moment(shop({ to: 14 }), {}, 'Flash sale').text).toBe(
      '14× at once: no more is lost on the way than once every pod is ready, 14 % of requests.',
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
    expect(moment(pub, {}, 'Flash sale').steps[0]!.over).toEqual([])
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
