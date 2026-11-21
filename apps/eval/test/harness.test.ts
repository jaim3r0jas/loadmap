import { compile } from '@loadmap/dsl'
import { recorded } from '@loadmap/dsl/assist'
import { describe, expect, it } from 'vitest'
import { CASES } from '../src/cases'
import { exampleProject, runCase, table } from '../src/harness'

const clock = () => 0

describe('the eval', () => {
  it('has forty cases with their own names, each on an example that compiles', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40)
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length)
    for (const example of new Set(CASES.map((c) => c.example))) {
      const p = exampleProject(example)
      const errors = compile(p.files[p.entry]!, { path: p.entry, files: p.files }).diagnostics.filter(
        (d) => d.severity === 'error',
      )
      expect(errors, example).toEqual([])
    }
  })

  it('passes a case a good answer meets, and says why a poor one fails', async () => {
    const c = CASES.find((x) => x.id === 'scenario-add')!
    const good = await runCase(c, {
      model: recorded(['```ops\nput\n  scenario "Sixteen pods" { pods: 16 }\n```']),
      reference: '# ref',
      clock,
    })
    expect(good).toMatchObject({ id: 'scenario-add', pass: true, failed: [], repairs: 0 })
    const poor = await runCase(c, {
      model: recorded(['```ops\nput\n  scenario "Eight" { pods: 8 }\n```']),
      reference: '# ref',
      clock,
    })
    expect(poor.pass).toBe(false)
    expect(poor.failed).toEqual(['lacks scenario "Sixteen pods"', 'lacks 16'])
  })

  it('wants a question where the request cannot be done, and no change', async () => {
    const c = CASES.find((x) => x.id === 'vague')!
    expect(
      (await runCase(c, { model: recorded(['```questions\nBetter how?\n```']), reference: '# ref', clock })).pass,
    ).toBe(true)
    const changed = await runCase(c, {
      model: recorded(['```ops\nset web.short to "the web"\n```']),
      reference: '# ref',
      clock,
    })
    expect(changed.failed).toEqual(['no question back', 'changed the files instead of asking'])
  })

  it('counts a model that fails as a failed case, not a crash', async () => {
    const r = await runCase(CASES[0]!, { model: recorded([]), reference: '# ref', clock })
    expect(r).toMatchObject({ pass: false, error: 'the recording has no more answers' })
  })

  it('writes a table a model per row, then each case', () => {
    const md = table([
      {
        model: 'm',
        form: 'operations',
        results: [{ id: 'a', pass: true, failed: [], repairs: 1, input: 10, output: 2, cached: 5, ms: 2000 }],
      },
    ])
    expect(md).toContain('| m | operations | 1 of 1 | 1 | 10 | 5 | 2 | 2 |')
    expect(md).toContain('| a | pass (1 repair) |')
  })
})
