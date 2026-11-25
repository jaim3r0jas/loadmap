import { compare } from '@loadmap/core'
import { describe, expect, it } from 'vitest'
import { compile, format } from '../src'

const SRC = `loadmap 1.8
load { max: 20 }
currency: "€"

param maxPods "Most API pods" { options: [6, 12]; default: 6 }

scenario today "Today" {}
scenario bigger "Bigger API" { maxPods: 12 }

expect "Today keeps 2×" { underTarget: 2 }
expect "Under 2,000 € a month at 3×" { cost: 2_000; underTarget: 3 }

flow requests "requests" { rate: 100 * load; from: users; route: api -> db }

node users "Users"
pool api "API" {
  perPod: 4
  autoscale { min: 2; max: maxPods; target: 0.7 }
  demand: flows.requests
  capacity: measured(maxPods * 100, "req/s", "100 a pod")
  # a pod a month
  cost: running * 140
  over: "requests queue"
}
node db "Database" {
  pass
  capacity: measured(1_000, "req/s")
  cost: 600
  over: "writes wait"
}

users -> api
api -> db
`
const errors = (src: string) =>
  compile(src).diagnostics.map((d) => `${d.severity}: ${d.code}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)

describe('a cost in the language', () => {
  it("reads running in a box's cost and counts it in the currency", () => {
    expect(format(SRC).text).toBe(SRC)
    expect(errors(SRC)).toEqual([])
    const m = compile(SRC).definition!.model
    expect(m.evaluate({ load: 1 } as never).cost).toEqual({
      total: 880,
      components: { api: 280, db: 600 },
      currency: '€',
    })
    expect(m.evaluate({ load: 3 } as never).cost!.total).toBe(1300)
    expect(compare(m, 1).rows.map((r) => r.cost)).toEqual([880, 880])
  })

  it('holds a budget in an expect', () => {
    expect(compile(SRC).expectations.map((e) => `${e.result.outcome}: ${e.result.message}`)).toEqual([
      'pass: the 50 % target holds up to 3×, limited by API',
      'pass: it costs 1,300 € a month at 3×, within 2,000 €',
    ])
  })

  it('is from loadmap 1.8', () => {
    expect(errors(SRC.replace('loadmap 1.8', 'loadmap 1.7'))).toEqual([
      'error: language-version: "currency:" is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
      'error: language-version: "cost:" is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
      'error: language-version: "cost:" is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
      'error: language-version: "cost:" is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
    ])
  })

  it('refuses a cost below 0, a budget with nothing to cost or with more, and running outside a cost', () => {
    expect(errors(SRC.replace('cost: 600', 'cost: -1'))).toEqual([
      'error: bad-value: a cost is a number from 0 a month, not -1',
    ])
    expect(errors(SRC.replace('  cost: running * 140\n', '').replace('  cost: 600\n', ''))).toEqual([
      'error: bad-expect: a budget holds what boxes cost: give one a cost | cost: running * 140',
    ])
    expect(errors(SRC.replace('{ cost: 2_000; underTarget: 3 }', '{ cost: 2_000; flow: requests }'))).toEqual([
      'error: bad-expect: an expect on cost takes no flow',
    ])
    expect(errors(SRC.replace('demand: flows.requests', 'demand: flows.requests * running'))).toEqual([
      'error: unknown-name: unknown name "running"',
    ])
  })
})
