import { describe, expect, it } from 'vitest'
import { compile, format } from '../src'

const SRC = `loadmap 1.8
load { max: 10 }

preset "Rush" { load: 3; lasts: 10min }

expect "The inbox is read again after a rush" { preset: "Rush"; queue: inbox; lag: 1min; clears: 5min }

flow jobs "jobs" { rate: 100 * load; from: users; route: api -> inbox -> runners -> db }

node users "Users"
node api "API" {
  pass
  capacity: measured(10_000, "req/s")
  over: "clients wait"
}
cluster buffer "Buffer" {
  members: 1
  queue inbox "inbox" {
    holds: 5_000
    partitions { jobs: 1 }
  }
}
pool runners "Runners" {
  pods: 2
  perPod: 4
  demand: flows.jobs * 10ms
  capacity: measured(2, "cores")
  over: "jobs wait in the inbox"
}
node db "DB" {
  pass
  capacity: measured(10_000, "req/s")
  over: "writes wait"
}
node refused "Refused" { lost { takes: [rejected] } }

users -> api
api -> buffer
buffer -> runners
runners -> db
buffer -> refused
`
const LINE = 'expect "The inbox is read again after a rush" { preset: "Rush"; queue: inbox; lag: 1min; clears: 5min }'
const withLine = (line: string, src = SRC) => src.replace(LINE, line)
const errors = (src: string) =>
  compile(src).diagnostics.map((d) => `${d.severity}: ${d.code}: ${d.message}${d.hint ? ` | ${d.hint}` : ''}`)
const said = (src: string) => compile(src).expectations.map((e) => `${e.result.outcome}: ${e.result.message}`)

describe('an expect on a moment', () => {
  it('holds the lag when the preset ends and the time to clear after it', () => {
    expect(format(SRC).text).toBe(SRC)
    expect(errors(SRC)).toEqual([])
    expect(compile(SRC).definition!.model.expectations).toEqual([
      { label: 'The inbox is read again after a rush', preset: 'Rush', queue: 'inbox', lag: 60, clears: 300 },
    ])
    expect(said(SRC)).toEqual([
      'pass: after 10 min of Rush, the oldest unit in inbox waited 25 s; inbox clears in 50 s at 1×',
    ])
  })

  it('fails with what it expected and what it found, for every queue without one', () => {
    expect(said(withLine('expect "Rush" { preset: "Rush"; lag: 10s }'))).toEqual([
      'fail: expected a lag of at most 10 s after 10 min of Rush, but the oldest unit in inbox waited 25 s',
    ])
  })

  it('is inconclusive when it holds only at the high edge of a ±', () => {
    const src = withLine('expect "Rush" { preset: "Rush"; clears: 60s }').replace(
      'measured(2, "cores")',
      'measured(2 +- 30%, "cores")',
    )
    expect(said(src)).toEqual([
      'inconclusive: expected every queue to clear within 1 min after 10 min of Rush, but inbox clears in 2 min at 1×',
    ])
  })

  it('takes a severity', () => {
    const r = compile(withLine('expect "Rush" { preset: "Rush"; lag: 10s; severity: warn }'))
    expect(r.definition!.model.expectations[0]).toMatchObject({ severity: 'warn' })
  })

  it('is from loadmap 1.8', () => {
    const old = withLine('expect "Rush" { preset: "Rush"; lag: 10s }')
      .replace('loadmap 1.8', 'loadmap 1.7')
      .replace('    holds: 5_000\n', '')
    expect(errors(old)).toEqual(
      expect.arrayContaining([
        'error: language-version: "preset:" is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
        'error: language-version: "lag:" is from loadmap 1.8; this definition says loadmap 1.7 | write "loadmap 1.8" on the first line',
      ]),
    )
  })

  it('needs a preset that lasts, and a lag or a time to clear', () => {
    expect(errors(withLine('expect "Rush" { lag: 10s }'))).toEqual([
      'error: bad-expect: lag is what a moment leaves in a queue: name the preset that lasts | preset: "Sale day"; lag: 5min',
    ])
    expect(errors(withLine('expect "Rush" { preset: "Rush" }'))).toEqual([
      'error: bad-expect: preset is for a moment: say the lag it may leave, or the time to clear it | preset: "Sale day"; lag: 5min',
    ])
    expect(errors(withLine('expect "Rush" { preset: "Rash"; lag: 10s }'))).toEqual([
      'error: unknown-name: unknown preset that lasts "Rash" | did you mean "Rush"?',
    ])
    // a preset with no length is no moment
    expect(errors(withLine('expect "Rush" { preset: "Rush"; lag: 10s }').replace('; lasts: 10min', ''))).toEqual([
      'error: unknown-name: unknown preset that lasts "Rush"',
    ])
  })

  it('names a queue, takes nothing else, and a time above 0', () => {
    expect(errors(withLine('expect "Rush" { preset: "Rush"; queue: api; lag: 10s }'))).toEqual([
      'error: unknown-name: unknown queue "api"',
    ])
    expect(errors(withLine('expect "Rush" { preset: "Rush"; flow: jobs; lag: 10s }'))).toEqual([
      'error: bad-expect: an expect on a moment takes no flow',
    ])
    expect(errors(withLine('expect "Rush" { preset: "Rush"; lag: 0 }'))).toEqual([
      'error: out-of-range: lag is a time above 0',
    ])
  })
})
