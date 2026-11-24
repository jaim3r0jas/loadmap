import { describe, expect, it } from 'vitest'
import { compile, format } from '../src'

const SRC = `loadmap 1.8
load { max: 10 }

param far "Far region" { default: false }

flow req "requests" { rate: 100 * load; from: users; route: a -> b }
flow jobs "jobs" { rate: 1; from: cron; route: a }

node users "Users"
node cron "Cron"
node a "A" {
  pass
  capacity: measured(200, "req/s")
  service: 10ms
  over: "clients wait"
}
node b "B" {
  pass
  capacity: measured(200, "req/s")
  service: 30ms
  over: "clients wait"
}

users -> a: "HTTPS" { delay: 80ms }
cron -> a
a -> b { delay: far ? 60ms : 2ms }
`

const errors = (src: string) =>
  compile(src).diagnostics.map((d) => `${d.severity}: ${d.code}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)

describe('a delay on an edge', () => {
  it('is the model’s: of the hop between two stages, or into the first for the flows that start at the box', () => {
    expect(format(SRC).text).toBe(SRC)
    const r = compile(SRC)
    expect(r.diagnostics).toEqual([])
    const m = r.definition!.model
    expect(m.def.delays).toEqual([
      { to: 'a', delay: 0.08, flows: ['req'] },
      { from: 'a', to: 'b', delay: expect.any(Function) },
    ])
    // A at 101 of 200 (20.2 ms), B at half (60 ms), 80 ms in and 2 ms between
    const w = 0.01 / (1 - 101 / 200)
    expect(m.evaluate({ load: 1 }).latency.req!.mean).toBeCloseTo(w + 0.06 + 0.082, 12)
    expect(m.evaluate({ load: 1, far: true }).latency.req!.mean).toBeCloseTo(w + 0.06 + 0.14, 12)
    // the jobs start at cron: the users' delay is not theirs
    expect(m.evaluate({ load: 1 }).latency.jobs!.mean).toBeCloseTo(w, 12)
  })

  it('is said on the edge, after its label', () => {
    const r = compile(SRC).definition!
    const { def } = r.view as unknown as { def: { edges: { label?: string | ((ctx: unknown) => string) }[] } }
    const m = r.model
    const said = (values: object) =>
      def.edges.map((e) => (typeof e.label === 'function' ? e.label(m.evaluate(values as never).ctx) : e.label))
    expect(said({})).toEqual(['HTTPS · 80 ms', undefined, '2 ms'])
    expect(said({ far: true })).toEqual(['HTTPS · 80 ms', undefined, '60 ms'])
  })

  it('says what is wrong with it', () => {
    expect(errors(SRC.replace('loadmap 1.8', 'loadmap 1.7'))).toEqual([
      'error: language-version: "delay:" is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
    ])
    expect(errors(SRC.replace('delay: 80ms', 'delay: -1s'))).toEqual([
      'error: bad-value: a delay is seconds from 0 up, not -1',
    ])
    expect(errors(SRC.replace('delay: 80ms', 'delay: flows.req'))).toEqual([
      'error: wrong-scope: this formula reads only parameters; it cannot read flows.req',
    ])
    // into a box that does nothing with a flow, along a chain, and where no flow goes
    expect(errors(SRC.replace('cron -> a', 'cron -> a\nb -> users { delay: 1ms }'))).toEqual([
      'error: bad-edge: a delay is the time into a stage, and "users" does nothing with a flow',
    ])
    expect(errors(SRC.replace('cron -> a', 'cron -> a -> b { delay: 1ms }'))).toEqual([
      'error: bad-edge: a delay goes on a single edge: a -> b { … }',
    ])
    expect(errors(SRC.replace('cron -> a', 'cron -> a\ncron -> b { delay: 1ms }'))).toEqual([
      `warning: unused-delay: no flow goes from "cron" straight to "b": the delay counts for none | a delay goes on a hop of a route, or on the edge from a flow's "from" box to its first stage`,
    ])
  })
})
