import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { providerFromEnv } from '@loadmap/dsl/assist'
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
it('runs the eval', async () => {
  const env = process.env
  const models = (env.LOADMAP_EVAL_MODELS ?? 'anthropic:claude-haiku-5-5')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const forms = (env.LOADMAP_EVAL_FORMS ?? 'operations').split(',').map((s) => s.trim()) as ('operations' | 'files')[]
  const only = env.LOADMAP_EVAL_CASES?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const cases = only?.length ? CASES.filter((c) => only.includes(c.id)) : CASES
  const reference = fullReference()
  const runs: { model: string; form: string; results: CaseResult[] }[] = []
  for (const spec of models) {
    const [provider, ...rest] = spec.split(':')
    const model = providerFromEnv(env, { provider: provider!, ...(rest.length && { model: rest.join(':') }) })
    for (const form of forms) {
      const results: CaseResult[] = []
      for (const c of cases) {
        const r = await runCase(c, { model, reference, form })
        results.push(r)
        console.log(`${model.model} ${form} ${c.id}: ${r.pass ? 'pass' : `fail: ${r.error ?? r.failed.join('; ')}`}`)
      }
      runs.push({ model: model.model, form, results })
    }
  }
  const out = new URL('../out/', import.meta.url)
  mkdirSync(out, { recursive: true })
  writeFileSync(new URL('results.json', out), `${JSON.stringify(runs, null, 2)}\n`)
  const md = table(runs)
  writeFileSync(new URL('results.md', out), `${md}\n`)
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `## The eval\n\n${md}\n`)
  expect(runs.length).toBeGreaterThan(0)
})
