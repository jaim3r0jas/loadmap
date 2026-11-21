import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { type ModelProvider, providerFromEnv } from '@loadmap/dsl/assist'
import { expect, it } from 'vitest'
import { fullReference } from '../../../scripts/reference'
import { CASES } from '../src/cases'
import { type CaseResult, runCase, table } from '../src/harness'

/**
 * The live run: every case against each model named in LOADMAP_EVAL_MODELS ("anthropic:claude-haiku-5-5,
 * deepseek:deepseek-flash"), in each form of LOADMAP_EVAL_FORMS ("operations,files"), the cases filtered by
 * LOADMAP_EVAL_CASES. Keys come from the environment as `loadmap ask` reads them. The table goes to out/ and to the
 * job's summary; it fails nothing: a model's answer is a measurement.
 */
const FORMS = new Set(['operations', 'files'])

it('runs the eval', async () => {
  const env = process.env
  const models = (env.LOADMAP_EVAL_MODELS ?? 'anthropic:claude-haiku-5-5')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const forms = (env.LOADMAP_EVAL_FORMS ?? 'operations').split(',').map((s) => s.trim())
  const wrong = forms.filter((f) => !FORMS.has(f))
  if (wrong.length) throw new Error(`no form ${wrong.join(', ')}: operations, files, or both comma-separated`)
  const only = env.LOADMAP_EVAL_CASES?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const unknown = only?.filter((id) => !CASES.some((c) => c.id === id)) ?? []
  if (unknown.length) throw new Error(`no case ${unknown.join(', ')}`)
  const cases = only?.length ? CASES.filter((c) => only.includes(c.id)) : CASES
  // each provider reads its own key: never one key for all of them
  const keys = { ...env }
  delete keys.LOADMAP_AI_KEY
  delete keys.LOADMAP_AI_URL
  delete keys.LOADMAP_AI_MODEL
  const reference = fullReference()
  const out = new URL('../out/', import.meta.url)
  mkdirSync(out, { recursive: true })
  const runs: { model: string; form: string; results: CaseResult[] }[] = []
  // each run written as it ends: a timeout or a missing key later keeps what was paid for
  const write = () => {
    writeFileSync(new URL('results.json', out), `${JSON.stringify(runs, null, 2)}\n`)
    writeFileSync(new URL('results.md', out), `${table(runs)}\n`)
  }
  const problems: string[] = []
  for (const spec of models) {
    const [provider, ...rest] = spec.split(':')
    let model: ModelProvider
    try {
      model = providerFromEnv(keys, { provider: provider!, ...(rest.length && { model: rest.join(':') }) })
    } catch (err) {
      problems.push(`${spec}: ${(err as Error).message}`)
      continue
    }
    for (const form of forms as ('operations' | 'files')[]) {
      const run = { model: spec, form, results: [] as CaseResult[] }
      runs.push(run)
      for (const c of cases) {
        const r = await runCase(c, { model, reference, form })
        run.results.push(r)
        console.log(`${spec} ${form} ${c.id}: ${r.pass ? 'pass' : `fail: ${r.error ?? r.failed.join('; ')}`}`)
      }
      write()
    }
  }
  write()
  const md = `${table(runs)}${problems.length ? `\n\n${problems.map((p) => `- ${p}`).join('\n')}` : ''}`
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `## The eval\n\n${md}\n`)
  expect(problems).toEqual([])
})
