import { describe, expect, it } from 'vitest'
import { defineModel, fanout, lost, measured, p, pass, queue, sink, workers } from '../src'
import { backlog } from '../src/backlog'

// 100 jobs a second at 1×, through an inbox to runners that take 200 a second
const shop = (
  o: { holds?: number; block?: boolean; drop?: boolean; retry?: number; gate?: number; fails?: number } = {},
) =>
  defineModel({
    load: p.load({ max: 10 }),
    flows: {
      jobs: {
        label: 'jobs',
        rate: ({ load }) => 100 * load,
        ...(o.drop ? { overload: { drop: { olderThan: 30, reason: 'too old' } } } : {}),
        ...(o.retry ? { retry: { times: o.retry } } : {}),
      },
    },
    components: {
      api: { name: 'API', capacity: measured(o.gate ?? 10_000, 'req/s'), over: 'x' },
      brokers: {
        name: 'Brokers',
        capacity: measured(10_000, 'req/s'),
        ...(o.fails ? { fails: o.fails } : {}),
        over: 'x',
      },
      runners: { name: 'Runners', demand: ({ flows }) => flows.jobs * 0.01, capacity: measured(2, 'cores'), over: 'x' },
    },
    stages: {
      api: pass('api'),
      inbox: queue({
        partitions: { jobs: 1 },
        component: 'brokers',
        ...(o.holds ? { holds: o.holds } : {}),
        ...(o.block ? { whenFull: 'block' as const } : {}),
      }),
      runners: workers('runners', { pods: 2, perPod: 4 }),
      refused: lost({ from: [o.block || !o.holds ? 'api' : 'inbox'] }),
      out: sink(),
    },
    routes: { jobs: ['api', 'inbox', 'runners', 'out'] },
  })

describe('a queue with a size', () => {
  it('turns nothing away while its reader keeps up', () => {
    const m = shop({ holds: 5000 })
    for (const load of [1, 2]) expect(m.evaluate({ load }).lost.jobs).toMatchObject({ rate: 0, causes: [] })
    expect(m.evaluate({ load: 1 }).stages.inbox).toMatchObject({ holds: 5000, whenFull: 'reject' })
  })

  it('turns away what its reader cannot take once it is full', () => {
    const ev = shop({ holds: 5000 }).evaluate({ load: 3 })
    // 300 arrive, the runners take 200
    expect(ev.lost.jobs!.share).toBeCloseTo(1 / 3, 9)
    expect(ev.lost.jobs!.causes).toEqual([{ stage: 'inbox', loss: 'rejected', rate: expect.closeTo(100, 6) }])
    expect(ev.at.refused!.jobs).toBeCloseTo(100, 6)
    expect(shop({ holds: 5000 }).evaluate({ load: 4 }).lost.jobs!.share).toBeCloseTo(0.5, 9)
  })

  it('loses nothing without a size: the queue holds whatever comes', () => {
    const ev = shop().evaluate({ load: 3 })
    expect(ev.lost.jobs!.rate).toBe(0)
    expect(ev.stages.inbox).not.toHaveProperty('holds')
  })

  it('turns the unit away at the stage before it with block', () => {
    const ev = shop({ holds: 5000, block: true }).evaluate({ load: 3 })
    expect(ev.lost.jobs!.causes).toEqual([{ stage: 'api', loss: 'rejected', rate: expect.closeTo(100, 6) }])
    expect(ev.at.refused!.jobs).toBeCloseTo(100, 6)
  })

  it('is no help to a retry: what is sent again finds it as full', () => {
    const ev = shop({ holds: 5000, retry: 2 }).evaluate({ load: 3 })
    expect(ev.lost.jobs!.share).toBeCloseTo(1 / 3, 6)
    // the attempts reach the queue, not only the 300 units
    expect(ev.at.inbox!.jobs).toBeGreaterThan(600)
  })

  it('counts a bottleneck before it once', () => {
    // the API lets 250 of 300 on, the runners take 200 of them
    const ev = shop({ holds: 5000, gate: 250 }).evaluate({ load: 3 })
    expect(ev.lost.jobs!.causes).toEqual([
      { stage: 'api', loss: 'rejected', rate: expect.closeTo(50, 6) },
      { stage: 'inbox', loss: 'rejected', rate: expect.closeTo(50, 6) },
    ])
  })

  it('only turns away with a drop rule when it is read through before a job is too old', () => {
    // it takes in at most 5000 ÷ 30 s = 167 a second, less than the 200 its runners take
    const ev = shop({ holds: 5000, drop: true }).evaluate({ load: 3 })
    expect(ev.lost.jobs!.causes).toEqual([{ stage: 'inbox', loss: 'rejected', rate: expect.closeTo(100, 6) }])
  })

  it('turns away and drops between: it takes in holds ÷ olderThan a second', () => {
    // 7000 ÷ 30 s = 233 a second taken in of 300, and the runners take 200 of them
    const ev = shop({ holds: 7000, drop: true }).evaluate({ load: 3 })
    expect(ev.lost.jobs!.causes).toEqual([
      { stage: 'inbox', loss: 'rejected', rate: expect.closeTo(200 / 3, 6) },
      { stage: 'inbox', loss: 'dropped', rate: expect.closeTo(100 / 3, 6) },
    ])
    expect(ev.lost.jobs!.rate).toBeCloseTo(100, 6)
  })

  it("only drops when it holds more than arrives within the rule's limit", () => {
    // 300 a second for 30 s are 9000: it never fills
    const ev = shop({ holds: 12_000, drop: true }).evaluate({ load: 3 })
    expect(ev.lost.jobs!.causes).toEqual([{ stage: 'inbox', loss: 'dropped', rate: expect.closeTo(100, 6) }])
  })

  it('does not turn away again what its own component failed', () => {
    // the brokers fail 15 of 300; of the 285 left the runners take 200
    const ev = shop({ holds: 5000, fails: 0.05 }).evaluate({ load: 3 })
    expect(ev.lost.jobs!.causes).toEqual([
      { stage: 'inbox', loss: 'failed', rate: expect.closeTo(15, 6) },
      { stage: 'inbox', loss: 'rejected', rate: expect.closeTo(85, 6) },
    ])
    expect(ev.lost.jobs!.share).toBeCloseTo(1 / 3, 9)
  })

  it('refuses a size that is not above 0', () => {
    expect(() => shop({ holds: -1 }).evaluate({ load: 1 })).toThrow('queue "inbox" holds -1 units: a number above 0')
  })

  it('needs a lost box to take from a stage that loses: a queue with no size loses nothing', () => {
    expect(() =>
      defineModel({
        load: p.load({ max: 10 }),
        flows: { jobs: { rate: ({ load }) => 100 * load } },
        components: { runners: { name: 'Runners', capacity: measured(200, 'jobs/s'), over: 'x' } },
        stages: {
          inbox: queue({ partitions: { jobs: 1 } }),
          runners: workers('runners', { pods: 2, perPod: 4 }),
          refused: lost({ from: ['inbox'] }),
        },
        routes: { jobs: ['inbox', 'runners'] },
      }),
    ).toThrow('lost "refused" takes from "inbox", which loses nothing it counts')
  })

  it('turns away the copies of a branch that goes on through it', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { orders: { label: 'orders', rate: ({ load }) => 100 * load } },
      components: {
        api: { name: 'API', capacity: measured(10_000, 'req/s'), over: 'x' },
        mailers: {
          name: 'Mailers',
          demand: ({ at }) => at.mailers.orders * 0.01,
          capacity: measured(2, 'cores'),
          over: 'x',
        },
      },
      stages: {
        api: pass('api'),
        bus: fanout({ to: { orders: [{ stages: ['mailQueue', 'mailers', 'smtp'], share: 1 }] } }),
        mailQueue: queue({ partitions: { orders: 1 }, holds: 1000 }),
        mailers: workers('mailers', { pods: 2, perPod: 4 }),
        smtp: sink(),
      },
      routes: { orders: ['api', 'bus'] },
    })
    expect(m.branch('orders', 'smtp', { load: 1 }).lost.rate).toBe(0)
    const lost = m.branch('orders', 'smtp', { load: 3 }).lost
    expect(lost.share).toBeCloseTo(1 / 3, 9)
    expect(lost.causes).toEqual([{ stage: 'mailQueue', loss: 'rejected', rate: expect.closeTo(100, 6) }])
  })
})

describe('what a peak leaves in a queue with a size', () => {
  it('is no more than it holds, and says when it was full', () => {
    // 100 a second more than the runners take: 5000 after 50 s
    expect(backlog(shop({ holds: 5000 }), { load: 3 }, 600)).toEqual([
      { stage: 'inbox', flows: { jobs: 5000 }, units: 5000, empties: 50, full: { holds: 5000, after: 50 } },
    ])
  })

  it('reads as before when the peak ends before it is full', () => {
    expect(backlog(shop({ holds: 5000 }), { load: 3 }, 20)).toEqual([
      { stage: 'inbox', flows: { jobs: 2000 }, units: 2000, empties: 20 },
    ])
  })

  it('grows with the peak without a size', () => {
    const [b] = backlog(shop(), { load: 3 }, 600)
    expect(b).toMatchObject({ units: 60_000 })
    expect(b).not.toHaveProperty('full')
  })

  it('is full before a drop rule has anything to drop', () => {
    const [b] = backlog(shop({ holds: 1000, drop: true }), { load: 3 }, 600)
    expect(b).toMatchObject({ units: 1000, full: { holds: 1000, after: 10 } })
  })
})
