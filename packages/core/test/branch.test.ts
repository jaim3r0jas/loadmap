import { describe, expect, it } from 'vitest'
import { cache, check, defineModel, fanout, limit, measured, p, queue, sink, store, workers } from '../src'

// 100 orders a second at 1× to a bus that copies each into a mail queue, read by the mailers, sent through a relay
// that takes 150 and on to an inbox; and twice into an audit log
const shop = (o: { hit?: number; fails?: number; to?: readonly string[] } = {}) =>
  defineModel({
    load: p.load({ max: 10 }),
    flows: { orders: { rate: ({ load }) => 100 * load } },
    components: {
      mailers: {
        name: 'Mailers',
        demand: ({ at }) => at.mailers.orders * 0.01,
        capacity: measured(2, 'cores'),
        over: 'x',
      },
      seen: { name: 'Seen', capacity: measured(1e6, 'msg/s'), over: 'x' },
      relay: { name: 'Relay', capacity: measured(150, 'msg/s'), ...(o.fails ? { fails: o.fails } : {}), over: 'x' },
      inbox: { name: 'Inbox', capacity: measured(1_000, 'msg/s'), over: 'x' },
    },
    stages: {
      bus: fanout({
        to: [
          { stages: o.to ?? ['mailQueue', 'mailers', 'seen', 'relay', 'inbox'], share: 1 },
          { stage: 'audit', share: 2 },
        ],
      }),
      mailQueue: queue({ partitions: { orders: 4 } }),
      mailers: workers('mailers', { pods: 2, perPod: 4 }),
      seen: cache({ hit: o.hit ?? 0, component: 'seen' }),
      relay: limit('relay'),
      inbox: store('inbox'),
      audit: sink(),
      other: fanout({ to: [{ stage: 'audit', share: 1 }] }),
    },
    routes: { orders: ['bus'] },
  })

describe('a fan-out branch that goes on', () => {
  it('sends its copies through every stage of the branch, and each is ranked as any other', () => {
    const ev = shop().evaluate({ load: 1 })
    expect(ev.at.mailQueue.orders).toBeCloseTo(100, 9)
    expect(ev.at.mailers.orders).toBeCloseTo(100, 9)
    expect(ev.at.relay.orders).toBeCloseTo(100, 9)
    expect(ev.at.inbox.orders).toBeCloseTo(100, 9)
    expect(ev.at.audit.orders).toBeCloseTo(200, 9)
    expect(ev.components.mailers.util).toBeCloseTo(0.5, 9)
    expect(ev.components.relay.full).toBeCloseTo(1.5, 6)
    expect(ev.components.mailers.full).toBeCloseTo(2, 6)
    // a resolved branch says its stages, the first of them as `stage`
    expect(ev.stages.bus).toMatchObject({
      to: {
        orders: [
          { stage: 'mailQueue', stages: ['mailQueue', 'mailers', 'seen', 'relay', 'inbox'], share: 1 },
          { stage: 'audit', stages: ['audit'], share: 2 },
        ],
      },
    })
  })

  it('lets on only what a stage of the branch lets on: a limiter, a cache, a component that fails', () => {
    // at 3× the relay takes 150 of 300: the inbox gets those
    const over = shop().evaluate({ load: 3 })
    expect(over.at.relay.orders).toBeCloseTo(300, 9)
    expect(over.at.inbox.orders).toBeCloseTo(150, 6)
    // a cache on the branch answers a fifth, and the relay fails a tenth of what it works on
    const ev = shop({ hit: 0.2, fails: 0.1 }).evaluate({ load: 1 })
    expect(ev.at.seen.orders).toBeCloseTo(100, 9)
    expect(ev.at.relay.orders).toBeCloseTo(80, 9)
    expect(ev.at.inbox.orders).toBeCloseTo(72, 9)
  })

  it('goes through queues and pools, never a split, a fan-out or a lost box, and one stage is still an end', () => {
    expect(() => shop({ to: ['mailQueue', 'other'] }).evaluate()).toThrow(
      'fan-out "bus" branches through "other", which is a fan-out',
    )
    expect(() => shop({ to: ['mailQueue', 'nope'] }).evaluate()).toThrow('branches through "nope", which is no stage')
    expect(() => shop({ to: ['mailQueue'] }).evaluate()).toThrow(
      'fan-out "bus" branches to "mailQueue", which is not a sink, store or pass stage',
    )
    expect(() => shop({ to: [] }).evaluate()).toThrow('fan-out "bus" has a branch with no stage')
    // a branch never comes back onto the flow's own route
    expect(() => shop({ to: ['mailQueue', 'bus'] }).evaluate()).toThrow(
      'fan-out "bus" branches "orders" back through "bus", a stage of its own route',
    )
  })

  it('has figures of its own: what its copies lose up to a stage, of the copies asked for', () => {
    // at 3× the relay lets 150 of 300 on; a cache answering a fifth and a relay failing a tenth lose 8 of 100 at 1×
    const over = shop().branch('orders', 'inbox', { load: 3 })
    expect(over).toMatchObject({
      from: 'bus',
      stages: ['mailQueue', 'mailers', 'seen', 'relay', 'inbox'],
      latency: null,
    })
    expect(over.lost).toEqual({
      rate: expect.closeTo(150, 6),
      share: expect.closeTo(0.5, 9),
      causes: [{ stage: 'relay', loss: 'rejected', rate: expect.closeTo(150, 6) }],
    })
    const some = shop({ hit: 0.2, fails: 0.1 }).branch('orders', 'inbox', { load: 1 }).lost
    expect(some.causes).toEqual([{ stage: 'relay', loss: 'failed', rate: expect.closeTo(8, 9) }])
    expect(some.share).toBeCloseTo(0.08, 12)
    // up to a stage before the relay nothing is lost, and the flow itself loses none of it
    expect(shop().branch('orders', 'mailers', { load: 3 }).lost.share).toBe(0)
    expect(shop().evaluate({ load: 3 }).lost.orders.share).toBe(0)
    expect(() => shop().branch('orders', 'bus')).toThrow('no fan-out branch of "orders" goes through "bus"')
  })

  it('is held by an expectation with to, which names it', () => {
    const said = check(shop(), [
      { flow: 'orders', to: 'inbox', lost: 0.01, underTarget: 2 },
      { flow: 'orders', to: 'inbox', lost: 0.01, underTarget: 1.2 },
      { flow: 'orders', to: 'mailers', lost: 0 },
    ]).map((r) => `${r.outcome}: ${r.message}`)
    expect(said).toEqual([
      'fail: expected at least 2×, but more than 1 % of orders to inbox is lost from 1.5×',
      'pass: at most 1 % of orders to inbox is lost up to 1.5×',
      'pass: nothing of orders to mailers is lost at 1×',
    ])
    const bad = (e: object) => () => defineModel({ ...shop().def, expect: [e] } as never)
    expect(bad({ to: 'inbox', lost: 0.01 })).toThrow('holds a branch (to): name the flow whose fan-out it is')
    expect(bad({ flow: 'orders', to: 'nope', lost: 0.01 })).toThrow('names unknown stage "nope"')
  })
})
