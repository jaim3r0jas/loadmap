import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type CheckedFile, check } from '../src/check'

const SRC = `loadmap 1
load { max: 50 }

metric served "Requests served" {
  prometheus { query: 'sum(rate(http_requests_total{job="{{ args.job }}"}[5m]))' }
  stat: max
  min: 3
}

measure apiCapacity served { job: "api"; fallback: estimated(1_000, "req/s", "vendor benchmark") }
measure requests served { job: "web"; fallback: 40; unit: "req/s" }

expect "Keeps 10×" { target: 10 }

flow req "requests" { rate: requests * load; from: users; route: api }

node users "Users"
node api "API" {
  pass
  demand: flows.req
  capacity: apiCapacity
  over: "clients get 503s"
}

users -> api
`

const series = (values: [number, string][]) =>
  JSON.stringify({ status: 'success', data: { resultType: 'matrix', result: [{ metric: {}, values }] } })

/** A Prometheus: the API's peak at 1,200 req/s over three points, the web rate at 40 req/s over `web` points. */
function prometheus(web = 3) {
  return (async (input: URL | string) => {
    const q = new URL(String(input)).searchParams.get('query') ?? ''
    const rows: [number, string][] = q.includes('job="api"')
      ? [
          [1794103200, '900'],
          [1794103500, '1200'],
          [1794103800, '1100'],
        ]
      : Array.from({ length: web }, (_, i) => [1794103200 + 300 * i, '40'] as [number, string])
    return new Response(series(rows), { headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

const ENV = { LOADMAP_PROMETHEUS_URL: 'https://prom.example', LOADMAP_PROMETHEUS_TOKEN: 't0ken' }
const NOW = () => new Date('2026-11-08T06:02:31Z')

async function file(text = SRC) {
  const dir = await mkdtemp(join(tmpdir(), 'loadmap-check-pull-'))
  const path = join(dir, 'shop.loadmap')
  await writeFile(path, text)
  return { dir, path }
}

async function run(argv: string[], o: { env?: Record<string, string>; fetch?: typeof fetch } = {}) {
  const lines: string[] = []
  const code = await check(argv, {
    log: (l) => lines.push(l),
    env: o.env ?? {},
    now: NOW,
    ...(o.fetch && { fetch: o.fetch }),
  })
  return { code, out: lines.join('\n') }
}

describe('loadmap check --pull', () => {
  it('pulls fresh data, writes the snapshot, and checks against it', async () => {
    const { dir, path } = await file()
    // 1,200 req/s measured against 40 req/s: the target at 15×
    const r = await run([path, '--pull', '--window', '1h'], { env: ENV, fetch: prometheus() })
    expect(r.code).toBe(0)
    expect(r.out).toContain(
      `${join(dir, 'shop.snapshot.json')}: 2 of 2 measurements, 2026-11-08T05:00:00Z to 2026-11-08T06:00:00Z`,
    )
    expect(r.out).toContain('shop.loadmap: 1 expectation holds')
    expect(r.out).toContain('  ✓ Keeps 10×: the 50 % target holds up to 15×, limited by API')
    // the same file, read back: the same answer
    const again = await run([path, '--snapshot', join(dir, 'shop.snapshot.json')])
    expect(again.code).toBe(0)
    expect(again.out).toContain('✓ Keeps 10×: the 50 % target holds up to 15×')
  })

  it('is inconclusive when the data is too thin: a warning by default, a failure on request', async () => {
    const { path } = await file()
    // the web rate has 1 of at least 3 samples: the rate is the fallback, and nothing is sure
    const thin = { env: ENV, fetch: prometheus(1) }
    const warn = await run([path, '--pull'], thin)
    expect(warn.code).toBe(0)
    expect(warn.out).toMatch(/warning: "Keeps 10×" is inconclusive: requests: 1 of at least 3 samples; /)
    expect(warn.out).toContain('shop.loadmap: of 1 expectation, 1 inconclusive')
    const fail = await run([path, '--pull', '--inconclusive', 'fail'], thin)
    expect(fail.code).toBe(1)
    expect(fail.out).toMatch(/error: "Keeps 10×" is inconclusive/)
  })

  it('fails on a fresh number that loses headroom, unless the expectation is a warning', async () => {
    const strict = await file(SRC.replace('{ target: 10 }', '{ target: 20 }'))
    const r = await run([strict.path, '--pull'], { env: ENV, fetch: prometheus() })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/error: "Keeps 10×" fails: expected at least 20×, but the 50 % target holds up to 15×/)
    const soft = await file(SRC.replace('{ target: 10 }', '{ target: 20; severity: warn }'))
    const w = await run([soft.path, '--pull', '--format', 'github'], { env: ENV, fetch: prometheus() })
    expect(w.code).toBe(0)
    expect(w.out).toMatch(/^::warning file=.*::"Keeps 10×" fails: expected at least 20×/m)
    expect(w.out).toContain('shop.loadmap: of 1 expectation, 1 warned')
  })

  it('reports everything on a dry run, and exits 0', async () => {
    const strict = await file(SRC.replace('{ target: 10 }', '{ target: 20 }'))
    const summary = join(strict.dir, 'summary.md')
    const r = await run([strict.path, '--pull', '--dry-run'], {
      env: { ...ENV, GITHUB_STEP_SUMMARY: summary },
      fetch: prometheus(),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/error: "Keeps 10×" fails/)
    expect(r.out).toContain('dry run: this would fail; it exits 0')
    const md = await readFile(summary, 'utf8')
    expect(md).toContain('### loadmap check')
    expect(md).toContain('A dry run: nothing here fails the job.')
    expect(md).toContain('| ❌ | Keeps 10× | fail | expected at least 20×, but the 50 % target holds up to 15×')
    expect(md).toMatch(/: fail · data 2026-11-01T06:00:00Z to 2026-11-08T06:00:00Z/)
  })

  it('writes the result as JSON, keyed by the commit', async () => {
    const { dir, path } = await file()
    const out = join(dir, 'result.json')
    const r = await run([path, '--pull', '--json', out], { env: { ...ENV, GITHUB_SHA: 'abc123' }, fetch: prometheus() })
    expect(r.code).toBe(0)
    const result = JSON.parse(await readFile(out, 'utf8')) as { version: number; commit: string; files: CheckedFile[] }
    expect([result.version, result.commit]).toEqual([1, 'abc123'])
    const f = result.files[0]!
    expect(f).toMatchObject({
      file: path,
      outcome: 'pass',
      snapshot: { fetched: '2026-11-08T06:02:31Z', from: '2026-11-01T06:00:00Z', to: '2026-11-08T06:00:00Z' },
      firstLimit: 'api',
      diagnostics: [],
    })
    expect(f.expectations).toEqual([
      expect.objectContaining({ label: 'Keeps 10×', severity: 'fail', outcome: 'pass', reasons: [] }),
    ])
    expect(f.expectations[0]!.target).toEqual({ low: 15, high: 15 })
    expect(f.components[0]).toMatchObject({
      id: 'api',
      util: 40 / 1200,
      capacity: { value: 1200, unit: 'req/s', provenance: 'measured' },
    })
    expect(f.components[0]!.capacity!.source).toMatch(/^prometheus: sum\(rate/)
    // --format json prints the same, and nothing else
    const printed = await run([
      path,
      '--snapshot',
      join(dir, 'shop.snapshot.json'),
      '--format',
      'json',
      '--commit',
      'abc123',
    ])
    const p = JSON.parse(printed.out)
    expect(p.files[0].expectations).toEqual(f.expectations)
    expect(p.commit).toBe('abc123')
  })

  it('refuses what cannot be meant, and a pull without its provider', async () => {
    const { path } = await file()
    expect((await run([path, '--pull', '--snapshot', 'x.json'])).out).toBe(
      '--pull reads fresh data, --snapshot a file: not both',
    )
    expect((await run([path, path, '--snapshot', 'x.json'])).code).toBe(2)
    expect((await run([path, '--window', '1h'])).out).toBe(
      '--window, --step, --to and --out say what --pull reads and writes: add --pull',
    )
    expect((await run([path, '--inconclusive', 'maybe'])).code).toBe(2)
    expect((await run([path, '--format', 'xml'])).out).toBe('--format is text, github or json, not "xml"')
    const unset = await run([path, '--pull'])
    expect(unset.code).toBe(1)
    expect(unset.out).toMatch(/prometheus is not configured/)
    const bad = await run([path, '--snapshot', path])
    expect(bad.code).toBe(1)
    expect(bad.out).toMatch(/cannot read it \(not a snapshot: the text is not JSON/)
  })
})
