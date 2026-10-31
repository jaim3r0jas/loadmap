import { kfmt } from '@loadmap/core'
import { cluster, edge, node, pool, topology } from '@loadmap/layout'
import { checkout } from './model'

export const view = topology(checkout, {
  nodes: {
    phones: node({ label: 'Phones', sub: 'app checkout' }),
    gateway: node({ label: 'API gateway', stage: 'gateway' }),
    kafka: cluster({
      label: 'Kafka',
      sub: 'orders and events',
      members: 3,
      stage: 'topic',
      memberLabel: (i) => `broker ${i}`,
    }),
    workers: pool({
      label: 'Workers',
      sub: ({ pods, threads }) => `${pods} pods × ${threads} threads`,
      stage: 'workers',
    }),
    db: node({ label: 'Postgres', sub: 'primary', stage: 'db', shape: 'cylinder' }),
  },
  edges: [
    edge('phones', 'gateway', { label: 'POST /checkout' }),
    edge('gateway', 'kafka', { label: ({ flows }) => `${kfmt(flows.orders)} orders/s` }),
    edge('kafka', 'workers'),
    edge('workers', 'db', { label: ({ batch, rows }) => (batch ? `${rows} rows a commit` : 'a commit per order') }),
  ],
  flows: {
    orders: { from: 'phones', color: 'accent', label: 'orders' },
    events: { from: 'phones', color: 'alt', label: 'events' },
  },
})
