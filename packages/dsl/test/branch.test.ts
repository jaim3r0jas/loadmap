import { describe, expect, it } from 'vitest'
import { compile, format } from '../src'

const SRC = `loadmap 1.8
load { max: 10 }

flow orders "orders" { rate: 100 * load; from: users; route: api -> bus }

node users "Users"
node api "API" {
  pass
  capacity: measured(1_000, "req/s")
  over: "clients wait"
}
node bus "Event bus" {
  fanout {
    orders -> mailQueue -> mailers -> smtp: 1
    orders -> audit: 2
  }
}
cluster mail "Mail queue" {
  members: 1
  queue mailQueue { partitions { orders: 4 } }
}
pool mailers "Mailers" {
  pods: 2
  perPod: 4
  demand: at.mailers.orders * 10ms
  capacity: measured(2, "cores")
  over: "mail waits in the queue"
}
node smtp "SMTP relay" {
  limit
  capacity: configured(150, "msg/s", "the relay's plan")
  over: "mail is refused"
}
node audit "Audit log" { sink }

users -> api
api -> bus
bus -> mail
mail -> mailers
mailers -> smtp
bus -> audit
`

const errors = (src: string) =>
  compile(src).diagnostics.map((d) => `${d.severity}: ${d.code}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)

describe('a fan-out branch that goes on, in the language', () => {
  it('is the stages its copy goes through, as a route is written', () => {
    expect(format(SRC).text).toBe(SRC)
    const r = compile(SRC)
    expect(r.diagnostics).toEqual([])
    const m = r.definition!.model
    // one stage stays the branch it was
    expect(m.def.stages.bus).toMatchObject({
      kind: 'fanout',
      to: {
        orders: [
          { stages: ['mailQueue', 'mailers', 'smtp'], share: 1 },
          { stage: 'audit', share: 2 },
        ],
      },
    })
    const ev = m.evaluate({ load: 1 })
    expect(ev.at.mailers!.orders).toBeCloseTo(100, 9)
    expect(ev.at.smtp!.orders).toBeCloseTo(100, 9)
    expect(ev.at.audit!.orders).toBeCloseTo(200, 9)
    // the relay runs out first, at 1.5×, then the mailers at 2×
    expect(ev.ranked.slice(0, 2).map((c) => [c.id, c.full])).toEqual([
      ['smtp', expect.closeTo(1.5, 6)],
      ['mailers', expect.closeTo(2, 6)],
    ])
  })

  it('needs an edge for each pair of boxes along it', () => {
    expect(errors(SRC.replace('mailers -> smtp\n', ''))).toEqual([
      'error: missing-edge: "orders" goes from "mailers" to "smtp", and no edge joins them | draw mailers -> smtp',
    ])
  })

  it('says what is wrong with it', () => {
    expect(errors(SRC.replace('loadmap 1.8', 'loadmap 1.7'))).toEqual([
      'error: language-version: a fan-out branch that goes on (a -> b -> c) is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
    ])
    expect(errors(SRC.replace('orders -> mailQueue -> mailers -> smtp: 1', 'orders -> mailQueue -> bus: 1'))).toContain(
      'error: bad-route: a branch goes on through queues, pools and stages that end it, not through the fan-out "bus"',
    )
    expect(
      errors(SRC.replace('orders -> mailQueue -> mailers -> smtp: 1', 'orders -> mailQueue -> nope: 1')),
    ).toContain('error: unknown-name: unknown stage "nope"')
    // one stage is where a copy ends: a queue alone is no end
    expect(errors(SRC.replace('orders -> mailQueue -> mailers -> smtp: 1', 'orders -> mailQueue: 1'))).toContain(
      'error: model: fan-out "bus" branches to "mailQueue", which is not a sink, store or pass stage',
    )
  })
})

describe('a branch’s own figures, in the language', () => {
  const src = `loadmap 1.8
load { max: 10 }

expect "Mail is sent to 1.4×" { flow: orders; to: smtp; lost: 1%; underTarget: 1.4× }
expect "Mail leaves in a quarter of a second" { flow: orders; to: smtp; p99: 250ms }

flow orders "orders" { rate: 100 * load; from: users; route: api -> bus }

node users "Users"
node api "API" {
  pass
  capacity: measured(1_000, "req/s")
  service: 5ms
  over: "clients wait"
}
node bus "Event bus" {
  fanout {
    orders -> mailQueue -> mailers -> smtp: 1
    orders -> audit: 2
  }
}
cluster mail "Mail queue" {
  members: 1
  queue mailQueue { partitions { orders: 4 } }
}
pool mailers "Mailers" {
  pods: 2
  perPod: 4
  demand: at.mailers.orders * 10ms
  capacity: measured(2, "cores")
  service: 10ms
  over: "mail waits in the queue"
}
node smtp "SMTP relay" {
  limit
  capacity: configured(150, "msg/s", "the relay's plan")
  service: 20ms
  over: "mail is refused"
}
node audit "Audit log" { sink }

users -> api
api -> bus
bus -> mail
mail -> mailers
mailers -> smtp { delay: 30ms }
bus -> audit
`

  it('holds a branch with to: what its copies lose, and the time they take from the fan-out', () => {
    expect(format(src).text).toBe(src)
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    const m = r.definition!.model
    expect(m.expectations).toEqual([
      { label: 'Mail is sent to 1.4×', flow: 'orders', to: 'smtp', lost: 0.01, underTarget: 1.4 },
      { label: 'Mail leaves in a quarter of a second', flow: 'orders', to: 'smtp', p99: 0.25 },
    ])
    // the mailers at half (20 ms), 30 ms on the edge, the relay at two thirds (60 ms): none of it in the order's own 5.6 ms
    const b = m.branch('orders', 'smtp', { load: 1 })
    expect(b.stages).toEqual(['mailQueue', 'mailers', 'smtp'])
    expect(b.latency!.mean).toBeCloseTo(0.11, 12)
    expect(m.evaluate({ load: 1 }).latency.orders!.mean).toBeCloseTo(0.005 / (1 - 0.1), 12)
    // the edge's delay along the branch is the model's
    expect(m.def.delays).toEqual([{ from: 'mailers', to: 'smtp', delay: 0.03 }])
    // the relay takes 150 of the 200 copies at 2×
    expect(m.branch('orders', 'smtp', { load: 2 }).lost).toEqual({
      rate: expect.closeTo(50, 6),
      share: expect.closeTo(0.25, 9),
      causes: [{ stage: 'smtp', loss: 'rejected', rate: expect.closeTo(50, 6) }],
    })
    expect(r.expectations.map((e) => `${e.result.outcome}: ${e.result.message}`)).toEqual([
      'pass: at most 1 % of orders to smtp is lost up to 1.5×',
      'fail: expected the p99 of orders to smtp under 250 ms, but it is 323.6 ms at 1×',
    ])
  })

  it('says what is wrong with it', () => {
    const line = (s: string) => src.replace('flow: orders; to: smtp; p99: 250ms', s)
    expect(errors(src.replace('loadmap 1.8', 'loadmap 1.7'))).toContain(
      'error: language-version: "to:" is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
    )
    const needs =
      'error: bad-expect: to is a stage on a fan-out branch of a flow: name the flow, and what its branch must keep | flow: orders; to: mailers; lost: 1%'
    expect(errors(line('to: smtp; lost: 1%'))).toEqual([needs])
    expect(errors(line('flow: orders; to: smtp; underTarget: 2×'))).toEqual([needs])
    expect(errors(line('flow: orders; to: nope; lost: 1%'))).toEqual(['error: unknown-name: unknown stage "nope"'])
    expect(errors(line('flow: orders; to: mailers -> smtp; lost: 1%'))).toEqual([
      'error: bad-expect: to is one stage of a branch, the one it is held up to | to: mailers',
    ])
    // a stage is named by its box where the box holds one, as a branch names it: the cluster "mail" is its queue
    expect(errors(line('flow: orders; to: mail; lost: 0%'))).toEqual([])
    expect(errors(line('flow: orders; to: api; lost: 1%'))).toEqual([
      'error: model: no fan-out branch of "orders" goes through "api"',
    ])
  })
})
