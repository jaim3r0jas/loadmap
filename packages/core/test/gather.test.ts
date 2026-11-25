import { describe, expect, it } from 'vitest'
import { check, defineModel, gather, lost, measured, p, pass, sink } from '../src'

// 100 reads a second at 1×: the API, then eight calls at once to the shards, then the page is rendered
const shop = (o: { cap?: number; fails?: number; needs?: number; calls?: number } = {}) =>
  defineModel({
    load: p.load({ max: 10 }),
    flows: { reads: { label: 'reads', rate: ({ load }) => 100 * load } },
    components: {
      api: { name: 'API', capacity: measured(10_000, 'req/s'), service: 0.002, over: 'x' },
      shards: {
        name: 'Shards',
        capacity: measured(o.cap ?? 4_000, 'req/s'),
        service: 0.01,
        ...(o.fails ? { fails: o.fails } : {}),
        over: 'x',
      },
      render: { name: 'Render', capacity: measured(10_000, 'req/s'), service: 0.003, over: 'x' },
    },
    stages: {
      api: pass('api'),
      scatter: gather({ to: [{ stage: 'shards', share: o.calls ?? 8 }], ...(o.needs ? { needs: o.needs } : {}) }),
      shards: pass('shards'),
      render: pass('render'),
      gone: lost({ from: ['scatter'] }),
      out: sink(),
    },
    routes: { reads: ['api', 'scatter', 'render', 'out'] },
  })

/** 1/a + … + 1/b */
const harmonic = (a: number, b: number) => {
  let s = 0
  for (let i = a; i <= b; i++) s += 1 / i
  return s
}
/** Fewer than `needs` of `n` calls answer, each lost with share q. */
const tooFew = (n: number, needs: number, q: number) => {
  let total = 0
  let ways = 1
  for (let j = 0; j < needs; j++) {
    total += ways * (1 - q) ** j * q ** (n - j)
    ways = (ways * (n - j)) / (j + 1)
  }
  return total
}

describe('a gather', () => {
  it('sends its stage every call, and goes on along the route', () => {
    const ev = shop().evaluate({ load: 1 })
    expect(ev.at.shards.reads).toBeCloseTo(800, 9)
    expect(ev.at.render.reads).toBeCloseTo(100, 9)
    expect(ev.components.shards.util).toBeCloseTo(0.2, 12)
    // the shards run out at 5×, where the 100 reads are 4,000 calls
    expect(ev.components.shards.full).toBeCloseTo(5, 6)
    expect(ev.stages.scatter).toMatchObject({
      kind: 'gather',
      to: { reads: [{ stage: 'shards', stages: ['shards'], share: 8 }] },
      failing: { reads: 0 },
    })
  })

  it('makes the unit wait for the slowest call it needs', () => {
    // a call takes 12.5 ms at 20 %: the last of 8 answers after 12.5 ms × (1 + 1/2 + … + 1/8)
    const w = 0.01 / (1 - 0.2)
    const own = 0.002 / (1 - 0.01) + 0.003 / (1 - 0.01)
    expect(shop().evaluate({ load: 1 }).latency.reads!.mean).toBeCloseTo(own + w * harmonic(1, 8), 12)
    // needing 6 of them, the sixth: 1/8 + … + 1/3
    expect(shop({ needs: 6 }).evaluate({ load: 1 }).latency.reads!.mean).toBeCloseTo(own + w * harmonic(3, 8), 12)
    // one call is one call
    expect(shop({ calls: 1 }).evaluate({ load: 1 }).latency.reads!.mean).toBeCloseTo(own + 0.01 / (1 - 0.025), 12)
  })

  it('fails the unit when too few of its calls answer: a loss at the gather', () => {
    // the shards fail 1 % of their calls: 7.7 % of the reads that need all eight
    const ev = shop({ fails: 0.01 }).evaluate({ load: 1 })
    expect(ev.stages.scatter).toMatchObject({ failing: { reads: expect.closeTo(1 - 0.99 ** 8, 12) } })
    expect(ev.lost.reads).toEqual({
      rate: expect.closeTo(100 * (1 - 0.99 ** 8), 9),
      share: expect.closeTo(1 - 0.99 ** 8, 12),
      causes: [{ stage: 'scatter', loss: 'failed', rate: expect.closeTo(100 * (1 - 0.99 ** 8), 9) }],
    })
    expect(ev.at.gone.reads).toBeCloseTo(100 * (1 - 0.99 ** 8), 9)
    // needing six of eight forgives two: with a tenth failing, 3.8 %
    expect(shop({ fails: 0.1, needs: 6 }).evaluate({ load: 1 }).lost.reads.share).toBeCloseTo(tooFew(8, 6, 0.1), 12)
    // past capacity it is worse: shards that take half their calls answer all eight once in 256
    expect(shop({ cap: 400 }).evaluate({ load: 1 }).lost.reads.share).toBeCloseTo(1 - 0.5 ** 8, 9)
    expect(check(shop({ fails: 0.01 }), [{ flow: 'reads', lost: 0.05 }])[0]!.message).toBe(
      'expected at most 5 % of reads lost, but 7.7 % is lost at 1×, most of it failed at scatter',
    )
  })

  it('lets on the units that did not fail there, and times a delay on its edge once', () => {
    // a tenth of the calls failing, all eight needed: 43 of 100 reads reach the stage after it
    const ev = shop({ fails: 0.1 }).evaluate({ load: 1 })
    expect(ev.at.render.reads).toBeCloseTo(100 * 0.9 ** 8, 9)
    expect(ev.components.render.util).toBeCloseTo((100 * 0.9 ** 8) / 10_000, 12)
    // 50 ms to reach the shards: every call takes it, so the read waits 50 ms and the slowest of eight answers
    const base = shop()
    const far = defineModel({ ...base.def, delays: [{ from: 'scatter', to: 'shards', delay: 0.05 }] } as never)
    const w = 0.01 / (1 - 0.2)
    const own = 0.002 / (1 - 0.01) + 0.003 / (1 - 0.01)
    expect(far.evaluate({ load: 1 }).latency.reads!.mean).toBeCloseTo(own + 0.05 + w * harmonic(1, 8), 12)
  })

  it('is for the flows that come its way: one list of calls does not stop another flow', () => {
    const base = shop()
    const m = defineModel({
      ...base.def,
      flows: { ...base.def.flows, pings: { rate: 5 } },
      routes: { ...base.def.routes, pings: ['api', 'out'] },
    } as never)
    const ev = m.evaluate({ load: 1 })
    expect(ev.at.shards.reads).toBeCloseTo(800, 9)
    expect(ev.lost.pings!.share).toBe(0)
  })

  it('makes a whole number of calls, needs no more than it makes, and one branch a flow', () => {
    expect(() => shop({ calls: 2.5 }).evaluate()).toThrow(
      'gather "scatter" makes 2.5 calls for each unit of "reads": a whole number from 1',
    )
    expect(() => shop({ needs: 9 }).evaluate()).toThrow('gather "scatter" needs 9 of its 8 calls')
    const two = () =>
      defineModel({
        ...shop().def,
        stages: {
          ...shop().def.stages,
          scatter: gather({
            to: [
              { stage: 'shards', share: 2 },
              { stage: 'out', share: 2 },
            ],
          }),
        },
      } as never).evaluate()
    expect(two).toThrow('gather "scatter" has 2 branches for "reads": one a flow')
  })
})
