import { moment } from '@loadmap/core/moments'
import { describe, expect, it } from 'vitest'
import { compile, format } from '../src'

const SRC = `loadmap 1.8
load { max: 20 }

preset "Flash sale" { load: 8; lasts: 10min; ramp: 30s }

flow requests "requests" { rate: 100 * load; from: users; route: front -> api }

node users "Users"
node front "Front" {
  pass { component: api }
}
pool api "API" "2 to 12 pods" {
  perPod: 4
  autoscale { min: 2; max: 12; target: 0.7; ready: 90s }
  short: "the API"
  demand: flows.requests
  capacity: measured(12 * 100, "req/s", "load test, 12 pods")
  over: "requests are turned away at the front"
}
node refused "Turned away" { lost { takes: [rejected] } }

users -> front
front -> api
front -> refused
`
const errors = (src: string) =>
  compile(src).diagnostics.map((d) => `${d.severity}: ${d.code}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)

describe('a moment in the language', () => {
  it('takes a ramp on a preset and a ready time on an autoscaler', () => {
    expect(format(SRC).text).toBe(SRC)
    expect(errors(SRC)).toEqual([])
    const m = compile(SRC).definition!.model
    expect(m.def.ramps).toEqual({ 'Flash sale': 30 })
    expect(m.evaluate({} as never).stages.api).toMatchObject({ autoscale: { ready: 90 } })
    expect(moment(m, {}, 'Flash sale').text).toBe(
      '8× in 30 s: up to 75 % of requests is lost for 103 s, until the eighth pod of the API is ready.',
    )
  })

  it('is from loadmap 1.8', () => {
    expect(errors(SRC.replace('loadmap 1.8', 'loadmap 1.7'))).toEqual([
      'error: language-version: "ramp:" is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
      'error: language-version: "ready:" is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
    ])
  })

  it('wants a ramp with a length, and times from 0', () => {
    expect(errors(SRC.replace('lasts: 10min; ramp: 30s', 'ramp: 30s'))).toEqual([
      'error: bad-value: a ramp is the way up to a moment: say how long it lasts | lasts: 10min',
    ])
    expect(errors(SRC.replace('ramp: 30s', 'ramp: -3s'))).toEqual(['error: out-of-range: a ramp is a time from 0'])
    expect(errors(SRC.replace('ready: 90s', 'ready: -1s'))).toEqual([
      'error: bad-value: a pod is ready a time from 0 seconds after it is wanted, not -1',
    ])
  })

  it('leaves a parameter named ramp a value of the preset', () => {
    const src = SRC.replace(
      'preset "Flash sale"',
      'param ramp "Ramp" { options: [1, 2]; default: 1 }\n\npreset "Flash sale"',
    ).replace('ramp: 30s', 'ramp: 2')
    const m = compile(src).definition!.model
    expect(m.def.ramps).toBeUndefined()
    expect(m.def.presets).toEqual({ 'Flash sale': { load: 8, ramp: 2 } })
  })
})
