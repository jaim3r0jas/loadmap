import { fromSnapshot } from '@loadmap/core/measure'
import { compile } from '@loadmap/dsl'
import { type Provider, pull } from '@loadmap/providers'
import { expect, it } from 'vitest'
import source from './shop.loadmap?raw'
import { advance, metrics, ORDERS, open, VISITS } from './simulator'

it('the shop serves counters that only grow, in the text Prometheus reads', () => {
  const shop = open()
  let last = { visits: 0, orders: 0, queries: 0 }
  for (let i = 0; i < 600; i++) {
    advance(shop, 1)
    expect(shop.visits).toBeGreaterThan(last.visits)
    expect(shop.orders).toBeGreaterThan(last.orders)
    expect(shop.queries).toBeGreaterThan(last.queries)
    last = { visits: shop.visits, orders: shop.orders, queries: shop.queries }
  }
  // a whole day: its traffic averages what the simulator says, one visit in twenty an order
  expect(shop.visits / 600).toBeCloseTo(VISITS, -1)
  expect(shop.orders / shop.visits).toBeCloseTo(ORDERS, 2)
  const samples = metrics(shop)
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
  expect(samples.map((l) => l.split(' ')[0])).toEqual([
    'shop_requests_total{service="web"}',
    'shop_requests_total{service="checkout"}',
    'shop_db_queries_total',
    'shop_worker_cpu_cores',
  ])
  for (const l of samples) expect(Number(l.split(' ')[1])).toBeGreaterThan(0)
})

it('the definition reads every one of its measures from the shop, and its promise holds on them', async () => {
  const plain = compile(source)
  expect(plain.diagnostics).toEqual([])
  expect(plain.measures.map((m) => [m.id, m.provider])).toEqual([
    ['visitRate', 'prometheus'],
    ['orderRate', 'prometheus'],
    ['coresNow', 'prometheus'],
    ['queryRate', 'prometheus'],
  ])
  // every query names a series the shop serves
  const served = metrics(open())
  for (const m of plain.measures) expect(served).toContain(/shop_\w+/.exec(m.query)![0])

  // a provider that answers from the shop itself, as Prometheus would from its scrapes: ten minutes, a point a step
  const shop = open()
  const day: { orders: number; visits: number; queries: number; cores: number }[] = []
  for (let i = 0; i < 600; i++) day.push({ ...advance(shop, 1) })
  const rate = (key: 'orders' | 'visits' | 'queries') => (t: number) => (day[t]![key] - day[t - 60]![key]) / 60
  const stand: Provider = {
    id: 'prometheus',
    read: async ({ query, step }) => {
      const value = query.includes('"web"')
        ? rate('visits')
        : query.includes('"checkout"')
          ? rate('orders')
          : query.includes('db_queries')
            ? rate('queries')
            : (t: number) => day[t]!.cores
      const points: [number, number][] = []
      for (let t = 60; t < 600; t += step) points.push([t, value(t)])
      return { points }
    },
  }
  const snapshot = await pull(plain.measures, {
    from: '2026-11-01T00:00:00Z',
    to: '2026-11-01T00:10:00Z',
    step: 10,
    fetched: '2026-11-01T00:10:00Z',
    providers: { prometheus: stand },
  })
  expect(Object.values(snapshot.measurements).filter((m) => 'missing' in m)).toEqual([])
  const live = compile(source, { snapshot: fromSnapshot(snapshot) })
  expect(live.diagnostics).toEqual([])
  expect(live.expectations.map((e) => e.result.ok)).toEqual([true])
  // the workers' demand is the CPU the shop reports, not the definition's own 0.6 cores
  const { model } = live.definition!
  const now = model.evaluate(model.defaults()).components.orderWorkers!
  const cores = Object.values(snapshot.measurements).map((m) => ('value' in m ? m.value : 0))[2]!
  expect(now.demand).toBeCloseTo(cores, 6)
})
