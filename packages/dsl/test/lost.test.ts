import { describe, expect, it } from 'vitest'
import { compile, format } from '../src'

const SRC = `loadmap 1.8
load { max: 10 }

expect "Quotes lose under 10 % to 0.5×" { flow: quotes; lost: 10%; underTarget: 0.5× }
expect "Nothing is lost when it is quiet" { scenario: "Quiet"; lost: 0% }

param quiet "Quiet" { default: false }

scenario "Today" {}
scenario "Quiet" { quiet: true }

flow quotes "quotes" { rate: (quiet ? 80 : 200) * load; from: users; route: api -> pricing }

node users "Users"
node api "API" {
  pass
  capacity: measured(10_000, "req/s")
  over: "clients wait"
}
node pricing "Pricing" {
  pass
  short: "pricing"
  capacity: measured(100, "req/s")
  over: "quotes fail"
}

users -> api
api -> pricing
`

const errors = (src: string) =>
  compile(src).diagnostics.map((d) => `${d.severity}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)

describe('what is lost, in an expect', () => {
  it('holds a share of one flow or of each, as TypeScript does', () => {
    expect(format(SRC).text).toBe(SRC)
    const r = compile(SRC)
    expect(r.diagnostics).toEqual([])
    expect(r.definition!.model.expectations).toEqual([
      { label: 'Quotes lose under 10 % to 0.5×', flow: 'quotes', lost: 0.1, underTarget: 0.5 },
      { label: 'Nothing is lost when it is quiet', scenario: 'Quiet', lost: 0 },
    ])
    // pricing takes 100 of 200 × load: 10 % are lost from 0.56×; quiet sends 80
    expect(r.expectations.map((e) => `${e.result.outcome}: ${e.result.message}`)).toEqual([
      'pass: at most 10 % of quotes is lost up to 0.5×',
      'pass: nothing is lost at 1× in Quiet',
    ])
    expect(r.definition!.model.evaluate({ load: 1 }).lost.quotes!.share).toBeCloseTo(0.5, 9)
  })

  it('says what is wrong with it', () => {
    const line = (s: string) => SRC.replace('flow: quotes; lost: 10%; underTarget: 0.5×', s)
    expect(errors(line('lost: 100%'))).toEqual(['error: lost is a share from 0, below 100% | lost: 0.1%'])
    expect(errors(line('lost: 10%; component: api'))).toEqual(['error: an expect on what is lost takes no component'])
    expect(errors(line('flow: quotes; lost: 10%; p99: 1'))).toEqual(['error: an expect on what is lost takes no p99'])
    expect(errors(line('lost: 10%; notFull: 3'))).toEqual(['error: an expect on what is lost takes no notFull'])
    expect(errors(line('flow: quote; lost: 10%'))).toEqual(['error: unknown flow "quote" | did you mean "quotes"?'])
    // the unit is checked on its own pass, so a load multiple is told twice: out of range, and not a share
    expect(errors(line('lost: 3×'))).toContain(
      'error: lost is a share, and this is a load multiple | write a share: 0.8 or 80%; a load multiple goes in expect { underTarget: … }',
    )
    // without a load multiple it is checked at the values, so it needs none
    expect(errors(line('lost: 60%'))).toEqual([])
  })

  it('is from loadmap 1.8', () => {
    const d = compile(SRC.replace('loadmap 1.8', 'loadmap 1.7')).diagnostics
    expect(d).toMatchObject([
      {
        severity: 'error',
        code: 'language-version',
        message: '"lost:" is from loadmap 1.8; this definition says loadmap 1.7',
        hint: 'write "loadmap 1.8" on the first line',
      },
    ])
  })
})
