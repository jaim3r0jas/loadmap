import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fromSnapshot, parseSnapshot } from '@loadmap/core/measure'
import { compile } from '@loadmap/dsl'
import { describe, expect, it } from 'vitest'
import { main, pull } from '../src'

const SRC = `loadmap 1
load { max: 50 }

metric served "Requests served" {
  prometheus { query: 'sum(rate(http_requests_total{job="{{ args.job }}"}[5m]))' }
  stat: max
  min: 3
}

measure apiCapacity served { job: "api"; fallback: estimated(1_000, "req/s", "vendor benchmark") }
measure requests served { job: "web"; fallback: 40; unit: "req/s" }

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

/** A Prometheus with one recorded answer per job; every request is kept. */
function server() {
  const asked: URL[] = []
  const fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input))
    asked.push(url)
    expect((init?.headers as Record<string, string> | undefined)?.authorization).toBe('Bearer t0ken')
    const q = url.searchParams.get('query') ?? ''
    const body = q.includes('job="api"')
      ? series([
          [1794103200, '900'],
          [1794103500, '1200'],
          [1794103800, '1100'],
        ])
      : series([[1794103200, '60']])
    return new Response(body, { headers: { 'content-type': 'application/json' } })
  }) as typeof globalThis.fetch
  return { fetch, asked }
}

const ENV = { LOADMAP_PROMETHEUS_URL: 'https://prom.example', LOADMAP_PROMETHEUS_TOKEN: 't0ken' }
const NOW = () => new Date('2026-11-08T06:02:31.500Z')

async function file(text = SRC) {
  const dir = await mkdtemp(join(tmpdir(), 'loadmap-pull-'))
  const path = join(dir, 'shop.loadmap')
  await writeFile(path, text)
  return { dir, path }
}

describe('loadmap pull', () => {
  it('writes the snapshot next to the definition, on the step grid, and says what it read', async () => {
    const { dir, path } = await file()
    const s = server()
    const lines: string[] = []
    const code = await pull([path, '--window', '1h', '--step', '5m'], {
      log: (l) => lines.push(l),
      env: ENV,
      fetch: s.fetch,
      now: NOW,
    })
    expect(code).toBe(0)
    const out = join(dir, 'shop.snapshot.json')
    expect(lines).toEqual([
      `${out}: 1 of 2 measurements, 2026-11-08T05:00:00Z to 2026-11-08T06:00:00Z`,
      '  ✓ apiCapacity: 1,200 req/s (3 samples, max)',
      '  ✗ requests: 1 of at least 3 samples',
    ])
    expect(Object.fromEntries(s.asked[0]!.searchParams)).toMatchObject({
      start: '2026-11-08T05:00:00Z',
      end: '2026-11-08T06:00:00Z',
      step: '300',
    })
    const text = await readFile(out, 'utf8')
    // no address and no credential in what may be shared
    expect(text).not.toMatch(/prom\.example|t0ken/)
    const snapshot = parseSnapshot(text)
    expect(snapshot.fetched).toBe('2026-11-08T06:02:31Z')

    // the model reads it: the measured capacity, and the fallback where the window was thin
    const ev = compile(SRC, { snapshot: fromSnapshot(snapshot) }).definition!.model.evaluate()
    expect(ev.components.api!.capacity).toMatchObject({ value: 1200, provenance: 'measured' })
    expect(ev.flows.req).toBe(40)
  })

  it('writes the same bytes for the same answers and the same moment', async () => {
    const a = await file()
    const b = await file()
    for (const f of [a, b])
      await pull([f.path, '--to', '2026-11-08T06:00:00Z'], { log: () => {}, env: ENV, fetch: server().fetch, now: NOW })
    const read = (f: { dir: string }) => readFile(join(f.dir, 'shop.snapshot.json'), 'utf8')
    expect(await read(a)).toBe(await read(b))
  })

  it('refuses without a configured provider, a definition with errors, or a bad option', async () => {
    const { path } = await file()
    const lines: string[] = []
    const log = (l: string) => lines.push(l)
    expect(await pull([path], { log, env: {}, now: NOW })).toBe(1)
    expect(lines.at(-1)).toMatch(/prometheus is not configured: set LOADMAP_PROMETHEUS_URL/)
    const broken = await file(SRC.replace('measure requests served', 'measure requests serve'))
    expect(await pull([broken.path], { log, env: ENV, now: NOW })).toBe(1)
    expect(lines.at(-1)).toMatch(/does not compile; nothing pulled/)
    expect(await pull([path, '--window', '7 days'], { log, env: ENV, now: NOW })).toBe(2)
    expect(lines.at(-1)).toBe('--window is a whole number and s, m, h or d ("7d", "5m"), not "7 days"')
    expect(await pull([path, '--window', '90d', '--step', '15s'], { log, env: ENV, now: NOW })).toBe(2)
    expect(await pull([], { log })).toBe(2)
  })

  it('pulls a definition whose expect lines fail: fresh data is what they wait for', async () => {
    const { path } = await file(`${SRC}expect "Keeps 100×" { target: 100 }\n`)
    const lines: string[] = []
    expect(await pull([path], { log: (l) => lines.push(l), env: ENV, fetch: server().fetch, now: NOW })).toBe(0)
    expect(lines[0]).toMatch(/1 of 2 measurements/)
  })

  it('names the default window when the step makes too many points', async () => {
    const { path } = await file()
    const lines: string[] = []
    expect(await pull([path, '--step', '1s'], { log: (l) => lines.push(l), env: ENV, now: NOW })).toBe(2)
    expect(lines).toEqual(['--window 7d at --step 1s is too many points: Prometheus takes at most 11,000'])
  })

  it('is listed in the usage', async () => {
    const lines: string[] = []
    await main(['--help'], (l) => lines.push(l))
    expect(lines.join('\n')).toMatch(/loadmap pull <file\.loadmap>/)
  })
})
