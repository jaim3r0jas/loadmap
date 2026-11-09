import { compact } from '@loadmap/core/format'
import { defineView, edge, node, pool } from '@loadmap/layout'
import { search } from './model'

export const view = defineView(search, {
  nodes: {
    clients: node({ label: 'Clients', sub: 'web and apps' }),
    limiter: node({
      label: 'Rate limiter',
      sub: ({ limit }) => `${compact(limit)} req/s`,
      stage: 'limiter',
      tier: 'edge',
    }),
    api: pool({ label: 'Search API', sub: ({ maxPods }) => `2 to ${maxPods} pods`, stage: 'api', tier: 'services' }),
    cache: node({ label: 'Cache', sub: ({ hit }) => `${hit * 100} % hits`, stage: 'cache' }),
    shards: node({ label: 'Coordinator', sub: 'a miss to one shard', stage: 'shards', tier: 'data' }),
    db: node({ label: 'Index shard 1', stage: 'db', shape: 'cylinder', tier: 'data' }),
    db2: node({ label: 'Index shard 2', stage: 'db2', shape: 'cylinder', tier: 'data' }),
  },
  edges: [
    edge('clients', 'limiter', { label: ({ flows }) => `${compact(flows.searches)} searches/s` }),
    edge('limiter', 'api'),
    edge('api', 'cache'),
    edge('cache', 'shards', { label: ({ at }) => `${compact(at.shards.searches)} misses/s` }),
    edge('shards', 'db'),
    edge('shards', 'db2'),
  ],
  flows: { searches: { from: 'clients', color: 'accent', label: 'searches' } },
  tiers: { edge: { label: 'Edge' }, services: { label: 'Services' }, data: { label: 'Data' } },
  // no box moves between phases: the pool already draws every pod it may run
  layout: 'stable',
})
