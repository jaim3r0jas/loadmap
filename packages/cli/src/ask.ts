import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { gather } from '@loadmap/dsl'
import { createAssistant, diffLines, type ModelProvider, type Proposal, providerFromEnv } from '@loadmap/dsl/assist'
import { loadCatalogForFiles, project } from './project'

export interface AskCommandOptions {
  log?: (s: string) => void
  /** Where the answer streams to as it comes: standard output by default. */
  write?: (s: string) => void
  /** Where the provider and its key are read: the process's environment by default. */
  env?: Readonly<Record<string, string | undefined>>
  /** For tests: the model, instead of the one the environment names. */
  model?: ModelProvider
  cwd?: string
}

const USAGE =
  'loadmap ask <file.loadmap> "<request>" [--box <id>] [--files] [--write] [--commit] [--provider <id>] [--model <name>] [--reference <file>]'

/**
 * `loadmap ask`: a request to a model about a definition, answered with a change the gate has checked: shown as a
 * diff, written with --write, committed with --commit. The model is the one the environment names (`LOADMAP_AI_*`, or
 * a provider's own key variable); the key never reaches the output. Resolves to the exit code: 2 for a usage mistake
 * or no model, 1 when the model's answers were refused, 0 otherwise (a question back is an answer too).
 */
export async function ask(argv: string[], o: AskCommandOptions = {}): Promise<number> {
  const log = o.log ?? console.log
  const out = o.write ?? ((s: string) => process.stdout.write(s))
  const env = o.env ?? process.env
  let values: Record<string, string | boolean | undefined>
  let file: string
  let request: string
  try {
    const p = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        box: { type: 'string' },
        files: { type: 'boolean' },
        write: { type: 'boolean' },
        commit: { type: 'boolean' },
        provider: { type: 'string' },
        model: { type: 'string' },
        reference: { type: 'string' },
      },
    })
    values = p.values
    if (p.positionals.length < 2) throw new Error(USAGE)
    file = p.positionals[0]!
    request = p.positionals.slice(1).join(' ').trim()
    if (!request) throw new Error(USAGE)
  } catch (err) {
    log((err as Error).message)
    return 2
  }
  let model: ModelProvider
  try {
    model =
      o.model ??
      providerFromEnv(env, {
        ...(typeof values.provider === 'string' && { provider: values.provider }),
        ...(typeof values.model === 'string' && { model: values.model }),
      })
  } catch (err) {
    log(`loadmap ask: ${(err as Error).message}`)
    return 2
  }
  const here = project(file, o.cwd)
  const source = here.files(here.path)
  if (source == null) {
    log(`${file}: cannot read it`)
    return 2
  }
  await loadCatalogForFiles(source, here.options)
  const g = gather(source, here.options)
  const before = { entry: g.path, files: g.files }
  let reference: string
  try {
    reference =
      typeof values.reference === 'string'
        ? await readFile(resolve(o.cwd ?? process.cwd(), values.reference), 'utf8')
        : await defaultReference()
  } catch (err) {
    log(`loadmap ask: no reference: ${(err as Error).message}; pass --reference <file>`)
    return 2
  }
  const assistant = createAssistant({ model, reference })
  let proposal: Proposal | undefined
  let code = 0
  for await (const e of assistant.ask({
    request,
    project: before,
    ...(typeof values.box === 'string' && { selection: { box: values.box } }),
    ...(values.files === true && { form: 'files' as const }),
  })) {
    if (e.type === 'text') out(e.text)
    else if (e.type === 'repair') log(`\n— refused, asked again (${e.attempt}): ${e.error}`)
    else if (e.type === 'refused') {
      log(`\n— refused: ${e.error}`)
      code = 1
    } else if (e.type === 'explore') log('\n— the model asks to read your metrics; `loadmap ask` cannot yet')
    else if (e.type === 'proposal') proposal = e.proposal
    else if (e.type === 'done')
      log(
        `\n— ${model.model}: ${e.usage.input} tokens in${e.usage.cached ? ` (${e.usage.cached} cached)` : ''}, ${e.usage.output} out`,
      )
  }
  if (!proposal) return code
  log(summary(proposal))
  for (const p of [...proposal.changed, ...proposal.added])
    log(unified(p, proposal.before.files[p] ?? '', proposal.project.files[p]!))
  if (!values.write && !values.commit) {
    log('Nothing written: --write writes it, --commit writes and commits it.')
    return 0
  }
  const touched = await writeProposal(here.root, proposal)
  log(`Wrote ${touched.map((p) => here.shown(p)).join(', ')}`)
  if (values.commit) {
    const git = promisify(execFile)
    try {
      await git('git', ['add', '--', ...touched.map((p) => here.abs(p))], { cwd: here.root })
      const message = `${request.split('\n')[0]!.slice(0, 72)}\n\n${proposal.notes.join('\n')}\n\nAssisted-by: ${model.model}\n`
      const dir = await mkdtemp(join(tmpdir(), 'loadmap-ask-'))
      const msg = join(dir, 'message')
      await writeFile(msg, message)
      try {
        await git('git', ['commit', '-q', '-F', msg, '--', ...touched.map((p) => here.abs(p))], { cwd: here.root })
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
      log('Committed.')
    } catch (err) {
      log(`loadmap ask: the commit failed: ${(err as Error).message}`)
      return 1
    }
  }
  return 0
}

/** The proposal's files on disk, under the project root: changed and added written, renamed moved, removed gone. */
async function writeProposal(root: string, p: Proposal): Promise<string[]> {
  const at = (path: string) => {
    // the gate took only paths from the root with "/"; never a backslash, a drive or a way up, whatever comes
    if (/[\\:]/.test(path) || path.split('/').some((p) => p === '..' || p === ''))
      throw new Error(`"${path}" is no path in the project`)
    return join(root, ...path.split('/'))
  }
  const touched: string[] = []
  for (const r of p.renamed) {
    await mkdir(dirname(at(r.to)), { recursive: true })
    await rename(at(r.from), at(r.to))
    touched.push(r.from, r.to)
  }
  for (const path of [...p.changed, ...p.added]) {
    await mkdir(dirname(at(path)), { recursive: true })
    await writeFile(at(path), p.project.files[path]!)
    if (!touched.includes(path)) touched.push(path)
  }
  for (const path of p.removed) {
    await rm(at(path), { force: true })
    touched.push(path)
  }
  return touched
}

/** What the proposal does, in a few lines. */
export function summary(p: Proposal): string {
  const lines = ['', '— The change:']
  for (const n of p.notes) lines.push(`  ${n}`)
  if (p.moved) lines.push(`  ${p.moved.text}`, ...p.moved.worse.map((w) => `  Worse: ${w}`))
  for (const e of p.expectations) lines.push(`  ${e.label}: ${e.before ? `${e.before} → ` : ''}${e.after}`)
  for (const f of p.figures) lines.push(`  ${f.file}:${f.line} ${f.text}${f.given ? '' : " (the assistant's guess)"}`)
  for (const w of p.warnings) lines.push(`  Warning: ${w}`)
  return lines.join('\n')
}

/** A file's change as a unified diff, three lines around each change. */
export function unified(path: string, before: string, after: string): string {
  const lines = diffLines(before, after).map((l) => (l.kind === '@' ? '@@' : `${l.kind}${l.text}`))
  if (!lines.length) return `${path}: no change`
  return [`--- ${before ? path : '/dev/null'}`, `+++ ${path}`, '@@', ...lines].join('\n')
}

/**
 * The language reference: the dsl package's REFERENCE.md, as npm ships it; in this repository, its source,
 * docs/dsl.md.
 */
async function defaultReference(): Promise<string> {
  const entry = fileURLToPath(import.meta.resolve('@loadmap/dsl'))
  for (let dir = dirname(entry); dirname(dir) !== dir; dir = dirname(dir)) {
    for (const p of [join(dir, 'dist', 'REFERENCE.md'), join(dir, 'docs', 'dsl.md')])
      if (existsSync(p)) return readFile(p, 'utf8')
  }
  throw new Error('REFERENCE.md is not next to @loadmap/dsl')
}
