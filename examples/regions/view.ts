import { type AnyNodeDef, cluster, defineView, type EdgeDef, edge, node, pool } from '@loadmap/layout'
import { regions } from './model'

/** A region's stages, by the ids the language gives them. */
type Stage<R extends string> = `${R}.${'lb' | 'api' | 'orders.topic' | 'orders.workers' | 'db'}`

/** One region's boxes and the edges between them; its orders line is a subsystem in it. */
const region = <const R extends string>(
  id: R,
  apiPods: number,
  pods: string | ((c: { usPods: number }) => string),
) => ({
  nodes: {
    [`${id}.lb`]: node({ label: 'Load balancer', stage: `${id}.lb` }),
    [`${id}.api`]: pool({ label: 'API', sub: `${apiPods} pods`, stage: `${id}.api` }),
    [`${id}.orders.kafka`]: cluster({
      label: 'Kafka',
      stage: `${id}.orders.topic`,
      members: 3,
      memberLabel: (i) => `broker ${i}`,
    }),
    [`${id}.orders.workers`]: pool({ label: 'Workers', sub: pods as never, stage: `${id}.orders.workers` }),
    [`${id}.db`]: node({ label: 'Postgres', sub: 'primary', stage: `${id}.db`, shape: 'cylinder' }),
  } as Record<`${R}.${'lb' | 'api' | 'orders.kafka' | 'orders.workers' | 'db'}`, AnyNodeDef<Stage<R>, never>>,
  edges: [
    edge(`${id}.orders.kafka`, `${id}.orders.workers`),
    edge(`${id}.lb`, `${id}.api`),
    edge(`${id}.api`, `${id}.orders.kafka`),
    edge(`${id}.orders.workers`, `${id}.db`),
  ] as EdgeDef<`${R}.${'lb' | 'api' | 'orders.kafka' | 'orders.workers' | 'db'}`>[],
})

const eu = region('eu', 10, '4 pods')
const us = region('us', 8, ({ usPods }) => `${usPods} pods`)

export const view = defineView(regions, {
  nodes: {
    users: node({ label: 'Users', sub: 'EU and US' }),
    router: node({ label: 'Traffic router', sub: 'by region', stage: 'router' }),
    ...eu.nodes,
    ...us.nodes,
  },
  edges: [...eu.edges, ...us.edges, edge('users', 'router'), edge('router', 'eu.lb'), edge('router', 'us.lb')],
  flows: {
    eu: { from: 'users', color: 'accent', label: 'EU orders' },
    euInUs: { from: 'users', color: 'accent', label: 'EU orders in the US' },
    us: { from: 'users', color: 'alt', label: 'US orders' },
    usInEu: { from: 'users', color: 'alt', label: 'US orders in the EU' },
  },
  // a box stands in the subsystem its id starts with: `eu.orders.workers` in the EU region's orders
  subsystems: {
    eu: { label: 'EU region' },
    'eu.orders': { label: 'Orders' },
    us: { label: 'US region' },
    'us.orders': { label: 'Orders' },
  },
})
