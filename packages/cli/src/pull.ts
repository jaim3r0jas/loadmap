import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { fmt } from '@loadmap/core/format'
import { compile, formatDiagnostic, loadCatalogFor } from '@loadmap/dsl'
import { PROVIDER_ENV, providersFromEnv, pull as read } from '@loadmap/providers'

export interface PullCommandOptions {
  log?: (s: string) => void
  /** Where the address and the credentials are read from: the process's environment by default. */
  env?: Readonly<Record<string, string | undefined>>
  /** For tests: the global `fetch` by default. */
  fetch?: typeof fetch
  /** For tests: the one read of the clock, the moment of the pull. */
  now?: () => Date
}

const UNITS: Readonly<Record<string, number>> = { s: 1, m: 60, h: 3600, d: 86_400 }

/**
 * `loadmap pull`: reads every `measure` of a definition from its provider and writes the snapshot next to it.
 * Resolves to the exit code: 2 for a usage mistake, 1 when the definition does not compile or a provider it needs is
 * not configured, 0 otherwise. A query that fails is a missing measurement, not a failed pull: the model then uses the
 * definition's own value, and the line says why.
 */
export async function pull(argv: string[], o: PullCommandOptions = {}): Promise<number> {
  const log = o.log ?? console.log
  let a: ReturnType<typeof parse>
  try {
    a = parse(argv, o.now?.() ?? new Date())
  } catch (err) {
    log((err as Error).message)
    return 2
  }
  let source: string
  try {
    source = await readFile(a.file, 'utf8')
  } catch (err) {
    log(`${a.file}: cannot read it (${(err as NodeJS.ErrnoException).code ?? (err as Error).message})`)
    return 1
  }
  await loadCatalogFor(source)
  const r = compile(source)
  // only what stops it compiling: a failing expect line is what fresh data is for
  const errors = r.diagnostics.filter((d) => d.severity === 'error')
  if (errors.length) {
    for (const d of errors) log(formatDiagnostic(d, source, a.file))
    log(`${a.file}: does not compile; nothing pulled`)
    return 1
  }
  if (!r.measures.length) {
    log(`${a.file}: has no measure lines; nothing to pull`)
    return 0
  }
  let providers: ReturnType<typeof providersFromEnv>
  try {
    providers = providersFromEnv(o.env ?? process.env, o.fetch ? { fetch: o.fetch } : {})
  } catch (err) {
    log(`${a.file}: ${(err as Error).message.replace(/^loadmap: /, '')}`)
    return 1
  }
  const unset = [...new Set(r.measures.map((m) => m.provider))].filter((p) => !Object.hasOwn(providers, p))
  if (unset.length) {
    for (const p of unset) log(`${a.file}: ${p} is not configured: set ${PROVIDER_ENV[p] ?? p}`)
    return 1
  }

  const snapshot = await read(r.measures, { ...a.window, fetched: a.fetched, providers })
  await writeFile(a.out, `${JSON.stringify(snapshot, null, 2)}\n`)
  const ms = Object.entries(snapshot.measurements)
  const missing = ms.filter(([, m]) => m.missing != null).length
  log(
    `${a.out}: ${ms.length - missing} of ${ms.length} ${ms.length === 1 ? 'measurement' : 'measurements'}, ${a.window.from} to ${a.window.to}`,
  )
  for (const [id, m] of ms)
    log(
      m.missing != null
        ? `  ✗ ${id}: ${m.missing}`
        : `  ✓ ${id}: ${fmt(m.value)} ${m.unit} (${fmt(m.origin.samples)} samples${m.origin.stat ? `, ${m.origin.stat}` : ''})`,
    )
  return 0
}

/** "7d", "5m", "30s", "1h": seconds. */
function seconds(s: string, what: string): number {
  const m = /^(\d+)(s|m|h|d)$/.exec(s)
  if (!m || !Number(m[1])) throw new Error(`--${what} is a whole number and s, m, h or d ("7d", "5m"), not "${s}"`)
  return Number(m[1]) * UNITS[m[2]!]!
}

function parse(argv: string[], now: Date) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      window: { type: 'string' },
      step: { type: 'string' },
      to: { type: 'string' },
      out: { type: 'string' },
    },
  })
  if (positionals.length !== 1) throw new Error('loadmap pull needs one .loadmap file')
  const file = positionals[0]!
  const window = seconds(values.window ?? '7d', 'window')
  const step = seconds(values.step ?? '5m', 'step')
  if (window / step > 11_000)
    throw new Error(
      `--window ${values.window ?? '7d'} at --step ${values.step ?? '5m'} is too many points: Prometheus takes at most 11,000`,
    )
  let to: number
  if (values.to != null) {
    to = Date.parse(values.to)
    if (!/^\d{4}-\d{2}-\d{2}T/.test(values.to) || Number.isNaN(to))
      throw new Error(`--to is an ISO 8601 instant ("2026-11-08T00:00:00Z"), not "${values.to}"`)
  } else to = now.getTime()
  // on the step's grid: two pulls in the same step read the same points
  const end = Math.floor(to / 1000 / step) * step
  const iso = (s: number) => new Date(s * 1000).toISOString().replace('.000Z', 'Z')
  return {
    file,
    out: values.out ?? `${file.replace(/\.loadmap$/, '')}.snapshot.json`,
    window: { from: iso(end - window), to: iso(end), step },
    fetched: iso(Math.floor(now.getTime() / 1000)),
  }
}
