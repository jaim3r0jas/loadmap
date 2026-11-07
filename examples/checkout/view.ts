import { compact } from '@loadmap/core/format'
import { cluster, defineView, edge, node, pool } from '@loadmap/layout'
import { checkout } from './model'

export const view = defineView(checkout, {
  nodes: {
    phones: node({ label: 'Phones', sub: 'app checkout' }),
    gateway: node({ label: 'API gateway', stage: 'gateway', tier: 'edge' }),
    kafka: cluster({
      label: 'Kafka',
      sub: 'orders and events',
      members: 3,
      stage: 'topic',
      memberLabel: (i) => `broker ${i}`,
      tier: 'services',
    }),
    workers: pool({
      label: 'Workers',
      sub: ({ pods, threads }) => `${pods} pods × ${threads} threads`,
      stage: 'workers',
    }),
    db: node({ label: 'Postgres', sub: 'primary', stage: 'db', shape: 'cylinder', tier: 'data' }),
  },
  edges: [
    edge('phones', 'gateway', { label: 'POST /checkout' }),
    edge('gateway', 'kafka', { label: ({ flows }) => `${compact(flows.orders)} orders/s` }),
    edge('kafka', 'workers'),
    edge('workers', 'db', { label: ({ batch, rows }) => (batch ? `${rows} rows a commit` : 'a commit per order') }),
  ],
  flows: {
    orders: { from: 'phones', color: 'accent', label: 'orders' },
    events: { from: 'phones', color: 'alt', label: 'events' },
  },
  // the phones stand in the tier of the gateway they feed, the workers in that of the topic that feeds them
  tiers: { edge: { label: 'Edge' }, services: { label: 'Services' }, data: { label: 'Data' } },
  layout: 'compact',
})
