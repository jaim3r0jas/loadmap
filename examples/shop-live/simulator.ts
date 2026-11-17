// A shop that only pretends to run: visitors browse, some of them order, workers bake the orders and everything
// ends in a database. It serves what a real one would export to Prometheus (/metrics), so the stack next to it
// (compose.yaml) has data a minute after it starts. Its traffic rises and falls over ten minutes, a day in small.
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

/** What the shop has done so far: the counters only grow, as Prometheus expects. */
export interface Shop {
  /** Seconds the shop has run. */
  at: number
  visits: number
  orders: number
  queries: number
  /** CPU the workers use right now, in cores. */
  cores: number
  seed: number
}

export const open = (seed = 1): Shop => ({ at: 0, visits: 0, orders: 0, queries: 0, cores: 0, seed })

/** Seconds a simulated day takes. */
export const DAY = 600
/** Visits a second at the day's middle; one in twenty orders. */
export const VISITS = 200
export const ORDERS = 0.05
/** Worker CPU: what an idle pool uses, and what an order adds (cores per order a second). */
export const IDLE = 0.1
export const PER_ORDER = 0.05

// a small seeded generator: the shop's noise is the same on every start
function noise(shop: Shop): number {
  shop.seed = (shop.seed * 16807) % 2147483647
  return shop.seed / 2147483647 - 0.5
}

/** The shop `dt` seconds later. */
export function advance(shop: Shop, dt: number): Shop {
  const day = 1 + 0.5 * Math.sin((2 * Math.PI * shop.at) / DAY)
  const visits = VISITS * day * (1 + 0.1 * noise(shop))
  const orders = visits * ORDERS * (1 + 0.1 * noise(shop))
  shop.at += dt
  shop.visits += visits * dt
  shop.orders += orders * dt
  // three reads a visit, five writes an order
  shop.queries += (3 * visits + 5 * orders) * dt
  shop.cores = IDLE + PER_ORDER * orders * (1 + 0.04 * noise(shop))
  return shop
}

/** The shop in Prometheus' text format. */
export function metrics(shop: Shop): string {
  return [
    '# HELP shop_requests_total Requests served, by service.',
    '# TYPE shop_requests_total counter',
    `shop_requests_total{service="web"} ${Math.floor(shop.visits)}`,
    `shop_requests_total{service="checkout"} ${Math.floor(shop.orders)}`,
    '# HELP shop_db_queries_total Queries the database answered.',
    '# TYPE shop_db_queries_total counter',
    `shop_db_queries_total ${Math.floor(shop.queries)}`,
    '# HELP shop_worker_cpu_cores CPU the order workers use.',
    '# TYPE shop_worker_cpu_cores gauge',
    `shop_worker_cpu_cores ${shop.cores.toFixed(4)}`,
    '',
  ].join('\n')
}

// run as a program (node simulator.ts): one step a second, served on 9464
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const shop = open()
  setInterval(() => advance(shop, 1), 1000)
  createServer((req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' }).end(metrics(shop))
  }).listen(Number(process.env.PORT ?? 9464), () => console.log('the shop is open: /metrics on 9464'))
}
