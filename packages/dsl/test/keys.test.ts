import { describe, expect, it } from 'vitest'
import { compile, format } from '../src'

const SRC = `loadmap 1.8
load { max: 50 }

flow requests "requests" { rate: 100 * load; from: users; route: perTenant -> api -> appCache }

node users "Users"
node perTenant "Tenant limit" {
  limit {
    keys: 400
    skew: estimated(20%, "share", "the noisiest tenant")
  }
  capacity: configured(100, "req/s", "a tenant's plan")
  over: "a tenant's requests above its plan get 429s"
}
node api "API" {
  pass
  capacity: measured(10_000, "req/s")
  over: "requests queue"
}
node appCache "Cache" {
  pass
  capacity: measured(1_000, "req/s", "load test, 4 members")
  over: "reads queue"
}
node limited "Turned away" { lost { takes: [rejected] } }

connection ring {
  hop: api -> appCache
  members: 4
  busiest: estimated(32%, "share", "ring stats")
}

users -> perTenant
perTenant -> api
api -> appCache
perTenant -> limited
`
const errors = (src: string) =>
  compile(src).diagnostics.map((d) => `${d.severity}: ${d.code}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)

describe('a limit for each key and a busiest member in the language', () => {
  it('compiles, and reads as TypeScript does', () => {
    expect(format(SRC).text).toBe(SRC)
    expect(errors(SRC)).toEqual([])
    const ev = compile(SRC).definition!.model.evaluate({ load: 10 } as never)
    expect(ev.components.perTenant!.keys).toEqual({ count: 400, hottest: 0.2 })
    expect(ev.components.appCache!.spread).toMatchObject({ factor: expect.closeTo(1.28, 9) })
  })

  it('is from loadmap 1.8', () => {
    expect(errors(SRC.replace('loadmap 1.8', 'loadmap 1.7'))).toEqual([
      'error: language-version: "keys:" is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
      'error: language-version: "skew:" is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
      'error: language-version: "busiest:" is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
    ])
  })

  it('wants keys with a skew, a whole number of them, and no burst beside', () => {
    expect(errors(SRC.replace('    keys: 400\n', ''))).toEqual([
      "error: bad-value: skew is the hottest key's share: give the limit keys | keys: 400",
    ])
    expect(errors(SRC.replace('keys: 400', 'keys: 0'))).toEqual([
      'error: bad-value: keys is a whole number from 1, not 0',
    ])
    expect(errors(SRC.replace('    keys: 400\n', '    keys: 400\n    burst: 10\n'))).toEqual([
      'error: bad-value: a limit for each key takes no per or burst: each key has its own limit',
    ])
  })
})
