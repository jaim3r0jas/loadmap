import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { compile, type Diagnostic, formatDiagnostic, loadCatalogFor, problems } from '@loadmap/dsl'

export interface CheckOptions {
  log?: (s: string) => void
  /** Where GITHUB_ACTIONS is read from: annotations are the default there. */
  env?: Readonly<Record<string, string | undefined>>
}

/**
 * `loadmap check`: compiles each definition and tests its expect lines. Resolves to the exit code: 1 when a
 * definition has an error or an expectation fails, 2 for a usage mistake, 0 when everything holds.
 */
export async function check(argv: string[], o: CheckOptions = {}): Promise<number> {
  const log = o.log ?? console.log
  let parsed: ReturnType<typeof parse>
  try {
    parsed = parse(argv, o.env ?? process.env)
  } catch (err) {
    log((err as Error).message)
    return 2
  }
  let failed = false
  for (const file of parsed.files) {
    let source: string
    try {
      source = await readFile(file, 'utf8')
    } catch (err) {
      log(`${file}: cannot read it (${(err as NodeJS.ErrnoException).code ?? (err as Error).message})`)
      failed = true
      continue
    }
    await loadCatalogFor(source)
    const r = compile(source)
    const list = problems(r, 'error')
    if (parsed.format === 'github') for (const d of list) log(github(d, file, source))
    for (const d of list) log(formatDiagnostic(d, source, file))
    if (list.some((d) => d.severity === 'error')) failed = true

    const errors = r.diagnostics.filter((d) => d.severity === 'error').length
    const n = r.expectations.length
    const bad = r.expectations.filter((e) => !e.result.ok).length
    const many = (k: number, one: string, more: string) => `${k} ${k === 1 ? one : more}`
    log(
      errors
        ? `${file}: does not compile (${many(errors, 'error', 'errors')})`
        : !n
          ? `${file}: compiles; it has no expect lines`
          : bad
            ? `${file}: ${bad} of ${many(n, 'expectation', 'expectations')} failed`
            : `${file}: ${many(n, 'expectation holds', 'expectations hold')}`,
    )
    for (const e of r.expectations)
      if (e.result.ok) log(`  ✓ ${e.result.expectation.label ?? `line ${e.line}`}: ${e.result.message}`)
  }
  return failed ? 1 : 0
}

function parse(argv: string[], env: Readonly<Record<string, string | undefined>>) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { format: { type: 'string' } },
  })
  const format = values.format ?? (env.GITHUB_ACTIONS === 'true' ? 'github' : 'text')
  if (format !== 'text' && format !== 'github') throw new Error(`--format is text or github, not "${format}"`)
  if (!positionals.length) throw new Error('loadmap check needs one or more .loadmap files')
  return { files: positionals, format }
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
