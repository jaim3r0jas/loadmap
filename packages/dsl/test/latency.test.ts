import { defineModel, measured, p, pass } from '@loadmap/core'
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

  it('times a flow out', () => {
    const r = compile(SRC.replace('route: a -> b }', 'route: a -> b; timeout: 0.2 }'))
    expect(r.diagnostics).toEqual([])
    const l = r.definition!.model.evaluate({ load: 1 }).latency.req!
    // a gamma of shape 1.6 and scale 50 ms (mean 80 ms): its share past 200 ms, scipy.special.gammaincc(1.6, 4)
    expect(l.timedOut).toBeCloseTo(0.05361299815678208, 10)
    // as TypeScript does, retries and all
    const both = SRC.replace('route: a -> b }', 'route: a -> b; timeout: 0.2; retry { times: 2 } }')
    const ts = defineModel({
      load: p.load({ max: 10 }),
      flows: { req: { rate: ({ load }) => 100 * load, timeout: 0.2, retry: { times: 2 } } },
      components: {
        a: { name: 'A', capacity: measured(200, 'req/s'), service: 0.01, over: 'clients wait' },
        b: { name: 'B', capacity: measured(200, 'req/s'), service: 0.03, over: 'clients wait' },
      },
      stages: { a: pass('a'), b: pass('b') },
      routes: { req: ['a', 'b'] },
    })
    for (const load of [1, 1.5])
      expect(compile(both).definition!.model.evaluate({ load }).retry).toEqual(ts.evaluate({ load }).retry)
    expect(errors(SRC.replace('route: a -> b }', 'route: a -> b; timeout: -1 }'))[0]).toMatch(
      /^error: a timeout is seconds above 0, not -1/,
    )
    const untimed = SRC.replace('route: a -> b }', 'route: a -> b; timeout: 1 }')
      .replace('  service: 0.01\n', '')
      .replace('  service: 0.03\n', '')
      .replace('expect "Fast to 1.2×" { flow: req; p99: 0.5; target: 1.2 }\n', '')
    expect(errors(untimed).join('\n')).toContain('flow "req" has a timeout but no latency')
  })
})
