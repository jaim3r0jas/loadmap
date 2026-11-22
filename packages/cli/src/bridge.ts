import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { parseArgs } from 'node:util'
import {
  type ExploreCall,
  type Explorer,
  explorersFromEnv,
  type Provider,
  type PullRequest,
  providersFromEnv,
  pull,
  runExplore,
} from '@loadmap/providers'

export interface BridgeOptions {
  log?: (s: string) => void
  env?: Readonly<Record<string, string | undefined>>
  /** For tests: the stores, instead of the environment's. */
  explorers?: Record<string, Explorer>
  providers?: Record<string, Provider>
  now?: () => Date
  /** Resolves once listening, with the server: for tests to close it. */
  onListen?: (server: Server, port: number) => void
}

const USAGE = 'loadmap bridge [--port 7788] [--origin https://your-docs-site]'
const MAX_BODY = 200_000

/**
 * `loadmap bridge`: the reader's metrics for an editor in their browser, on this machine only. It listens on
 * localhost, answers only the origins named (the docs site by default), and holds the address and the credentials of
 * the store (`LOADMAP_PROMETHEUS_URL` and its token): the page sends calls to explore and measures to pull, and gets
 * back what was read, never where from. Read only.
 */
export async function bridge(argv: string[], o: BridgeOptions = {}): Promise<number> {
  const log = o.log ?? console.log
  let port: number
  let origins: string[]
  try {
    const p = parseArgs({
      args: argv,
      options: { port: { type: 'string' }, origin: { type: 'string', multiple: true } },
    })
    port = Number(p.values.port ?? 7788)
    // 0: any free port (the tests)
    if (!Number.isInteger(port) || (port !== 0 && (port < 1024 || port > 65535)))
      throw new Error('--port is a number from 1024 to 65535')
    origins = (p.values.origin ?? ['https://jaim3r0jas.github.io']).map((x) => new URL(x).origin)
  } catch (err) {
    log(`${(err as Error).message}\n${USAGE}`)
    return 2
  }
  const env = o.env ?? process.env
  let explorers: Record<string, Explorer>
  let providers: Record<string, Provider>
  try {
    explorers = o.explorers ?? explorersFromEnv(env)
    providers = o.providers ?? providersFromEnv(env)
  } catch (err) {
    log(`loadmap bridge: ${(err as Error).message}`)
    return 2
  }
  if (!Object.keys(explorers).length && !Object.keys(providers).length) {
    log('loadmap bridge: no store to read: set LOADMAP_PROMETHEUS_URL (and its token or user)')
    return 2
  }
  const answer = (res: ServerResponse, status: number, body: unknown, origin?: string) => {
    if (origin) {
      res.setHeader('access-control-allow-origin', origin)
      res.setHeader('vary', 'origin')
    }
    res.setHeader('content-type', 'application/json')
    res.writeHead(status)
    res.end(JSON.stringify(body))
  }
  const read = (req: IncomingMessage) =>
    new Promise<unknown>((resolve, reject) => {
      let size = 0
      const parts: Buffer[] = []
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > MAX_BODY) {
          reject(new Error('too large'))
          req.destroy()
        } else parts.push(c)
      })
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'))
        } catch {
          reject(new Error('not JSON'))
        }
      })
    })
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin
    // only the pages named, and never a page that sends no origin from elsewhere
    const ok = typeof origin === 'string' && origins.includes(origin)
    if (!ok) return answer(res, 403, { error: 'this page may not use the bridge' })
    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-methods', 'GET, POST')
      res.setHeader('access-control-max-age', '600')
      res.setHeader('access-control-allow-headers', 'content-type')
      // a page on the internet asking a server on this machine: Chrome asks the server to say yes
      res.setHeader('access-control-allow-private-network', 'true')
      return answer(res, 204, null, origin)
    }
    const path = (req.url ?? '').split('?')[0]
    try {
      if (req.method === 'GET' && path === '/') return answer(res, 200, { stores: Object.keys(explorers) }, origin)
      if (req.method === 'POST' && path === '/explore') {
        const body = (await read(req)) as { calls?: ExploreCall[]; store?: string }
        const store = explorers[body.store ?? 'prometheus'] ?? Object.values(explorers)[0]
        if (!store || !Array.isArray(body.calls)) return answer(res, 400, { error: 'explore takes { calls }' }, origin)
        const calls = body.calls.filter(
          (c) => c && ['search', 'labels', 'try'].includes(c.tool) && typeof c.arg === 'string' && c.arg.length < 2000,
        )
        return answer(res, 200, { text: await runExplore(store, calls, { now: o.now?.() ?? new Date() }) }, origin)
      }
      if (req.method === 'POST' && path === '/pull') {
        const body = (await read(req)) as { measures?: PullRequest[]; from?: string; to?: string; step?: number }
        const from = Date.parse(String(body.from))
        const to = Date.parse(String(body.to))
        if (!Array.isArray(body.measures) || !Number.isFinite(from) || !Number.isFinite(to) || to <= from)
          return answer(res, 400, { error: 'pull takes { measures, from, to, step }' }, origin)
        // a page asks for what one definition measures, over a recent window: no more
        if (body.measures.length > 100 || to - from > 7 * 86_400_000)
          return answer(res, 400, { error: 'a pull reads at most 100 measures over 7 days' }, origin)
        const snapshot = await pull(body.measures, {
          from: new Date(from).toISOString(),
          to: new Date(to).toISOString(),
          step: Math.max(15, Number(body.step) || 60),
          fetched: (o.now?.() ?? new Date()).toISOString(),
          providers,
        })
        return answer(res, 200, snapshot, origin)
      }
      return answer(res, 404, { error: 'no such call' }, origin)
    } catch (err) {
      return answer(res, 400, { error: (err as Error).message }, origin)
    }
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const at = (server.address() as AddressInfo).port
  log(`loadmap bridge: http://localhost:${at}, for ${origins.join(', ')}. Ctrl+C stops it.`)
  o.onListen?.(server, at)
  return new Promise<number>((resolve) => server.on('close', () => resolve(0)))
}
