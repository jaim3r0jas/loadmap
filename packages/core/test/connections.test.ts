import { describe, expect, it } from 'vitest'
import {
  type ConnectionDef,
  configured,
  defineModel,
  estimated,
  fanout,
  measured,
  p,
  pass,
  queue,
  type StageDef,
  sink,
  split,
  store,
  workers,
} from '../src'

type Shape = {
  partitions?: number
  pods?: number
  perPod?: number
  connection?: Partial<ConnectionDef<'topic' | 'pool', 'orders'>> | null
}

// 100 orders/s at 1×, each 10 ms of a core: 1 core at 1×; the pool has 1 core a pod
const kafka = ({ partitions = 12, pods = 4, perPod = 4, connection = {} }: Shape = {}) =>
  defineModel({
    load: p.load({ max: 100 }),
    flows: { orders: { rate: ({ load }) => 100 * load } },
    components: {
      consumer: {
        name: 'Consumer',
        short: 'the consumer',
        demand: ({ flows }) => flows.orders * 0.01,
        capacity: measured(pods, 'cores', 'pod CPU limit'),
        over: 'orders wait in their topic',
      },
    },
    stages: {
      topic: queue({ partitions: { orders: partitions }, label: 'orders topic' }),
      pool: workers('consumer', { pods, perPod, label: 'order consumer' }),
      done: sink(),
    },
    routes: { orders: ['topic', 'pool', 'done'] },
    ...(connection && {
      connections: { group: { from: 'topic', to: 'pool', assign: 'exclusive', ...connection } },
    }),
  })

describe('an exclusive connection', () => {
  it('changes nothing while every worker owns one partition', () => {
    const ev = kafka({ partitions: 16 }).evaluate({ load: 2 })
    const plain = kafka({ partitions: 16, connection: null }).evaluate({ load: 2 })
    expect(ev.components.consumer.util).toBeCloseTo(0.5, 12)
    expect(ev.components.consumer.full).toBeCloseTo(plain.components.consumer.full!, 9)
    expect(ev.components.consumer.spread).toBeUndefined()
  })

  it('leaves the workers beyond the partitions idle: the busiest one bounds the pool', () => {
    // 16 workers, 12 partitions: each owner carries 1/12 of the work on 1/16 of the capacity
    const ev = kafka().evaluate({ load: 2 })
    expect(ev.components.consumer.util).toBeCloseTo(0.5 * (16 / 12), 12)
    expect(ev.components.consumer.demand).toBe(2)
    expect(ev.components.consumer.capacity?.value).toBe(4)
    expect(ev.components.consumer.full).toBeCloseTo(3, 9)
    expect(ev.components.consumer.spread).toEqual({
      factor: expect.closeTo(16 / 12, 12),
      text: 'The busiest worker reads 1 of 12 partitions: the consumer runs out at 75 % of its capacity. 4 of 16 workers read no partition.',
    })
    // what reaches the stage is the same: a connection loses no unit
    expect(ev.at.pool.orders).toBe(200)
  })

  it('makes a pod beyond the partitions add nothing when the capacity is per worker', () => {
    const four = kafka({ partitions: 16 }).evaluate()
    const five = kafka({ partitions: 16, pods: 5 }).evaluate()
    expect(five.components.consumer.full).toBeCloseTo(four.components.consumer.full!, 9)
    // without the connection, the fifth pod looks like 25 % more room
    expect(kafka({ partitions: 16, pods: 5, connection: null }).evaluate().components.consumer.full).toBeCloseTo(5, 9)
  })

  it('deals more partitions than workers in turn: some workers own one more', () => {
    // 8 workers, 12 partitions: four own 2, four own 1
    const ev = kafka({ pods: 2, perPod: 4 }).evaluate({ load: 1 })
    expect(ev.components.consumer.util).toBeCloseTo(0.5 * ((2 / 12) * 8), 12)
    expect(ev.components.consumer.spread?.text).toBe(
      'The busiest worker reads 2 of 12 partitions: the consumer runs out at 75 % of its capacity.',
    )
  })

  it('divides the capacity per pod: idle threads cost nothing, a pod without a partition does', () => {
    // owners alternate pods: 6 partitions on 4 pods of 4 workers read 2, 2, 1, 1
    const six = kafka({ partitions: 6, connection: { capacityPer: 'pod' } }).evaluate({ load: 2 })
    expect(six.components.consumer.util).toBeCloseTo(0.5 * ((2 / 6) * 4), 12)
    expect(six.components.consumer.spread?.text).toBe(
      'The busiest pod reads 2 of 6 partitions: the consumer runs out at 75 % of its capacity. 10 of 16 workers read no partition.',
    )
    // 12 partitions: every pod reads 3, so the idle threads leave the capacity whole
    const twelve = kafka({ connection: { capacityPer: 'pod' } }).evaluate({ load: 2 })
    expect(twelve.components.consumer.util).toBeCloseTo(0.5, 12)
    expect(twelve.components.consumer.spread).toEqual({
      factor: 1,
      text: '4 of 16 workers read no partition: every pod still reads its share.',
    })
  })

  it('lets a pod own the partitions', () => {
    const six = kafka({ partitions: 6, connection: { owner: 'pod' } }).evaluate({ load: 2 })
    expect(six.components.consumer.util).toBeCloseTo(0.5 * ((2 / 6) * 4), 12)
    expect(six.components.consumer.spread?.text).toBe(
      'The busiest pod reads 2 of 6 partitions: the consumer runs out at 75 % of its capacity.',
    )
    const three = kafka({ partitions: 3, connection: { owner: 'pod' } }).evaluate({ load: 2 })
    expect(three.components.consumer.util).toBeCloseTo(0.5 * ((1 / 3) * 4), 12)
    expect(three.components.consumer.spread?.text).toBe(
      'The busiest pod reads 1 of 3 partitions: the consumer runs out at 75 % of its capacity. 1 of 4 pods read no partition.',
    )
  })

  it('takes the partitions from the values', () => {
    const m = defineModel({
      load: p.load({ max: 100 }),
      params: { parts: p.select({ label: 'Partitions', options: [8, 16], default: 8 }) },
      flows: { orders: { rate: ({ load }) => 100 * load } },
      components: {
        consumer: {
          name: 'Consumer',
          demand: ({ flows }) => flows.orders * 0.01,
          capacity: measured(4, 'cores'),
          over: 'x',
        },
      },
      stages: {
        topic: queue({ partitions: ({ parts }) => ({ orders: parts as number }) }),
        pool: workers('consumer', { pods: 4, perPod: 4 }),
      },
      routes: { orders: ['topic', 'pool'] },
      connections: { group: { from: 'topic', to: 'pool', assign: 'exclusive' } },
    })
    expect(m.evaluate({ load: 1 }).components.consumer.util).toBeCloseTo(0.25 * 2, 12)
    expect(m.evaluate({ load: 1, parts: 16 }).components.consumer.util).toBeCloseTo(0.25, 12)
  })

  it('moves the first limit, the crossings and the utilization the controls read', () => {
    const m = defineModel({
      load: p.load({ max: 100 }),
      flows: { orders: { rate: ({ load }) => 100 * load } },
      components: {
        gateway: { name: 'Gateway', capacity: estimated(350, 'req/s'), over: 'x' },
        consumer: {
          name: 'Consumer',
          demand: ({ flows }) => flows.orders * 0.01,
          capacity: measured(4, 'cores'),
          over: 'x',
        },
      },
      stages: {
        gw: pass('gateway'),
        topic: queue({ partitions: { orders: 8 } }),
        pool: workers('consumer', { pods: 4, perPod: 4 }),
      },
      routes: { orders: ['gw', 'topic', 'pool'] },
      connections: { group: { from: 'topic', to: 'pool', assign: 'exclusive' } },
    })
    const ev = m.evaluate()
    // the gateway is full at 3.5×; the consumer would be at 4×, but half its workers read nothing: 2×
    expect(ev.components.consumer.full).toBeCloseTo(2, 9)
    expect(ev.firstFull?.id).toBe('consumer')
    expect(m.utilization({ load: 1 }).consumer).toBeCloseTo(0.5, 12)
  })

  it('holds an autoscaled pool at its target on the average, and spreads over the pods running', () => {
    const m = defineModel({
      load: p.load({ max: 100 }),
      flows: { orders: { rate: ({ load }) => 100 * load } },
      components: {
        consumer: {
          name: 'Consumer',
          demand: ({ flows }) => flows.orders * 0.01,
          capacity: measured(8, 'cores'),
          over: 'x',
        },
      },
      stages: {
        topic: queue({ partitions: { orders: 4 } }),
        pool: workers('consumer', { autoscale: { min: 1, max: 8, target: 0.5 }, perPod: 2 }),
      },
      routes: { orders: ['topic', 'pool'] },
      connections: { group: { from: 'topic', to: 'pool', assign: 'exclusive' } },
    })
    // 1.5 cores of 8: the autoscaler sees 18.75 % and runs 3 pods; 6 workers read 4 partitions
    const ev = m.evaluate({ load: 1.5 })
    const pool = ev.stages.pool
    expect(pool.kind === 'workers' && pool.running).toBe(3)
    expect(ev.components.consumer.util).toBeCloseTo((1.5 / 8) * ((1 / 4) * 6), 12)
    const drawn = m.stagesAt({ load: 1.5 }).stages.pool
    expect(drawn.kind === 'workers' && drawn.running).toBe(3)
  })

  it('weighs several flows by what reaches the stage; a flow it does not cover lands evenly', () => {
    const m = (covered?: readonly ('orders' | 'events')[]) =>
      defineModel({
        load: p.load({ max: 100 }),
        flows: { orders: { rate: ({ load }) => 100 * load }, events: { rate: ({ load }) => 100 * load } },
        components: {
          consumer: {
            name: 'Consumer',
            demand: ({ flows }) => (flows.orders + flows.events) * 0.01,
            capacity: measured(8, 'cores'),
            over: 'x',
          },
        },
        stages: {
          topic: queue({ partitions: { orders: 4, events: 8 } }),
          pool: workers('consumer', { pods: 2, perPod: 4 }),
        },
        routes: { orders: ['topic', 'pool'], events: ['topic', 'pool'] },
        connections: { group: { from: 'topic', to: 'pool', assign: 'exclusive', ...(covered && { flows: covered }) } },
      })
    // orders' 4 partitions to workers 0–3, events' 8 to 4–7 and 0–3: workers 0–3 carry 1/8 + 1/16 of the work
    const both = m().evaluate({ load: 1 })
    expect(both.components.consumer.util).toBeCloseTo(0.25 * 1.5, 12)
    expect(both.components.consumer.spread?.text).toBe(
      'The busiest worker carries 1.5 × its share: Consumer runs out at 67 % of its capacity.',
    )
    // only orders exclusive: events spread over all 8; workers 0–3 again carry 1/8 + 1/16
    expect(m(['orders']).evaluate({ load: 1 }).components.consumer.util).toBeCloseTo(0.25 * 1.5, 12)
  })

  it('works between any two stages with parts and members', () => {
    const m = defineModel({
      load: p.load({ max: 100 }),
      flows: { writes: { rate: ({ load }) => 100 * load } },
      components: {
        api: { name: 'API', capacity: estimated(10_000, 'req/s'), over: 'x' },
        db: { name: 'Store', short: 'the store', capacity: estimated(1_000, 'writes/s'), over: 'x' },
      },
      stages: { api: pass('api'), db: store('db') },
      routes: { writes: ['api', 'db'] },
      connections: { shards: { from: 'api', to: 'db', assign: 'exclusive', parts: 10, members: 4 } },
    })
    // 10 shards on 4 members: 3, 3, 2, 2
    const ev = m.evaluate({ load: 1 })
    expect(ev.components.db.util).toBeCloseTo(0.1 * 1.2, 12)
    expect(ev.components.db.spread?.text).toBe(
      'The busiest member reads 3 of 10 parts: the store runs out at 83 % of its capacity.',
    )
    expect(ev.components.api.spread).toBeUndefined()
  })

  it("follows a fan-out's copies to the stage they reach", () => {
    const m = defineModel({
      load: p.load({ max: 100 }),
      flows: { events: { rate: ({ load }) => 100 * load } },
      components: { db: { name: 'Store', capacity: estimated(1_000, 'writes/s'), over: 'x' } },
      stages: { bus: fanout({ to: [{ stage: 'db', share: 1 }] }), db: store('db') },
      routes: { events: ['bus'] },
      connections: { shards: { from: 'bus', to: 'db', assign: 'exclusive', parts: 10, members: 4 } },
    })
    expect(m.evaluate({ load: 1 }).components.db.util).toBeCloseTo(0.1 * 1.2, 12)
  })

  it('rests while a split sends the flows another way', () => {
    const m = defineModel({
      load: p.load({ max: 100 }),
      params: { viaTopic: p.switch({ label: 'Through the topic', default: true }) },
      flows: { orders: { rate: ({ load }) => 100 * load } },
      components: { consumer: { name: 'Consumer', capacity: measured(400, 'orders/s'), over: 'x' } },
      stages: {
        router: split({ to: ({ viaTopic }) => [{ stages: viaTopic ? ['topic', 'pool'] : ['pool'], share: 1 }] }),
        topic: queue({ partitions: { orders: 2 } }),
        pool: workers('consumer', { pods: 1, perPod: 4 }),
      },
      routes: { orders: ['router'] },
      connections: { group: { from: 'topic', to: 'pool', assign: 'exclusive' } },
    })
    expect(m.evaluate({ load: 1 }).components.consumer.util).toBeCloseTo(0.25 * 2, 12)
    const direct = m.evaluate({ load: 1, viaTopic: false })
    expect(direct.components.consumer.util).toBeCloseTo(0.25, 12)
    expect(direct.components.consumer.spread).toBeUndefined()
  })

  it('weighs the flows of a component that counts slots by how long each holds one', () => {
    const m = defineModel({
      load: p.load({ max: 100 }),
      flows: { fast: { rate: 100 }, slow: { rate: 10 } },
      components: {
        slots: {
          name: 'Slots',
          held: { fast: 0.001, slow: 0.1 },
          capacity: configured(10, 'connections', 'pool size'),
          over: 'x',
        },
      },
      stages: { topic: queue({ partitions: { fast: 4, slow: 4 } }), pool: workers('slots', { pods: 1, perPod: 8 }) },
      routes: { fast: ['topic', 'pool'], slow: ['topic', 'pool'] },
      connections: { group: { from: 'topic', to: 'pool', assign: 'exclusive', flows: ['slow'] } },
    })
    // slow holds 1 of the 1.1 slots in use: its 4 partitions on 8 workers carry 1/1.1 ÷ 4 each, fast 0.1/1.1 ÷ 8
    const factor = (1 / 1.1 / 4 + 0.1 / 1.1 / 8) * 8
    expect(m.evaluate().components.slots.util).toBeCloseTo(0.11 * factor, 12)
  })

  it('compares members worked out from the values where they are', () => {
    const m = (members: [() => number, () => number]) =>
      defineModel({
        load: p.load({ max: 100 }),
        flows: { a: { rate: 100 }, b: { rate: 100 } },
        components: { db: { name: 'Store', capacity: estimated(1_000, 'writes/s'), over: 'x' } },
        stages: {
          qa: queue({ partitions: { a: 4 } }),
          qb: queue({ partitions: { b: 4 } }),
          db: store('db'),
        },
        routes: { a: ['qa', 'db'], b: ['qb', 'db'] },
        connections: {
          fromA: { from: 'qa', to: 'db', assign: 'exclusive', members: members[0] },
          fromB: { from: 'qb', to: 'db', assign: 'exclusive', members: members[1] },
        },
      })
    expect(m([() => 4, () => 4]).evaluate().components.db.util).toBeCloseTo(0.2, 12)
    expect(() => m([() => 4, () => 3]).evaluate()).toThrow(
      'loadmap: connections "fromA" and "fromB" read into "db" with different members: give them the same owner, capacityPer and members',
    )
    // a pool's members are what owns a part and what the capacity divides over
    const pool = defineModel({
      load: p.load({ max: 100 }),
      flows: { a: { rate: 100 }, b: { rate: 100 } },
      components: { consumer: { name: 'Consumer', capacity: measured(4, 'cores'), over: 'x' } },
      stages: {
        qa: queue({ partitions: { a: 4 } }),
        qb: queue({ partitions: { b: 4 } }),
        pool: workers('consumer', { pods: 2, perPod: 2 }),
      },
      routes: { a: ['qa', 'pool'], b: ['qb', 'pool'] },
      connections: {
        fromA: { from: 'qa', to: 'pool', assign: 'exclusive' },
        fromB: { from: 'qb', to: 'pool', assign: 'exclusive', owner: 'pod' },
      },
    })
    expect(() => pool.evaluate()).toThrow(
      'loadmap: connections "fromA" and "fromB" read into "pool" with different members: give them the same owner, capacityPer and members',
    )
  })

  it('needs whole workers', () => {
    expect(() => kafka({ perPod: 2.5 }).evaluate()).toThrow(
      'loadmap: workers "pool" needs perPod as a whole number from 1 up, not 2.5',
    )
  })

  it('is listed with the assumptions, the even case said', () => {
    const ev = kafka().evaluate()
    expect(ev.assumptions.find((a) => a.kind === 'connection')).toEqual({
      kind: 'connection',
      name: 'group',
      text: 'Each partition of orders topic is read by one worker of order consumer (exclusive). The partitions are dealt in turn to workers alternating pods: the most even case.',
    })
  })
})

describe('a shared connection', () => {
  it('changes no number, and says its rule', () => {
    const ev = kafka({ connection: { assign: 'shared' } }).evaluate({ load: 2 })
    expect(ev.components.consumer.util).toBeCloseTo(0.5, 12)
    expect(ev.components.consumer.spread).toBeUndefined()
    expect(ev.assumptions.find((a) => a.kind === 'connection')).toEqual({
      kind: 'connection',
      name: 'group',
      text: 'Any worker of order consumer takes any unit from orders topic (shared).',
    })
  })
})

describe('a connection that cannot be', () => {
  const base = (connections: Record<string, Partial<ConnectionDef>>, extra: { split?: boolean } = {}) => {
    // a stage set that may hold one more: loosely typed, as a compiled definition is
    const stages: Record<string, StageDef<'consumer' | 'api'>> = {
      api: pass('api'),
      topic: queue({ partitions: { orders: 4 } }),
      pool: workers('consumer', { pods: 2, perPod: 2 }),
      ...(extra.split ? { audit: pass('consumer') } : {}),
      done: sink(),
    }
    return defineModel({
      load: p.load({ max: 10 }),
      flows: { orders: { rate: 10 }, events: { rate: 10 } },
      components: {
        consumer: { name: 'Consumer', capacity: measured(4, 'cores'), over: 'x' },
        api: { name: 'API', capacity: measured(4, 'req/s'), over: 'x' },
      },
      stages,
      routes: { orders: ['api', 'topic', 'pool', 'done'], events: ['api', 'done'] },
      connections: connections as Record<string, ConnectionDef<string, 'orders' | 'events'>>,
    })
  }
  const throws = (connections: Record<string, Partial<ConnectionDef>>, message: string) =>
    expect(() => base(connections).evaluate()).toThrow(message)

  it('is refused when the definition is wrong', () => {
    throws({ x: { from: 'topic', to: 'nowhere' } }, 'loadmap: connection "x" names unknown stage "nowhere"')
    throws({ x: { from: 'topic', to: 'pool', flows: ['nope'] } }, 'loadmap: connection "x" covers unknown flow "nope"')
    throws(
      { api: { from: 'topic', to: 'pool' } },
      'loadmap: connection "api" has the name of a component: give it its own',
    )
    throws(
      { x: { from: 'pool', to: 'done', assign: 'exclusive', parts: 2, members: 2 } },
      'loadmap: connection "x" spreads parts over "done", which has no component to run out',
    )
    throws(
      { x: { from: 'api', to: 'topic', assign: 'exclusive', members: 2 } },
      'loadmap: connection "x" needs parts: "api" is not a queue with partitions',
    )
    throws(
      { x: { from: 'api', to: 'topic', assign: 'exclusive', parts: 2 } },
      'loadmap: connection "x" needs members: "topic" is not a pool',
    )
    throws(
      { x: { from: 'topic', to: 'pool', parts: 2 } },
      'loadmap: connection "x": the parts of queue "topic" are its partitions; leave parts out',
    )
    throws(
      { x: { from: 'topic', to: 'pool', members: 2 } },
      'loadmap: connection "x": the members of pool "pool" are its workers or pods; leave members out',
    )
    throws(
      { x: { from: 'api', to: 'topic', owner: 'pod' } },
      'loadmap: connection "x" names owner or capacityPer, but "topic" is not a pool: give it members',
    )
    throws(
      { x: { from: 'topic', to: 'pool', owner: 'pod', capacityPer: 'worker' } },
      'loadmap: connection "x" divides the capacity per worker, but a pod owns each part: capacityPer is the owner or a pod',
    )
    expect(() => base({ x: { from: 'topic', to: 'pool', assign: 'exclusive' } }, { split: true })).toThrow(
      'loadmap: connection "x" spreads parts over "pool", but its component "consumer" also runs "audit": give "pool" a component of its own',
    )
  })

  it('is refused where the flows do not go', () => {
    throws(
      { x: { from: 'api', to: 'pool', assign: 'exclusive', parts: 2 } },
      'loadmap: connection "x" joins "api" to "pool", but no flow goes from one straight to the other',
    )
    throws(
      { x: { from: 'topic', to: 'pool', flows: ['events'] } },
      'loadmap: connection "x" covers "events", which does not go from "topic" straight to "pool"',
    )
    throws(
      { a: { from: 'topic', to: 'pool' }, b: { from: 'topic', to: 'pool', flows: ['orders'] } },
      'loadmap: connections "a" and "b" both cover "orders" from "topic" to "pool": a flow follows one rule at each hop',
    )
  })

  it('is refused without partitions or whole parts', () => {
    const m = defineModel({
      load: p.load({ max: 10 }),
      flows: { orders: { rate: 10 }, events: { rate: 10 } },
      components: { consumer: { name: 'Consumer', capacity: measured(4, 'cores'), over: 'x' } },
      stages: { topic: queue({ partitions: { orders: 4 } }), pool: workers('consumer', { pods: 2, perPod: 2 }) },
      routes: { orders: ['topic', 'pool'], events: ['topic', 'pool'] },
      connections: { x: { from: 'topic', to: 'pool', assign: 'exclusive' } },
    })
    expect(() => m.evaluate()).toThrow(
      'loadmap: connection "x" reads "events" from queue "topic", which has no partitions of it',
    )
    const half = defineModel({
      load: p.load({ max: 10 }),
      flows: { orders: { rate: 10 } },
      components: { db: { name: 'DB', capacity: measured(4, 'writes/s'), over: 'x' } },
      stages: { in: sink(), db: store('db') },
      routes: { orders: ['in', 'db'] },
      connections: { x: { from: 'in', to: 'db', assign: 'exclusive', parts: 2.5, members: 2 } },
    })
    expect(() => half.evaluate()).toThrow('loadmap: connection "x" needs parts as a whole number from 1 up, not 2.5')
  })
})
