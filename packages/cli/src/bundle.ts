import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { flatten, formatDiagnostic } from '@loadmap/dsl'
import { loadCatalogForFiles, project } from './project'

export interface BundleOptions {
  log?: (s: string) => void
  /** Where the one file goes without `--out`. Default: standard output. */
  write?: (s: string) => void
}

/**
 * `loadmap bundle`: a definition in several files as one file that draws and computes the same (`flatten()` of
 * @loadmap/dsl): for a host that reads one file. To standard output, or to `--out`. Resolves to 1 when the definition
 * does not compile or cannot be read, 2 for a usage mistake.
 */
export async function bundle(argv: string[], o: BundleOptions = {}): Promise<number> {
  const log = o.log ?? console.log
  let file: string
  let out: string | undefined
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { out: { type: 'string' } },
    })
    if (positionals.length !== 1) throw new Error('loadmap bundle takes one .loadmap file: the model')
    file = positionals[0]!
    out = values.out
  } catch (err) {
    log((err as Error).message)
    return 2
  }
  let source: string
  try {
    source = await readFile(file, 'utf8')
  } catch (err) {
    log(`${file}: cannot read it (${(err as NodeJS.ErrnoException).code ?? (err as Error).message})`)
    return 1
  }
  const here = project(file)
  await loadCatalogForFiles(source, here.options)
  const r = flatten(source, here.options)
  if ('error' in r) {
    for (const d of r.diagnostics)
      log(
        d.file == null
          ? formatDiagnostic(d, source, file)
          : formatDiagnostic(d, here.files(d.file) ?? '', here.shown(d.file)),
      )
    log(`${file}: ${r.error}`)
    return 1
  }
  if (out != null) {
    await writeFile(out, r.text)
    log(`${out}: ${r.text.split('\n').length - 1} lines, from ${file} and the files it names`)
  } else (o.write ?? ((s) => process.stdout.write(s)))(r.text)
  return 0
}
