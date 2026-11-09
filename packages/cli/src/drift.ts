import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { Snapshot } from '@loadmap/core'
import { changePoints, compareWindows, type ThresholdTest, threshold } from '@loadmap/core/drift'
import { fmt, multiple, pct } from '@loadmap/core/format'
import { fromSnapshot, parseSnapshot } from '@loadmap/core/measure'
import { compile, formatDiagnostic, loadCatalogFor } from '@loadmap/dsl'
import { cell } from './base'
import { type PullCommandOptions, pullFor, snapshotPath, WINDOW_OPTIONS, windowOf } from './pull'

/** The exit code of a run that could not look: not a drift, and not to be filed as one. */
const CANNOT = 3

/** Opens the body of the issue `--issue` writes: what a reader of it can tell loadmap's issue by. */
export const ISSUE_MARKER = '<!-- loadmap-drift -->'

/** Shifts this many runs back or nearer are reported: an older one was reported then. */
const RECENT = 7

/** Three significant figures: a slope of 0.003 is not 0. Thousands keep their separators. */
const sig = (x: number) => (Math.abs(x) >= 1000 ? fmt(x) : String(Number(x.toPrecision(3))))
/** A p-value, as small as it comes. */
const pv = (p: number) => (p === 0 ? 'p ≈ 0' : `p ${p.toExponential(1)}`)
const signed = (x: number | null) => (x == null ? 'from 0' : `${x >= 0 ? '+' : '−'}${pct(Math.abs(x))}`)
const iso = (t: number) => new Date(t * 1000).toISOString().replace('.000Z', 'Z')

/** One thing that moved: a shift across the runs, a window unlike the last, or a value outside its history's band. */
export interface Drift {
  /** The measurement, the fit, or "headroom": the first limit's. */
  what: string
  kind: 'shift' | 'windows' | 'history'
  text: string
  /** The run a shift starts at: when its snapshot was read, ISO 8601. */
  at: string | null
  /** (after − before) ÷ |before| (a shift, two windows), or how far past its band's edge, as a share of it. */
  change: number | null
  p: number | null
  /** The latest deploy before a shift, since the run before it (`--markers`). */
  marker: string | null
}

/**
 * `loadmap drift`: what moved in the measured data that no change of the definition shows (a slower query, a cache
 * that hits less, a cost per request that grew). Each measurement's value across main's runs is searched for change
 * points (one value a run: the points inside a window are too alike, and a day's shape is no shift); each series is
 * compared with the last run's; and each value, fit slope and the first limit's headroom is held to the band the last
 * runs set. Resolves to 1 when something drifted (so a scheduled job opens an issue, and nobody's pull request
 * fails), 2 for a usage mistake, 3 when it cannot look (a definition with an error, a snapshot it cannot read or with
 * no data at all, a provider not configured, a file it cannot write), 0 otherwise.
 */
export async function drift(argv: string[], o: PullCommandOptions = {}): Promise<number> {
  const log = o.log ?? console.log
  let a: ReturnType<typeof parse>
  try {
    a = parse(argv, o.now?.() ?? new Date())
  } catch (err) {
    log((err as Error).message)
    return 2
  }
  try {
    return await look(a, o, log)
  } catch (err) {
    // a disk that is full, a folder that is not there: a broken run, never a drift
    log(`${a.file}: cannot look (${(err as NodeJS.ErrnoException).code ?? (err as Error).message})`)
    return CANNOT
  }
}

async function look(a: ReturnType<typeof parse>, o: PullCommandOptions, log: (s: string) => void): Promise<number> {
  let source: string
  try {
    source = await readFile(a.file, 'utf8')
  } catch (err) {
    log(`${a.file}: cannot read it (${(err as NodeJS.ErrnoException).code ?? (err as Error).message})`)
    return CANNOT
  }
  await loadCatalogFor(source)
  const first = compile(source)
  const errors = first.diagnostics.filter((d) => d.severity === 'error')
  if (errors.length) {
    for (const d of errors) log(formatDiagnostic(d, source, a.file))
    log(`${a.file}: does not compile; nothing to compare`)
    return CANNOT
  }

  let now: Snapshot
  if (a.pull) {
    const pulled = await pullFor(a.file, first, a.pull, a.out ?? snapshotPath(a.file), o, log)
    if (pulled === 1) return CANNOT
    now = pulled
  } else {
    try {
      now = parseSnapshot(await readFile(a.snapshot!, 'utf8'))
    } catch (err) {
      log(`${a.snapshot}: cannot read it (${(err as Error).message.replace(/^loadmap: /, '')})`)
      return CANNOT
    }
  }
  const all = Object.entries(now.measurements)
  const read = all.filter(([, m]) => m.missing == null)
  // a provider down or a token expired: nothing to look at is a broken run, not a quiet night
  if (all.length && !read.length) {
    log(`${a.file}: no measurement has data (${all[0]![1].missing}); nothing to look at`)
    return CANNOT
  }
  const history = a.history ? await readHistory(a.history, now, log) : []
  const recent = history.slice(-a.runs)
  let markers: { t: number; label: string }[] = []
  if (a.markers)
    try {
      markers = readMarkers(await readFile(a.markers, 'utf8'))
    } catch (err) {
      log(`${a.markers}: ${(err as Error).message}`)
      return CANNOT
    }
  // the latest deploy before t, since the run before it: what may have caused a shift there
  const cause = (since: number, t: number) =>
    markers.filter((m) => m.t > since && m.t <= t).sort((x, y) => y.t - x.t)[0]?.label ?? null

  const drifts: Drift[] = []
  const at = (s: Snapshot) => Date.parse(s.fetched) / 1000
  for (const [id, m] of read) {
    if (m.missing != null) continue
    // across the runs: one value each, this one last
    const runs = [...history, now].flatMap((s) => {
      const v = s.measurements[id]?.value
      return v == null ? [] : [[at(s), v] as const]
    })
    for (const c of changePoints(runs, { pValue: a.pValue })) {
      if (c.index < runs.length - RECENT) continue
      const marker = cause(runs[c.index - 1]![0], c.t)
      drifts.push({
        what: id,
        kind: 'shift',
        at: iso(c.t),
        change: c.change,
        p: c.p,
        marker,
        text: `${id} shifted ${signed(c.change)} from the run of ${iso(c.t)}: ${sig(c.before)} → ${sig(c.after)} ${m.unit} (${pv(c.p)})${marker ? `, after ${marker}` : ''}`,
      })
    }
    // the new points against the last run's window: what both read is no evidence either way
    const last = [...history].reverse().find((h) => h.measurements[id]?.series?.length)
    const series = m.series ?? []
    if (last && series.length) {
      const end = Date.parse(last.to) / 1000
      const fresh = series.filter((p) => p[0] >= end)
      const after = (fresh.length ? fresh : series).map((p) => p[1])
      const w = compareWindows(
        last.measurements[id]!.series!.map((p) => p[1]),
        after,
        { confidence: a.confidence, deadZone: a.deadZone },
      )
      if (w.verdict !== 'same')
        drifts.push({
          what: id,
          kind: 'windows',
          at: null,
          change: w.change,
          p: w.p,
          marker: null,
          text: `${id} is ${w.verdict} than in the last run (${last.fetched}): ${signed(w.change)} (${pv(w.p)})`,
        })
    }
    const past = recent.flatMap((h) => {
      const v = h.measurements[id]?.value
      return v == null ? [] : [v]
    })
    const band = threshold(past, m.value, a.test, { window: a.runs, min: a.minRuns })
    if (band?.outside) drifts.push(outside(id, `${sig(m.value)} ${m.unit}`, m.value, band))
  }

  // what the model makes of the data: the fits' slopes (a cost that grew) and the first limit's headroom (lost), only
  // in the direction that costs capacity
  const readings = (s: Snapshot) => {
    const model = compile(source, { snapshot: fromSnapshot(s) }).definition?.model
    if (!model) return null
    const fits: Record<string, number> = {}
    for (const [name, f] of Object.entries(model.def.calibration ?? {})) if (f.origin) fits[name] = f.b
    let headroom: number | null = null
    try {
      const target = model.evaluate().target?.low
      headroom = target != null && Number.isFinite(target) ? target : null
    } catch {
      headroom = null
    }
    return { fits, headroom }
  }
  const mine = readings(now)
  const theirs = recent.map(readings)
  for (const [name, b] of Object.entries(mine?.fits ?? {})) {
    const past = theirs.flatMap((r) => (r?.fits[name] == null ? [] : [r.fits[name]!]))
    const band = threshold(past, b, a.test, { window: a.runs, min: a.minRuns })
    if (band?.outside === 'above') drifts.push(outside(name, `a slope of ${sig(b)}`, b, band))
  }
  if (mine?.headroom != null) {
    const past = theirs.flatMap((r) => (r?.headroom == null ? [] : [r.headroom]))
    const band = threshold(past, mine.headroom, a.test, { window: a.runs, min: a.minRuns })
    if (band?.outside === 'below')
      drifts.push(outside('headroom', `the target at ${multiple(mine.headroom)}`, mine.headroom, band))
  }

  const runs = `against ${history.length} past ${history.length === 1 ? 'run' : 'runs'}`
  const missing = all.length - read.length
  const without = missing ? `, ${missing} without data` : ''
  log(
    drifts.length
      ? `${a.file}: ${drifts.length} ${drifts.length === 1 ? 'drift' : 'drifts'}, ${now.from} to ${now.to}, ${runs}${without}`
      : `${a.file}: no drift in ${read.length} ${read.length === 1 ? 'measurement' : 'measurements'}, ${now.from} to ${now.to}, ${runs}${without}`,
  )
  for (const d of drifts) log(`  ✗ ${d.text}`)
  for (const [id, m] of all) if (m.missing != null) log(`  ? ${id}: no data (${m.missing})`)
  const result = {
    version: 1,
    commit: a.commit ?? (o.env ?? process.env).GITHUB_SHA ?? null,
    file: a.file,
    snapshot: { fetched: now.fetched, from: now.from, to: now.to },
    history: history.length,
    missing: all.flatMap(([id, m]) => (m.missing != null ? [{ what: id, why: m.missing }] : [])),
    drifts,
  }
  if (a.json != null) await writeFile(a.json, `${JSON.stringify(result, null, 2)}\n`)
  if (a.issue != null) await writeFile(a.issue, issueBody(a.file, now, history.length, drifts))
  return drifts.length ? 1 : 0
}

function outside(
  what: string,
  value: string,
  v: number,
  band: { lower: number | null; upper: number | null; samples: number; outside: 'above' | 'below' | null },
): Drift {
  const edge = band.outside === 'above' ? band.upper! : band.lower!
  return {
    what,
    kind: 'history',
    at: null,
    change: edge === 0 ? null : (v - edge) / Math.abs(edge),
    p: null,
    marker: null,
    text: `${what}: ${value}, ${band.outside} the band of the last ${band.samples} runs (${band.lower == null ? '…' : sig(band.lower)} to ${band.upper == null ? '…' : sig(band.upper)})`,
  }
}

/** The issue a scheduled job opens or updates: what moved, or that nothing does any more. */
function issueBody(file: string, now: Snapshot, past: number, drifts: readonly Drift[]): string {
  const out = [ISSUE_MARKER, `### Capacity drift in \`${cell(file)}\``, '']
  out.push(`Data from ${now.from} to ${now.to} (read ${now.fetched}), against ${past} past runs of main.`, '')
  if (!drifts.length) out.push('Nothing drifts any more.')
  for (const d of drifts) out.push(`- ${cell(d.text)}`)
  return `${out.join('\n')}\n`
}

/** Every snapshot of the history before this one, oldest first; a file that is not one is skipped, and said so. */
async function readHistory(dir: string, now: Snapshot, log: (s: string) => void): Promise<Snapshot[]> {
  let names: string[]
  try {
    names = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()
  } catch (err) {
    log(`${dir}: no history (${(err as NodeJS.ErrnoException).code ?? (err as Error).message})`)
    return []
  }
  const out: Snapshot[] = []
  for (const name of names) {
    try {
      const s = parseSnapshot(await readFile(join(dir, name), 'utf8'))
      if (Date.parse(s.fetched) < Date.parse(now.fetched)) out.push(s)
    } catch (err) {
      log(`${join(dir, name)}: skipped (${(err as Error).message.replace(/^loadmap: /, '')})`)
    }
  }
  return out.sort((x, y) => Date.parse(x.fetched) - Date.parse(y.fetched))
}

/** `[{ "at": "2026-11-05T10:12:00Z", "label": "deploy 4f2a1c" }]`: the deploys a shift is named by. */
function readMarkers(text: string): { t: number; label: string }[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('the markers are not JSON: [{ "at": "2026-11-05T10:12:00Z", "label": "deploy 4f2a1c" }]')
  }
  if (!Array.isArray(raw)) throw new Error('the markers are a list: [{ "at": …, "label": … }]')
  return raw.map((m, i) => {
    const at = (m as { at?: unknown })?.at
    const label = (m as { label?: unknown })?.label
    const t = typeof at === 'string' ? Date.parse(at) : Number.NaN
    if (Number.isNaN(t) || typeof label !== 'string')
      throw new Error(`marker ${i + 1} needs an "at" instant and a "label"`)
    return { t: t / 1000, label }
  })
}

function share(s: string, what: string): number {
  const m = /^(\d+(\.\d+)?)\s*%$/.exec(s)
  if (!m) throw new Error(`--${what} is a share: "5%", not "${s}"`)
  return Number(m[1]) / 100
}

function count(s: string | undefined, what: string, fallback: number): number {
  if (s == null) return fallback
  const n = Number(s)
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${what} is a whole number from 1, not "${s}"`)
  return n
}

function parse(argv: string[], now: Date) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      snapshot: { type: 'string' },
      pull: { type: 'boolean' },
      out: { type: 'string' },
      history: { type: 'string' },
      markers: { type: 'string' },
      json: { type: 'string' },
      issue: { type: 'string' },
      commit: { type: 'string' },
      'p-value': { type: 'string' },
      confidence: { type: 'string' },
      'dead-zone': { type: 'string' },
      test: { type: 'string' },
      runs: { type: 'string' },
      'min-runs': { type: 'string' },
      ...WINDOW_OPTIONS,
    },
  })
  if (positionals.length !== 1) throw new Error('loadmap drift needs one .loadmap file')
  if (!values.pull === (values.snapshot == null))
    throw new Error('loadmap drift reads --snapshot <file> or fresh data with --pull: one of them')
  if (!values.pull && (values.window != null || values.step != null || values.to != null || values.out != null))
    throw new Error('--window, --step, --to and --out say what --pull reads and writes: add --pull')
  const pValue = values['p-value'] != null ? Number(values['p-value']) : 0.001
  if (!(pValue > 0 && pValue < 1)) throw new Error(`--p-value is above 0 and below 1, not "${values['p-value']}"`)
  const confidence = values.confidence != null ? share(values.confidence, 'confidence') : 0.98
  if (!(confidence > 0 && confidence < 1)) throw new Error('--confidence is a share between 0 and 100 %')
  const testName = values.test ?? 't_test'
  const tests: Record<string, ThresholdTest> = {
    t_test: { test: 't_test' },
    percentage: { test: 'percentage', share: 0.1 },
    iqr: { test: 'iqr' },
  }
  if (!Object.hasOwn(tests, testName)) throw new Error(`--test is t_test, percentage or iqr, not "${testName}"`)
  return {
    file: positionals[0]!,
    snapshot: values.snapshot,
    pull: values.pull ? windowOf(values, now) : undefined,
    out: values.out,
    history: values.history,
    markers: values.markers,
    json: values.json,
    issue: values.issue,
    commit: values.commit,
    pValue,
    confidence,
    deadZone: values['dead-zone'] != null ? share(values['dead-zone'], 'dead-zone') : 0.05,
    test: tests[testName]!,
    runs: count(values.runs, 'runs', 30),
    minRuns: count(values['min-runs'], 'min-runs', 5),
  }
}
