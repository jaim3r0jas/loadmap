import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import type { Snapshot } from '@loadmap/core'
import { fmt } from '@loadmap/core/format'
import { type CompileResult, compile, formatDiagnostic, loadCatalogFor } from '@loadmap/dsl'
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

/** The options of a window: `loadmap pull` and `loadmap check --pull` take the same ones. */
export const WINDOW_OPTIONS = {
  window: { type: 'string' },
  step: { type: 'string' },
  to: { type: 'string' },
} as const

/** What a pull reads: the window on the step's grid, and the moment it ran. */
export interface PullWindow {
  window: { from: string; to: string; step: number }
  fetched: string
}

/**
 * `loadmap pull`: reads every `measure` of a definition from its provider and writes the snapshot next to it.
 * Resolves to the exit code: 2 for a usage mistake, 1 when the definition does not compile or a provider it needs is
 * not configured, 0 otherwise. A query that fails is a missing measurement, not a failed pull: the model then uses the
 * definition's own value, and the line says why.
 */
export async function pull(argv: string[], o: PullCommandOptions = {}): Promise<number> {
  const log = o.log ?? console.log
  let file: string
  let out: string
  let w: PullWindow
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { ...WINDOW_OPTIONS, out: { type: 'string' } },
    })
    if (positionals.length !== 1) throw new Error('loadmap pull needs one .loadmap file')
    file = positionals[0]!
    out = values.out ?? snapshotPath(file)
    w = windowOf(values, o.now?.() ?? new Date())
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
  await loadCatalogFor(source)
  const r = compile(source)
  // only what stops it compiling: a failing expect line is what fresh data is for
  const errors = r.diagnostics.filter((d) => d.severity === 'error')
  if (errors.length) {
    for (const d of errors) log(formatDiagnostic(d, source, file))
    log(`${file}: does not compile; nothing pulled`)
    return 1
  }
  if (!r.measures.length) {
    log(`${file}: has no measure lines; nothing to pull`)
    return 0
  }
  const snapshot = await pullFor(file, r, w, out, o, log)
  return typeof snapshot === 'number' ? snapshot : 0
}

/** Where a definition's snapshot is written: next to it, x.loadmap → x.snapshot.json. */
export function snapshotPath(file: string): string {
  return `${file.replace(/\.loadmap$/, '')}.snapshot.json`
}

/**
 * Pulls a compiled definition's measures, writes the snapshot to `out` and says what it read. Resolves to the
 * snapshot, or to 1 when a provider it needs is not configured.
 */
export async function pullFor(
  file: string,
  r: CompileResult,
  w: PullWindow,
  out: string,
  o: PullCommandOptions,
  log: (s: string) => void,
): Promise<Snapshot | 1> {
  const needed = [...new Set(r.measures.map((m) => m.provider))]
  let providers: ReturnType<typeof providersFromEnv>
  try {
    providers = providersFromEnv(o.env ?? process.env, { only: needed, ...(o.fetch && { fetch: o.fetch }) })
  } catch (err) {
    log(`${file}: ${(err as Error).message.replace(/^loadmap: /, '')}`)
    return 1
  }
  const unset = needed.filter((p) => !Object.hasOwn(providers, p))
  if (unset.length) {
    for (const p of unset) log(`${file}: ${p} is not configured: set ${PROVIDER_ENV[p] ?? p}`)
    return 1
  }
  const snapshot = await read(r.measures, { ...w.window, fetched: w.fetched, providers })
  await writeFile(out, `${JSON.stringify(snapshot, null, 2)}\n`)
  const ms = Object.entries(snapshot.measurements)
  const missing = ms.filter(([, m]) => m.missing != null).length
  log(
    `${out}: ${ms.length - missing} of ${ms.length} ${ms.length === 1 ? 'measurement' : 'measurements'}, ${w.window.from} to ${w.window.to}`,
  )
  for (const [id, m] of ms)
    log(
      m.missing != null
        ? `  ✗ ${id}: ${m.missing}`
        : `  ✓ ${id}: ${fmt(m.value)} ${m.unit} (${fmt(m.origin.samples)} samples${m.origin.stat ? `, ${m.origin.stat}` : ''})`,
    )
  return snapshot
}

/** "7d", "5m", "30s", "1h": seconds. */
function seconds(s: string, what: string): number {
  const m = /^(\d+)(s|m|h|d)$/.exec(s)
  if (!m || !Number(m[1])) throw new Error(`--${what} is a whole number and s, m, h or d ("7d", "5m"), not "${s}"`)
  return Number(m[1]) * UNITS[m[2]!]!
}

/** The window the options give, ending on the step's grid: two pulls in the same step read the same points. */
export function windowOf(values: { window?: string; step?: string; to?: string }, now: Date): PullWindow {
  const window = seconds(values.window ?? '7d', 'window')
  const step = seconds(values.step ?? '5m', 'step')
  if (window < step) throw new Error(`--window ${values.window ?? '7d'} is shorter than --step ${values.step ?? '5m'}`)
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
  const end = Math.floor(to / 1000 / step) * step
  const iso = (s: number) => new Date(s * 1000).toISOString().replace('.000Z', 'Z')
  return { window: { from: iso(end - window), to: iso(end), step }, fetched: iso(Math.floor(now.getTime() / 1000)) }
}
