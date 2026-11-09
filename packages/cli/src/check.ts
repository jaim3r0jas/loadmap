import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import type { Snapshot } from '@loadmap/core'
import { fromSnapshot, parseSnapshot } from '@loadmap/core/measure'
import { type CompileResult, compile, type Diagnostic, formatDiagnostic, loadCatalogFor, problems } from '@loadmap/dsl'
import { type PullCommandOptions, type PullWindow, pullFor, snapshotPath, WINDOW_OPTIONS, windowOf } from './pull'

export interface CheckOptions extends PullCommandOptions {
  log?: (s: string) => void
  /** Where GITHUB_ACTIONS, GITHUB_SHA and GITHUB_STEP_SUMMARY are read from: annotations are the default there. */
  env?: Readonly<Record<string, string | undefined>>
}

/** One expectation in the result a run writes (`--json`, `--format json`). */
export interface CheckedExpectation {
  label: string | null
  line: number
  severity: 'warn' | 'fail'
  outcome: 'pass' | 'fail' | 'inconclusive'
  message: string
  reasons: string[]
  /** Where the target and 100 % are reached, at the low and the high bounds; null when off. */
  target: { low: number | null; high: number | null } | null
  full: { low: number | null; high: number | null } | null
}

/** One definition in a run's result: what it found, against which data. */
export interface CheckedFile {
  file: string
  /** fail and error fail the run; inconclusive does with `--inconclusive fail`. */
  outcome: 'pass' | 'fail' | 'inconclusive' | 'error'
  snapshot: { fetched: string; from: string; to: string } | null
  diagnostics: { severity: Diagnostic['severity']; line: number; column: number; message: string }[]
  expectations: CheckedExpectation[]
  /** The component that reaches the target first at the defaults, on the pessimistic edge. */
  firstLimit: string | null
  /** Each component at the defaults: utilization, and the load multiples of the target and of 100 %, both edges. */
  components: {
    id: string
    name: string
    util: number | null
    target: { low: number | null; high: number | null } | null
    full: { low: number | null; high: number | null } | null
    capacity: { value: number; unit: string; provenance: string; source: string | null } | null
  }[]
}

/**
 * `loadmap check`: compiles each definition and tests its expect lines, against fresh data with `--pull` or a
 * snapshot with `--snapshot`. Each ends pass, fail or inconclusive (data missing, or a ± that decides it). Resolves to
 * the exit code: 1 when a definition has an error or an expectation fails (an inconclusive one too with `--inconclusive
 * fail`; a `severity: warn` one never), 2 for a usage mistake, 0 otherwise, and 0 always with `--dry-run`.
 */
export async function check(argv: string[], o: CheckOptions = {}): Promise<number> {
  const log = o.log ?? console.log
  const env = o.env ?? process.env
  let a: ReturnType<typeof parse>
  try {
    a = parse(argv, env, o.now?.() ?? new Date())
  } catch (err) {
    log((err as Error).message)
    return 2
  }
  const text = a.format !== 'json'
  const say = (s: string) => text && log(s)
  const files: CheckedFile[] = []
  let failed = false
  for (const file of a.files) {
    let source: string
    try {
      source = await readFile(file, 'utf8')
    } catch (err) {
      say(`${file}: cannot read it (${(err as NodeJS.ErrnoException).code ?? (err as Error).message})`)
      files.push(errorFile(file, 'cannot read it'))
      failed = true
      continue
    }
    await loadCatalogFor(source)

    let snapshot: Snapshot | undefined
    let first: CompileResult | undefined
    if (a.snapshot != null) {
      try {
        snapshot = parseSnapshot(await readFile(a.snapshot, 'utf8'))
      } catch (err) {
        const why = (err as NodeJS.ErrnoException).code ?? (err as Error).message.replace(/^loadmap: /, '')
        say(`${a.snapshot}: cannot read it (${why})`)
        files.push(errorFile(file, `the snapshot cannot be read (${why})`))
        failed = true
        continue
      }
    } else if (a.pull) {
      first = compile(source)
      if (first.ok && first.measures.length) {
        const pulled = await pullFor(file, first, a.pull, a.out ?? snapshotPath(file), o, say)
        if (pulled === 1) {
          files.push(errorFile(file, 'a provider it needs is not configured'))
          failed = true
          continue
        }
        snapshot = pulled
      }
    }

    // nothing pulled: the first compile is the answer
    const r = snapshot ? compile(source, { snapshot: fromSnapshot(snapshot) }) : (first ?? compile(source))
    const list = problems(r, 'error', a.inconclusive === 'fail' ? 'error' : 'warning')
    if (a.format === 'github') for (const d of list) log(github(d, file, source))
    if (text) for (const d of list) log(formatDiagnostic(d, source, file))
    const errors = r.diagnostics.filter((d) => d.severity === 'error').length
    const checked = checkedFile(file, r, list, snapshot)
    files.push(checked)
    if (checked.outcome === 'error' || checked.outcome === 'fail') failed = true
    if (checked.outcome === 'inconclusive' && a.inconclusive === 'fail') failed = true
    say(summary(file, errors, checked.expectations))
    for (const e of r.expectations)
      if (e.result.ok) say(`  ✓ ${e.result.expectation.label ?? `line ${e.line}`}: ${e.result.message}`)
  }

  const result = { version: 1, commit: a.commit, files }
  if (a.json != null) await writeFile(a.json, `${JSON.stringify(result, null, 2)}\n`)
  if (!text) log(JSON.stringify(result, null, 2))
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, jobSummary(files, a.dryRun))
  if (a.dryRun) {
    if (failed) say('dry run: this would fail; it exits 0')
    return 0
  }
  return failed ? 1 : 0
}

function errorFile(file: string, message: string): CheckedFile {
  return {
    file,
    outcome: 'error',
    snapshot: null,
    diagnostics: [{ severity: 'error', line: 0, column: 0, message }],
    expectations: [],
    firstLimit: null,
    components: [],
  }
}

/** Infinity (never) and NaN have no JSON: they are written null. */
const num = (x: number | null | undefined) => (x != null && Number.isFinite(x) ? x : null)
const range = (x: { low: number; high: number } | null) => (x ? { low: num(x.low), high: num(x.high) } : null)

function checkedFile(file: string, r: CompileResult, list: Diagnostic[], snapshot: Snapshot | undefined): CheckedFile {
  const expectations: CheckedExpectation[] = r.expectations.map((e) => ({
    label: e.result.expectation.label ?? null,
    line: e.line,
    severity: e.result.expectation.severity ?? 'fail',
    outcome: e.result.outcome,
    message: e.result.message,
    reasons: e.result.reasons,
    target: range(e.result.target),
    full: range(e.result.full),
  }))
  const hard = expectations.filter((e) => e.severity === 'fail')
  const outcome: CheckedFile['outcome'] = r.diagnostics.some((d) => d.severity === 'error')
    ? 'error'
    : hard.some((e) => e.outcome === 'fail')
      ? 'fail'
      : hard.some((e) => e.outcome === 'inconclusive')
        ? 'inconclusive'
        : 'pass'
  // a definition with an error may still have a model whose evaluation throws: nothing to report from it
  let ev: ReturnType<NonNullable<CompileResult['definition']>['model']['evaluate']> | undefined
  try {
    ev = r.ok ? r.definition?.model.evaluate() : undefined
  } catch {
    ev = undefined
  }
  return {
    file,
    outcome,
    snapshot: snapshot ? { fetched: snapshot.fetched, from: snapshot.from, to: snapshot.to } : null,
    diagnostics: list.map((d) => ({ severity: d.severity, line: d.line, column: d.column, message: d.message })),
    expectations,
    firstLimit: ev?.firstLimit?.id ?? null,
    components: Object.values(ev?.components ?? {}).map((c) => ({
      id: c.id,
      name: c.name,
      util: num(c.util),
      target: range(c.targetRange),
      full: range(c.fullRange),
      capacity: c.capacity
        ? {
            value: c.capacity.value,
            unit: c.capacity.unit,
            provenance: c.capacity.provenance,
            source: c.capacity.source ?? null,
          }
        : null,
    })),
  }
}

/** The line under a definition's problems: what it found. */
function summary(file: string, errors: number, es: readonly CheckedExpectation[]): string {
  const many = (k: number, one: string, more: string) => `${k} ${k === 1 ? one : more}`
  if (errors) return `${file}: does not compile (${many(errors, 'error', 'errors')})`
  const n = es.length
  if (!n) return `${file}: compiles; it has no expect lines`
  const failed = es.filter((e) => e.outcome === 'fail' && e.severity === 'fail').length
  const warned = es.filter((e) => e.outcome !== 'pass' && e.severity === 'warn').length
  const unsure = es.filter((e) => e.outcome === 'inconclusive' && e.severity === 'fail').length
  if (!failed && !warned && !unsure) return `${file}: ${many(n, 'expectation holds', 'expectations hold')}`
  if (!warned && !unsure) return `${file}: ${failed} of ${many(n, 'expectation', 'expectations')} failed`
  const parts = [failed && `${failed} failed`, unsure && `${unsure} inconclusive`, warned && `${warned} warned`]
  return `${file}: of ${many(n, 'expectation', 'expectations')}, ${parts.filter(Boolean).join(', ')}`
}

const MARK = { pass: '✅', fail: '❌', inconclusive: '❔', error: '❌', warn: '⚠️' } as const

/** The job summary under GitHub Actions: each definition, then each expectation and what it found. */
function jobSummary(files: readonly CheckedFile[], dryRun: boolean): string {
  const cell = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ')
  const out = ['### loadmap check', '']
  if (dryRun) out.push('A dry run: nothing here fails the job.', '')
  for (const f of files) {
    const window = f.snapshot ? ` · data ${f.snapshot.from} to ${f.snapshot.to}` : ''
    out.push(`${MARK[f.outcome]} \`${cell(f.file)}\`: ${f.outcome}${window}`, '')
    // what stopped it, when nothing was checked
    if (f.outcome === 'error')
      for (const d of f.diagnostics.filter((x) => x.severity === 'error'))
        out.push(`- ${d.line ? `line ${d.line}: ` : ''}${cell(d.message)}`)
    if (f.outcome === 'error') out.push('')
    if (!f.expectations.length) continue
    out.push('| | Expectation | Outcome | What was found |', '| --- | --- | --- | --- |')
    for (const e of f.expectations) {
      const what =
        e.outcome === 'inconclusive' && e.reasons.length ? `${e.reasons.join('; ')}; ${e.message}` : e.message
      const soft = e.severity === 'warn' && e.outcome !== 'pass'
      const outcome = soft ? `${e.outcome} (a warning)` : e.outcome
      out.push(
        `| ${MARK[soft ? 'warn' : e.outcome]} | ${cell(e.label ?? `line ${e.line}`)} | ${outcome} | ${cell(what)} |`,
      )
    }
    out.push('')
  }
  return `${out.join('\n')}\n`
}

function parse(argv: string[], env: Readonly<Record<string, string | undefined>>, now: Date) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      format: { type: 'string' },
      pull: { type: 'boolean' },
      snapshot: { type: 'string' },
      inconclusive: { type: 'string' },
      'dry-run': { type: 'boolean' },
      json: { type: 'string' },
      commit: { type: 'string' },
      out: { type: 'string' },
      ...WINDOW_OPTIONS,
    },
  })
  const format = values.format ?? (env.GITHUB_ACTIONS === 'true' ? 'github' : 'text')
  if (format !== 'text' && format !== 'github' && format !== 'json')
    throw new Error(`--format is text, github or json, not "${format}"`)
  const inconclusive = values.inconclusive ?? 'warn'
  if (inconclusive !== 'warn' && inconclusive !== 'fail')
    throw new Error(`--inconclusive is warn or fail, not "${inconclusive}"`)
  if (!positionals.length) throw new Error('loadmap check needs one or more .loadmap files')
  if (values.pull && values.snapshot != null) throw new Error('--pull reads fresh data, --snapshot a file: not both')
  if (values.snapshot != null && positionals.length > 1)
    throw new Error('--snapshot is the data of one definition: check one file with it')
  if (!values.pull && (values.window != null || values.step != null || values.to != null || values.out != null))
    throw new Error('--window, --step, --to and --out say what --pull reads and writes: add --pull')
  if (values.out != null && positionals.length > 1)
    throw new Error('--out is the snapshot of one definition: pull one file with it')
  const pull: PullWindow | undefined = values.pull ? windowOf(values, now) : undefined
  return {
    files: positionals,
    format: format as 'text' | 'github' | 'json',
    pull,
    snapshot: values.snapshot,
    inconclusive: inconclusive as 'warn' | 'fail',
    dryRun: !!values['dry-run'],
    json: values.json,
    out: values.out,
    commit: values.commit ?? env.GITHUB_SHA ?? null,
  }
}

/**
 * A diagnostic as a GitHub Actions workflow command: an annotation on its line of the file in the pull request.
 * https://docs.github.com/actions/reference/workflow-commands-for-github-actions
 */
export function github(d: Diagnostic, file: string, source: string): string {
  const span = source.slice(d.from, Math.max(d.from, d.to))
  const breaks = span.split('\n')
  const endLine = d.line + breaks.length - 1
  const endColumn = (breaks.length > 1 ? 1 : d.column) + breaks.at(-1)!.length
  const props = [
    `file=${prop(file)}`,
    `line=${d.line}`,
    `col=${d.column}`,
    `endLine=${endLine}`,
    `endColumn=${endColumn}`,
    `title=${prop('loadmap check')}`,
  ]
  const message = d.hint ? `${d.message} (${d.hint})` : d.message
  return `::${d.severity === 'error' ? 'error' : 'warning'} ${props.join(',')}::${data(message)}`
}

const data = (s: string) => s.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
const prop = (s: string) => data(s).replaceAll(':', '%3A').replaceAll(',', '%2C')
