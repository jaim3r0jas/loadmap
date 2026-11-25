import { describe, expect, it } from 'vitest'
import { check, defineModel, measured, p, pass, queue, sink, workers } from '../src'
import { backlog } from '../src/backlog'

// 100 jobs a second at 1×, through an inbox to runners that take 200 a second; a rush is 3× for 10 minutes
const shop = (o: { holds?: number; within?: number; expect?: object[]; rush?: number } = {}) =>
  defineModel({
    load: p.load({ max: 10 }),
    flows: { jobs: { label: 'jobs', rate: ({ load }) => 100 * load } },
    components: {
      api: { name: 'API', capacity: measured(10_000, 'req/s'), over: 'x' },
      runners: {
        name: 'Runners',
        demand: ({ flows }) => flows.jobs * 0.01,
        capacity: measured(2, 'cores', o.within ? { within: o.within } : undefined),
        over: 'x',
      },
    },
    stages: {
      api: pass('api'),
      inbox: queue({ partitions: { jobs: 1 }, ...(o.holds ? { holds: o.holds } : {}) }),
      runners: workers('runners', { pods: 2, perPod: 4 }),
      out: sink(),
    },
    routes: { jobs: ['api', 'inbox', 'runners', 'out'] },
    presets: { Rush: { load: o.rush ?? 3 } },
    peaks: { Rush: 600 },
    expect: (o.expect ?? []) as never,
  })
const said = (m: ReturnType<typeof shop>) => check(m).map((r) => `${r.outcome}: ${r.message}`)

describe('the lag a peak leaves', () => {
  it('is how long ago the oldest unit waiting arrived', () => {
    // 100 a second more than the runners take, for 600 s: 60 000 wait, the oldest of 300 a second 200 s old
    expect(backlog(shop(), { load: 3 }, 600)).toEqual([
      { stage: 'inbox', flows: { jobs: 60_000 }, units: 60_000, empties: 600, lag: 200 },
    ])
  })

  it('is the time a full queue is read through in', () => {
    expect(backlog(shop({ holds: 5000 }), { load: 3 }, 600)[0]!.lag).toBe(25)
  })

  it('is read at an edge of a ±', () => {
    // at the low edge the runners take 140 a second, at the high one 260
    const m = shop({ within: 0.3 })
    expect(backlog(m, { load: 3 }, 600, 'low')[0]!.units).toBeCloseTo(96_000, 3)
    expect(backlog(m, { load: 3 }, 600, 'high')[0]!.units).toBeCloseTo(24_000, 3)
    expect(backlog(m, { load: 3 }, 600)[0]!.units).toBeCloseTo(60_000, 3)
  })
})

describe('an expectation on a moment', () => {
  it('holds the lag when the preset ends and the time to clear after it', () => {
    expect(said(shop({ holds: 5000, expect: [{ preset: 'Rush', queue: 'inbox', lag: 60, clears: 300 }] }))).toEqual([
      'pass: after 10 min of Rush, the oldest unit in inbox waited 25 s; inbox clears in 50 s at 1×',
    ])
  })

  it('fails with what it expected and what it found', () => {
    expect(said(shop({ holds: 5000, expect: [{ preset: 'Rush', lag: 10 }] }))).toEqual([
      'fail: expected a lag of at most 10 s after 10 min of Rush, but the oldest unit in inbox waited 25 s',
    ])
    // 60 000 jobs, cleared at 100 a second
    expect(said(shop({ expect: [{ preset: 'Rush', lag: 300, clears: 300 }] }))).toEqual([
      'fail: expected every queue to clear within 5 min after 10 min of Rush, but inbox clears in 10 min at 1×',
    ])
  })

  it('passes when no queue falls behind', () => {
    expect(
      said(
        shop({
          rush: 2,
          expect: [
            { preset: 'Rush', queue: 'inbox', lag: 60 },
            { preset: 'Rush', clears: 60 },
          ],
        }),
      ),
    ).toEqual(['pass: after 10 min of Rush, inbox keeps up', 'pass: after 10 min of Rush, no queue falls behind'])
  })

  it('is inconclusive when it holds only at the high edge of a ±', () => {
    const [r] = check(shop({ holds: 5000, within: 0.3, expect: [{ preset: 'Rush', clears: 60 }] }))
    expect(r).toMatchObject({
      outcome: 'inconclusive',
      ok: false,
      reasons: ['holds only at the high edge of a ±'],
      message: 'expected every queue to clear within 1 min after 10 min of Rush, but inbox clears in 2 min at 1×',
    })
  })

  it('says a queue that never clears', () => {
    // at 1×, the default load, the runners take just the 100 a second that arrive: nothing is left to clear with
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { jobs: { rate: ({ load }) => 100 * load } },
      components: { runners: { name: 'Runners', capacity: measured(100, 'jobs/s'), over: 'x' } },
      stages: { inbox: queue({ partitions: { jobs: 1 } }), runners: workers('runners', { pods: 2, perPod: 4 }) },
      routes: { jobs: ['inbox', 'runners'] },
      presets: { Rush: { load: 3 } },
      peaks: { Rush: 600 },
      expect: [{ preset: 'Rush', clears: 3600 }],
    })
    expect(check(m)[0]!.message).toBe(
      'expected every queue to clear within 1 h after 10 min of Rush, but inbox never clears at 1×',
    )
  })

  it('refuses what it cannot hold', () => {
    expect(() => shop({ expect: [{ preset: 'Rush' }] })).toThrow('holds a moment: give its lag or clears')
    expect(() => shop({ expect: [{ lag: 10 }] })).toThrow('holds a moment: name a preset that lasts')
    expect(() => shop({ expect: [{ preset: 'Calm', lag: 10 }] })).toThrow('name a preset that lasts, not "Calm"')
    expect(() => shop({ expect: [{ preset: 'Rush', queue: 'api', lag: 10 }] })).toThrow('names unknown queue "api"')
    expect(() => shop({ expect: [{ preset: 'Rush', lag: 10, flow: 'jobs' }] })).toThrow('holds a moment: no flow')
    expect(() => shop({ expect: [{ preset: 'Rush', lag: 0 }] })).toThrow('has a lag of 0: a time above 0')
  })
})
