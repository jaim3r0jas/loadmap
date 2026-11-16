import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { format, formatDiagnostic, imports } from '@loadmap/dsl'
import { project } from './project'

export interface FmtOptions {
  log?: (s: string) => void
  /** Where `-` reads the definition from. Default: standard input. */
  read?: () => Promise<string>
  /** Where `-` writes it to. Default: standard output. */
  write?: (s: string) => void
}

/**
 * `loadmap fmt`: lays each definition out the one way (`format()` of @loadmap/dsl), in place. With `--check` it only
 * names the files that are not laid out so. `-` reads standard input and writes standard output. Resolves to 1 when a
 * file has a syntax error, cannot be read, or (with --check) needs formatting; 2 for a usage mistake.
 */
export async function fmt(argv: string[], o: FmtOptions = {}): Promise<number> {
  const log = o.log ?? console.log
  let parsed: ReturnType<typeof parse>
  try {
    parsed = parse(argv)
  } catch (err) {
    log((err as Error).message)
    return 2
  }
  if (parsed.stdin) {
    const source = await (o.read ?? readStdin)()
    const r = format(source)
    // the text goes to the output only when it is the definition: a pipe must not get half a file
    if (!r.ok) for (const d of r.diagnostics) log(formatDiagnostic(d, source, '<stdin>'))
    else (o.write ?? ((s) => process.stdout.write(s)))(r.text)
    return r.ok ? 0 : 1
  }
  let failed = false
  let changed = 0
  let skipped = 0
  for (const file of parsed.files) {
    let source: string
    try {
      source = await readFile(file, 'utf8')
    } catch (err) {
      log(`${file}: cannot read it (${(err as NodeJS.ErrnoException).code ?? (err as Error).message})`)
      failed = true
      skipped++
      continue
    }
    const r = format(source)
    if (!r.ok) {
      for (const d of r.diagnostics) log(formatDiagnostic(d, source, file))
      log(`${file}: left as it is, it has a syntax error`)
      failed = true
      skipped++
    } else if (r.text !== source) {
      changed++
      if (parsed.check) {
        log(`${file}: not laid out by loadmap fmt`)
        failed = true
      } else {
        await writeFile(file, r.text)
        log(`${file}: formatted`)
      }
    }
    // a model's parts say its version: one namespace is read one way
    if (r.ok && (await partsVersion(file, r.text, parsed.check, log))) failed = true
  }
  const n = parsed.files.length
  const files = (k: number) => `${k} ${k === 1 ? 'file' : 'files'}`
  const left = skipped ? `; ${skipped} left out (unreadable or a syntax error)` : ''
  let summary = `${changed} of ${files(n)} formatted`
  if (parsed.check && changed) summary = `${changed} of ${files(n)} need loadmap fmt`
  else if (parsed.check)
    summary = skipped ? `${n - skipped} of ${files(n)} laid out already` : `${files(n)} laid out already`
  log(summary + left)
  return failed ? 1 : 0
}

/**
 * Sets the `loadmap` line of each part a model includes to the model's own; with `check`, only says which differ.
 * True when one differs under `check`.
 */
async function partsVersion(file: string, model: string, check: boolean, log: (s: string) => void): Promise<boolean> {
  const here = project(file)
  const head = imports(model, here.path)
  const want = /^loadmap (\d+(?:\.\d+)?)[ \t]*(?:#.*)?$/m.exec(model.split('\n')[0] ?? '')?.[1]
  if (head.role !== 'model' || want == null) return false
  let differs = false
  for (const f of head.files) {
    const text = f.kind === 'include' && f.path != null ? here.files(f.path) : undefined
    if (text == null || f.path == null) continue
    const line = text.split('\n')[0] ?? ''
    const has = /^loadmap (\S+)/.exec(line)?.[1]
    if (has == null || has === want || imports(text, f.path).role !== 'part') continue
    const shown = here.shown(f.path)
    if (check) {
      log(`${shown}: says loadmap ${has}; its model ${file} says loadmap ${want}`)
      differs = true
    } else {
      await writeFile(here.abs(f.path), `${line.replace(has, want)}${text.slice(line.length)}`)
      log(`${shown}: loadmap ${want}, as its model ${file}`)
    }
  }
  return differs
}

function parse(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { check: { type: 'boolean' } },
  })
  if (!positionals.length) throw new Error('loadmap fmt needs one or more .loadmap files, or - for standard input')
  const stdin = positionals.includes('-')
  if (stdin && (positionals.length > 1 || values.check))
    throw new Error('loadmap fmt - reads standard input alone, without files or --check')
  return { files: positionals, check: !!values.check, stdin }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}
