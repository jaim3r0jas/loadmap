import type { Server } from 'node:http'
import type { Explorer, Provider } from '@loadmap/providers'
import { afterEach, describe, expect, it } from 'vitest'
import { bridge, connectCode } from '../src/bridge'

const SITE = 'https://docs.example'
const CODE = 'TEST-CODE'

const store: Explorer = {
  id: 'prometheus',
  search: async () => ({ metrics: [{ name: 'shop_requests_total', type: 'counter' }] }),
  labels: async () => ({ series: 0, labels: [] }),
  try: async () => ({ series: 1, samples: 3, mean: 20, max: 30, p95: 30 }),
}
const provider: Provider = {
  id: 'prometheus',
  read: async () => ({
    points: [
      [1_795_000_000, 10],
      [1_795_000_060, 30],
    ],
  }),
}

let open: { server: Server; done: Promise<number> } | undefined
afterEach(async () => {
  open?.server.close()
  await open?.done
  open = undefined
})

/** A bridge on a free port, for the site named: its address, and every line it logged. */
async function start(argv: string[] = ['--port', '0', '--origin', SITE]) {
  const lines: string[] = []
  let ready!: (v: { server: Server; port: number }) => void
  const listening = new Promise<{ server: Server; port: number }>((r) => {
    ready = r
  })
  const done = bridge(argv, {
    log: (s) => lines.push(s),
    explorers: { prometheus: store },
    providers: { prometheus: provider },
    now: () => new Date('2026-11-22T00:00:00Z'),
    code: CODE,
    onListen: (server, port) => ready({ server, port }),
  })
  const { server, port } = await listening
  open = { server, done }
  return { at: `http://127.0.0.1:${port}`, lines }
}

const get = (url: string, origin = SITE, code = CODE) => fetch(url, { headers: { origin, 'x-loadmap-code': code } })
const post = (url: string, body: unknown, origin = SITE, code = CODE) =>
  fetch(url, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', 'x-loadmap-code': code },
    body: JSON.stringify(body),
  })

describe('loadmap bridge', () => {
  it('answers only the site named, with the code it printed', async () => {
    const { at, lines } = await start()
    expect(lines).toEqual([
      expect.stringMatching(
        /^loadmap bridge: http:\/\/localhost:\d+, for https:\/\/docs\.example\. Ctrl\+C stops it\.$/,
      ),
      "Connect code: TEST-CODE (type it next to Connect in the editor's Ask panel)",
    ])
    // no page, no answer
    expect((await fetch(`${at}/`)).status).toBe(403)
    // another site reads why, and what would let it
    const other = await get(`${at}/`, 'http://localhost:5173')
    expect([other.status, other.headers.get('access-control-allow-origin'), (await other.json()).error]).toEqual([
      403,
      'http://localhost:5173',
      'this page may not use the bridge: start it with --origin http://localhost:5173',
    ])
    // the same site without the code: another page of that origin knows nothing of it
    const wrong = await get(`${at}/`, SITE, 'GUESS-1234')
    expect([wrong.status, (await wrong.json()).error]).toEqual([401, 'the code is not the one loadmap bridge printed'])
    const stores = await get(`${at}/`)
    expect(await stores.json()).toEqual({ explore: ['prometheus'], measure: ['prometheus'] })
  })

  it('says yes to a page asking a server on this machine, with the headers it sends', async () => {
    const { at } = await start()
    const pre = await fetch(`${at}/explore`, {
      method: 'OPTIONS',
      headers: { origin: SITE, 'access-control-request-private-network': 'true' },
    })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe(SITE)
    expect(pre.headers.get('access-control-allow-private-network')).toBe('true')
    expect(pre.headers.get('access-control-allow-headers')).toContain('x-loadmap-code')
  })

  it('runs the looks a page sends, and pulls its measures, never naming the store', async () => {
    const { at } = await start()
    const looked = await post(`${at}/explore`, { calls: [{ tool: 'search', arg: 'shop requests' }] })
    expect(await looked.json()).toEqual({ text: 'search shop requests:\n  shop_requests_total (counter)' })
    const pulled = await post(`${at}/pull`, {
      measures: [
        { id: 'visits', provider: 'prometheus', query: 'sum(rate(shop_requests_total[5m]))', unit: 'visits/s' },
      ],
      from: '2026-11-21T23:00:00Z',
      to: '2026-11-22T00:00:00Z',
      step: 60,
    })
    expect(await pulled.json()).toMatchObject({ format: 'loadmap-snapshot', measurements: { visits: { value: 20 } } })
  })

  it('refuses what is no call and a pull too large, and starts only with a store to read', async () => {
    const { at } = await start()
    expect((await post(`${at}/explore`, { calls: 'search x' })).status).toBe(400)
    expect((await post(`${at}/pull`, { measures: [], from: 'yesterday', to: 'now' })).status).toBe(400)
    const many = Array.from({ length: 101 }, (_, i) => ({ id: `m${i}`, provider: 'prometheus', query: 'up' }))
    const big = await post(`${at}/pull`, { measures: many, from: '2026-11-21T00:00:00Z', to: '2026-11-22T00:00:00Z' })
    expect([big.status, (await big.json()).error]).toEqual([400, 'a pull reads at most 100 measures over 7 days'])
    expect((await post(`${at}/nothing`, {})).status).toBe(404)
    const lines: string[] = []
    expect(await bridge(['--port', '0'], { log: (s) => lines.push(s), env: {} })).toBe(2)
    expect(lines).toEqual(['loadmap bridge: no store to read: set LOADMAP_PROMETHEUS_URL (and its token or user)'])
    expect(await bridge(['--port', '80'], { log: () => {}, env: {} })).toBe(2)
  })

  it('says so when its port is taken, rather than crash', async () => {
    const { at } = await start()
    const port = new URL(at).port
    const lines: string[] = []
    const code = await bridge(['--port', port, '--origin', SITE], {
      log: (s) => lines.push(s),
      explorers: { prometheus: store },
    })
    expect([code, lines]).toEqual([
      2,
      [`loadmap bridge: port ${port} is taken (another bridge?): --port picks another`],
    ])
  })

  it('makes a code of eight letters nobody misreads', () => {
    expect(connectCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
  })
})
