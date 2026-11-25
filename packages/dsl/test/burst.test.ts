import { describe, expect, it } from 'vitest'
import { compile, format } from '../src'

const SRC = `loadmap 1.8
load { max: 10 }

flow searches "searches" { rate: 50 * load; from: users; route: limiter -> api }

node users "Users"
node limiter "Rate limiter" {
  limit { burst: 500 }
  capacity: configured(100, "req/s", "gateway config")
  over: "clients get 429s"
}
node api "API" {
  pass
  capacity: measured(1_000, "req/s")
  over: "requests queue"
}
node limited "Turned away" { lost { takes: [rejected] } }

users -> limiter
limiter -> api
limiter -> limited
`
const errors = (src: string) =>
  compile(src).diagnostics.map((d) => `${d.severity}: ${d.code}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)
const perMinute = SRC.replace('limit { burst: 500 }', 'limit { per: minute }').replace(
  'configured(100, "req/s", "gateway config")',
  'configured(6_000, "requests/minute", "plan")',
)

describe('a limit with a bucket', () => {
  it('compiles, and says how long the bucket lasts past the limit', () => {
    expect(format(SRC).text).toBe(SRC)
    expect(errors(SRC)).toEqual([])
    const m = compile(SRC).definition!.model
    expect(m.evaluate({ load: 1 } as never).components.limiter!.burst).toEqual({ size: 500, passes: 50 })
    expect(m.evaluate({ load: 6 } as never).components.limiter!.burst).toEqual({
      size: 500,
      passes: expect.closeTo(100, 9),
      lasts: expect.closeTo(2.5, 9),
    })
  })

  it('is from loadmap 1.8, and not on a quota', () => {
    expect(errors(SRC.replace('loadmap 1.8', 'loadmap 1.7'))).toEqual([
      'error: language-version: "burst:" is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
    ])
    expect(errors(SRC.replace('limit { burst: 500 }', 'limit {\n    per: minute\n    burst: 500\n  }'))).toContain(
      'error: bad-value: a quota per minute counts its window already: a burst is for a rate limit',
    )
    expect(errors(SRC.replace('burst: 500', 'burst: -5'))).toEqual([
      'error: bad-value: a burst is a number of units above 0, not -5',
    ])
  })
})

describe('a quota per minute', () => {
  it('counts a minute, from loadmap 1.8', () => {
    expect(errors(perMinute)).toEqual([])
    const ev = compile(perMinute).definition!.model.evaluate({ load: 3 } as never)
    expect(ev.components.limiter!.quota).toEqual({ per: 'minute', goneAfter: expect.closeTo(40, 9) })
    const old =
      'error: language-version: a quota per minute is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line'
    expect(errors(perMinute.replace('loadmap 1.8', 'loadmap 1.7'))).toEqual([old])
    // written quoted, too
    expect(errors(perMinute.replace('loadmap 1.8', 'loadmap 1.7').replace('per: minute', 'per: "minute"'))).toEqual([
      old,
    ])
  })

  it('warns when the capacity counts another window', () => {
    expect(errors(perMinute.replace('"requests/minute"', '"requests/hour"'))).toEqual([
      'warning: unit-mismatch: the quota is per minute; the capacity counts an hour | give what a minute allows: "requests/minute"',
    ])
  })
})
