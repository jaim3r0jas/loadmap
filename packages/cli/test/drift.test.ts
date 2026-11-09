import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { drift, ISSUE_MARKER } from '../src/drift'

const SRC = `loadmap 1
load { max: 50 }

metric rate { prometheus { query: "sum(rate(requests_total[5m]))" } }
metric cpu { prometheus { query: "sum(rate(cpu_seconds_total[5m]))" } }

measure requests rate { fallback: 100; unit: "req/s" }
measure cores cpu { fallback: 0.3; unit: "cores" }

fit apiCores "API CPU per request" {
  x: requests
  y: cores
  points rate cores {
    100 0.3
    200 0.5
  }
}

flow req "requests" { rate: requests * load; from: users; route: api }

node users "Users"
node api "API" {
  pass
  demand: apiCores(flows.req)
  capacity: measured(4, "cores", "pod limit")
  over: "requests wait"
}

users -> api
`

const wobble = (i: number) => Math.sin(i * 1.7) + 0.6 * Math.cos(i * 0.9)
const DAY = 86_400

/** One night's snapshot: 60 points of requests and of cores, `level` higher from `stepAt` on, at a cost of `slope`. */
function snapshot(
  day: number,
  o: { level?: number; step?: number; stepAt?: number; slope?: number; missing?: string } = {},
) {
  const start = 1793836800 + day * DAY // 2026-11-05T00:00Z + days
  const rate = Array.from(
    { length: 60 },
    (_, i) => (o.level ?? 100) + (i >= (o.stepAt ?? 60) ? (o.step ?? 0) : 0) + 2 * wobble(i + day),
  )
  const cores = rate.map((r, i) => 0.1 + (o.slope ?? 0.002) * r + 0.002 * wobble(i * 3 + day))
  const iso = (t: number) => new Date(t * 1000).toISOString().replace('.000Z', 'Z')
  const origin = (query: string, n: number) => ({
    provider: 'prometheus',
    query,
    from: iso(start),
    to: iso(start + 60 * 300),
    step: 300,
    fetched: iso(start + DAY - 1),
    samples: n,
  })
  const m = (values: number[], unit: string, query: string) =>
    o.missing
      ? { unit, missing: o.missing, origin: origin(query, 0) }
      : {
          unit,
          value: values.reduce((s, v) => s + v, 0) / values.length,
          series: values.map((v, i) => [start + 300 * i, v]),
          origin: origin(query, values.length),
        }
  return {
    format: 'loadmap-snapshot',
    version: 1,
    fetched: iso(start + DAY - 1),
    from: iso(start),
    to: iso(start + 60 * 300),
    measurements: {
      requests: m(rate, 'req/s', 'sum(rate(requests_total[5m]))'),
      cores: m(cores, 'cores', 'sum(rate(cpu_seconds_total[5m]))'),
    },
  }
}

async function setup(tonight: ReturnType<typeof snapshot>, nights = Array.from({ length: 8 }, (_, d) => snapshot(d))) {
  const dir = await mkdtemp(join(tmpdir(), 'loadmap-drift-'))
  const file = join(dir, 'shop.loadmap')
  await writeFile(file, SRC)
  await mkdir(join(dir, 'history'))
  for (const [d, n] of nights.entries())
    await writeFile(join(dir, 'history', `night-${String(d).padStart(2, '0')}.snapshot.json`), JSON.stringify(n))
  const now = join(dir, 'now.snapshot.json')
  await writeFile(now, JSON.stringify(tonight))
  return { dir, file, now, history: join(dir, 'history') }
}

async function run(argv: string[]) {
  const lines: string[] = []
  const code = await drift(argv, { log: (l) => lines.push(l), env: {} })
  return { code, out: lines.join('\n'), lines }
}

describe('loadmap drift', () => {
  it('finds nothing on a night like the others, and writes an issue that says so', async () => {
    const { dir, file, now, history } = await setup(snapshot(8))
    const issue = join(dir, 'issue.md')
    const r = await run([file, '--snapshot', now, '--history', history, '--issue', issue])
    expect(r.out).toBe(
      `${file}: no drift in 2 measurements, 2026-11-13T00:00:00Z to 2026-11-13T05:00:00Z, against 8 past runs`,
    )
    expect(r.code).toBe(0)
    expect(await readFile(issue, 'utf8')).toContain('Nothing drifts any more.')
  })

  it('finds a shift across the runs, and names the deploy before it', async () => {
    // eight nights at 100 req/s, then five at 130 (tonight the fifth)
    const nights = Array.from({ length: 12 }, (_, d) => snapshot(d, d >= 8 ? { level: 130 } : {}))
    const { dir, file, now, history } = await setup(snapshot(12, { level: 130 }), nights)
    const markers = join(dir, 'deploys.json')
    await writeFile(
      markers,
      JSON.stringify([
        { at: '2026-11-13T12:00:00Z', label: 'deploy 1a2b3c' },
        { at: '2026-11-13T22:00:00Z', label: 'deploy 4f2a1c' },
        // after the shift: not its cause
        { at: '2026-11-14T03:00:00Z', label: 'deploy 9e8d7c' },
      ]),
    )
    const json = join(dir, 'drift.json')
    const r = await run([file, '--snapshot', now, '--history', history, '--markers', markers, '--json', json])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(
      /✗ requests shifted \+30 % from the run of 2026-11-13T23:59:59Z: 100 → 130 req\/s \(p [\d.]+e-\d+\), after deploy 4f2a1c/,
    )
    const result = JSON.parse(await readFile(json, 'utf8'))
    expect(result.drifts.find((d: { kind: string }) => d.kind === 'shift')).toMatchObject({
      what: 'requests',
      at: '2026-11-13T23:59:59Z',
      marker: 'deploy 4f2a1c',
    })
  })

  it('holds tonight to the last run and to the band of the runs before, in the direction that costs capacity', async () => {
    const { dir, file, now, history } = await setup(snapshot(8, { step: 30, stepAt: 40, slope: 0.003 }))
    const issue = join(dir, 'issue.md')
    const r = await run([file, '--snapshot', now, '--history', history, '--issue', issue])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/✗ requests is higher than in the last run \(2026-11-12T23:59:59Z\): \+10 %/)
    expect(r.out).toMatch(/✗ requests: 110 req\/s, above the band of the last 8 runs \(/)
    expect(r.out).toMatch(/✗ API CPU per request: a slope of 0\.003, above the band of the last 8 runs/)
    expect(r.out).toMatch(/✗ headroom: the target at [\d.]+×, below the band of the last 8 runs/)
    const body = await readFile(issue, 'utf8')
    expect(body.startsWith(`${ISSUE_MARKER}\n### Capacity drift in \`${file}\``)).toBe(true)
    expect(body).toContain('against 8 past runs of main')
    // cheaper and with more headroom: good news is no drift of the model
    const better = await setup(snapshot(8, { slope: 0.001 }))
    const b = await run([better.file, '--snapshot', better.now, '--history', better.history])
    expect(b.out).not.toMatch(/slope|headroom/)
  })

  it('cannot look at a night with no data, or a file it cannot write: a broken run, not a drift', async () => {
    const { dir, file, now, history } = await setup(snapshot(8, { missing: 'Prometheus answered 401' }))
    const r = await run([file, '--snapshot', now, '--history', history])
    expect(r.code).toBe(3)
    expect(r.out).toBe(`${file}: no measurement has data (Prometheus answered 401); nothing to look at`)
    const ok = await setup(snapshot(8))
    const w = await run([
      ok.file,
      '--snapshot',
      ok.now,
      '--history',
      ok.history,
      '--json',
      join(dir, 'no', 'such.json'),
    ])
    expect(w.code).toBe(3)
    expect(w.out).toMatch(/cannot look \(ENOENT\)/)
  })

  it('needs a history before it holds anything to one, and says why it skips a file', async () => {
    const { dir, file, now, history } = await setup(snapshot(8, { step: 30, stepAt: 40 }))
    await writeFile(join(history, 'broken.json'), '{')
    const r = await run([file, '--snapshot', now, '--history', history, '--min-runs', '20'])
    expect(r.out).toContain(`${join(history, 'broken.json')}: skipped (not a snapshot: the text is not JSON`)
    // 8 runs, 20 needed: no band; the last run still counts
    expect(r.out).not.toMatch(/the band of/)
    expect(r.out).toMatch(/requests is higher than in the last run/)
    const alone = await run([file, '--snapshot', now, '--history', join(dir, 'none')])
    expect(alone.out).toMatch(/none: no history \(ENOENT\)/)
  })

  it('refuses what cannot be meant', async () => {
    const { file, now } = await setup(snapshot(8))
    expect((await run([file])).out).toBe('loadmap drift reads --snapshot <file> or fresh data with --pull: one of them')
    expect((await run([file, '--snapshot', now, '--pull'])).code).toBe(2)
    expect((await run([file, '--snapshot', now, '--test', 'vibes'])).out).toBe(
      '--test is t_test, percentage or iqr, not "vibes"',
    )
    expect((await run([file, '--snapshot', now, '--dead-zone', '5'])).out).toBe('--dead-zone is a share: "5%", not "5"')
    expect((await run([file, '--snapshot', now, '--window', '1h'])).code).toBe(2)
  })
})
