// The checkout pipeline: pure TypeScript, tested in Vitest without a browser.
import { defineModel, estimated, measured, p, pass, queue, store, workers } from '@loadmap/core'
import { fitLinear } from '@loadmap/core/calibrate'
import cpu from './worker-cpu.json'

// cost = a + b × rate, fitted from the measured series; keeps a, b, r², n and the source
export const workerCores = fitLinear(cpu, { x: 'rate', y: 'cores', source: 'Grafana, peak week' })

export const checkout = defineModel({
  title: 'Checkout pipeline',
  load: p.load({ label: 'Users, × today', max: 100, default: 10 }),
  params: {
    gateways: p.select({ label: 'Gateway instances', options: [1, 2], default: 1 }),
    pods: p.select({ label: 'Worker pods', options: [2, 3, 4, 6], default: 3 }),
    threads: p.select({ label: 'Threads per pod', options: [4, 8, 16], default: 8 }),
    batch: p.switch({ label: 'Batch DB writes', default: true }),
    rows: p.select({ label: 'Rows per batch', options: [10, 50], default: 50, enabled: ({ batch }) => batch }),
  },
  presets: { 'Black Friday': { load: 40, pods: 6 } },
  // the design review: today against twice the gateways and the workers
  scenarios: { Today: {}, Proposed: { gateways: 2, pods: 6 } },
  growth: { rate: 0.06, per: 'month', asOf: '2026-11-01' },
  flows: {
    orders: { label: 'orders', rate: ({ load }) => 40 * load, unit: 'order', priority: 1 },
    events: {
      label: 'events',
      rate: ({ load }) => 900 * load,
      unit: 'event',
      priority: 2,
      overload: { drop: { olderThan: 60, reason: 'too_old' } },
    },
  },
  components: {
    gateway: {
      name: 'API gateway',
      demand: ({ flows }) => flows.orders + flows.events,
      capacity: ({ gateways }) => estimated(20_000 * gateways, 'req/s', 'vendor benchmark, not load-tested'),
      over: 'clients get 429s',
    },
    workers: {
      name: 'Worker pool',
      short: 'the worker pool',
      demand: ({ flows }) => workerCores(flows.orders + flows.events),
      capacity: ({ pods }) => measured(pods * 2, 'cores', 'pod CPU limit'),
      over: 'messages wait in the topic and the lag keeps growing',
      describe: ({ pods, threads }) => `${pods} pods × ${threads} threads, 2 cores each`,
    },
    db: {
      name: 'Postgres primary',
      short: 'the database',
      demand: ({ flows, batch, rows }) => (batch ? flows.orders / rows : flows.orders),
      capacity: estimated(4_000, 'commits/s'),
      over: 'commits queue on the primary',
    },
  },
  stages: {
    gateway: pass('gateway'),
    topic: queue({ partitions: { orders: 12, events: 24 } }),
    workers: workers('workers', { pods: ({ pods }) => pods, perPod: ({ threads }) => threads }),
    db: store('db'),
  },
  routes: { orders: ['gateway', 'topic', 'workers', 'db'], events: ['gateway', 'topic', 'workers'] },
  calibration: { 'Worker CPU per request': workerCores },
})
