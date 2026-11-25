import { describe, expect, it } from 'vitest'
import { compile, format } from '../src'
import { edit, inspect } from '../src/internal'

const SRC = `loadmap 1.8
load { max: 10 }

param hopTries "Retries at payments" { options: [0, 2]; default: 2 }

expect "Orders lose under 1 %" { flow: orders; lost: 1% }

flow orders "orders" {
  rate: 100 * load
  retry { times: 1 }
  retry { at: payments; times: hopTries }
  from: users
  route: api -> payments
}

node users "Users"
node api "API" {
  pass
  capacity: measured(1_000, "req/s")
  over: "clients wait"
}
node payments "Payments" {
  pass
  fails: 20%
  capacity: measured(1_000, "req/s")
  over: "payments queue"
}
node errors "Errors" { lost { takes: [failed] } }

users -> api
api -> payments
payments -> errors
`

const errors = (src: string) =>
  compile(src).diagnostics.map((d) => `${d.severity}: ${d.code}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)

describe('a retry at a hop, in the language', () => {
  it('is one rule of the flow’s list, beside its client’s', () => {
    expect(format(SRC).text).toBe(SRC)
    const r = compile(SRC)
    expect(r.diagnostics).toEqual([])
    const m = r.definition!.model
    const rule = m.def.flows.orders!.retry as (v: object) => unknown
    expect(rule({ hopTries: 2 })).toEqual([{ times: 1 }, { times: 2, at: 'payments' }])
    // payments fails a fifth: 1.24 attempts there, 0.8 % failing them all; the client then fails 0.0064 %
    const ev = m.evaluate({ load: 1 })
    expect(ev.retry.orders!.hops!.payments).toMatchObject({ times: 2, attempts: expect.closeTo(1.24, 12) })
    expect(ev.retry.orders!.attempts).toBeCloseTo(100.8, 9)
    expect(ev.at.payments!.orders).toBeCloseTo(100.8 * 1.24, 9)
    expect(ev.lost.orders!.share).toBeCloseTo(0.008 ** 2, 12)
    expect(r.expectations.map((e) => `${e.result.outcome}: ${e.result.message}`)).toEqual([
      'pass: 0.0064 % of orders is lost at 1×, within 1 %',
    ])
    // the parameter switches the hop's rule off: the client's alone is left
    const off = m.evaluate({ load: 1, hopTries: 0 })
    expect(off.retry.orders!.hops).toBeUndefined()
    expect(off.lost.orders!.share).toBeCloseTo(0.04, 12)
  })

  it('leaves a flow’s one rule the one rule it was', () => {
    const one = compile(SRC.replace('  retry { at: payments; times: hopTries }\n', ''))
    expect(one.definition!.model.def.flows.orders!.retry).toEqual({ times: 1 })
  })

  it('is told from the flow’s other retries in the inspector: each rule has its own fields', () => {
    const src = SRC.replace('times: hopTries', 'times: 2')
    const retries = inspect(src, 'model')!.sections.filter((o) => o.keyword === 'retry')
    expect(retries.map((o) => [o.path, o.title, o.fields.map((f) => f.key)])).toEqual([
      ['flow:orders/retry', 'Retry', ['flow:orders/retry/times']],
      ['flow:orders/retry:payments', 'Retry at payments', ['flow:orders/retry:payments/times']],
    ])
    const lines = (key: string, value: number) => {
      const r = edit(src, key, value)
      return 'source' in r ? r.source.split('\n').filter((l) => l.includes('retry {')) : r
    }
    expect(lines('flow:orders/retry/times', 3)).toEqual(['  retry { times: 3 }', '  retry { at: payments; times: 2 }'])
    expect(lines('flow:orders/retry:payments/times', 1)).toEqual([
      '  retry { times: 1 }',
      '  retry { at: payments; times: 1 }',
    ])
  })

  it('says what is wrong with it', () => {
    expect(errors(SRC.replace('loadmap 1.8', 'loadmap 1.7'))).toContain(
      'error: language-version: "at:" is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
    )
    expect(errors(SRC.replace('retry { at: payments; times: hopTries }', 'retry { times: 2 }'))).toEqual([
      'error: duplicate: "retry" is set twice in this flow | a second retry is at a stage: retry { at: payments; times: 2 }',
    ])
    expect(
      errors(
        SRC.replace(
          'retry { at: payments; times: hopTries }',
          'retry { at: payments; times: 1 }\n  retry { at: payments; times: 2 }',
        ),
      ),
    ).toEqual(['error: duplicate: "retry" is set twice at "payments" in this flow'])
    expect(errors(SRC.replace('at: payments', 'at: nope'))).toEqual(['error: unknown-name: unknown stage "nope"'])
    expect(errors(SRC.replace('at: payments', 'at: errors'))).toEqual([
      'error: model: flow "orders" retries at "errors", which is not on its way',
    ])
    expect(errors(SRC.replace('at: payments', 'at: api -> payments'))).toEqual([
      'error: bad-route: a retry is at one stage of the route | at: payments',
    ])
  })
})

describe('a breaker with retries, in the language', () => {
  const src = `loadmap 1.7
load { max: 10 }

flow quotes "quotes" {
  rate: 200 * load
  retry { times: 2 }
  breaker { opens: 20% }
  from: shop
  route: pricing
}

node shop "Shop"
node pricing "Pricing" {
  pass
  capacity: measured(100, "req/s")
  over: "quotes fail"
}

shop -> pricing
`

  it('is read by a file of any version: the client’s attempts go through the breaker', () => {
    expect(format(src).text).toBe(src)
    const r = compile(src)
    expect(r.diagnostics).toEqual([])
    const ev = r.definition!.model.evaluate({ load: 1 })
    // the breaker admits the 125 a second at which pricing fails 20 %, of the 485 the client sends
    expect(ev.at.pricing!.quotes).toBeCloseTo(125, 6)
    expect(ev.retry.quotes!.attempts).toBeCloseTo(484.7322101863, 6)
    expect(ev.lost.quotes!.share).toBeCloseTo(0.5, 9)
  })

  it('takes no retry at a hop', () => {
    const hop = src
      .replace('loadmap 1.7', 'loadmap 1.8')
      .replace('retry { times: 2 }', 'retry { at: pricing; times: 2 }')
    expect(errors(hop)).toEqual([
      'error: model: flow "quotes" has a breaker and a retry at a hop: the breaker is in its callers, so give it the client\'s retry or none',
    ])
  })
})
