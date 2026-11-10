import { describe, expect, it } from 'vitest'
import { compile, format } from '../src'

const SRC = `loadmap 1
load { max: 10 }

expect "Fast to 1.2×" { flow: req; p99: 0.5; target: 1.2 }

flow req "requests" { rate: 100 * load; from: users; route: a -> b }

node users "Users"
node a "A" {
  pass
  capacity: measured(200, "req/s")
  service: 0.01
  over: "clients wait"
}
node b "B" {
  pass
  capacity: measured(200, "req/s")
  service: 0.03
  over: "clients wait"
}

users -> a
a -> b
`

const errors = (src: string) =>
  compile(src).diagnostics.map((d) => `${d.severity}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)

describe('latency in the language', () => {
  it('times a flow and holds it to an expect, as TypeScript does', () => {
    expect(format(SRC).text).toBe(SRC)
    const r = compile(SRC)
    expect(r.diagnostics).toEqual([])
    // both queues at half: 20 ms and 60 ms, twice the 10 and 30 ms of the scipy case; 500 ms at 1.41×
    const l = r.definition!.model.evaluate({ load: 1 }).latency.req!
    expect(l.mean).toBeCloseTo(0.08, 12)
    expect(l.p99).toBeCloseTo(2 * 0.14679841222476767, 9)
    expect(r.expectations.map((e) => e.result.outcome)).toEqual(['pass'])
    expect(r.definition!.model.expectations[0]).toEqual({ label: 'Fast to 1.2×', flow: 'req', p99: 0.5, target: 1.2 })
  })

  it('says what is wrong with it', () => {
    const line = (s: string) => SRC.replace('flow: req; p99: 0.5; target: 1.2', s)
    expect(errors(line('p99: 0.5; target: 1.2'))).toContain(
      'error: p99 is the latency of a flow: name it | flow: orders',
    )
    expect(errors(line('flow: req; p50: 0.1; p99: 0.5'))).toContain(
      'error: the latency of "req" takes one of p50, p95 or p99 | p99: 0.5',
    )
    expect(errors(line('flow: req; p99: 0.5; component: a'))).toContain(
      'error: an expect on the latency of "req" takes no component',
    )
    expect(errors(line('flow: req; p99: -1'))).toContain('error: p99 is a time in seconds above 0')
    expect(errors(line('flow: reqs; p99: 0.5'))[0]).toMatch(/^error: unknown flow "reqs"/)
    expect(errors(SRC.replace('service: 0.03', 'service: -0.03'))[0]).toMatch(
      /^error: a service time is seconds from 0 up, not -0.03/,
    )
  })
})
