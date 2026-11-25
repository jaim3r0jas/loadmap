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
