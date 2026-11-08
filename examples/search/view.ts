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
    db: node({ label: 'Search index', sub: 'primary', stage: 'db', shape: 'cylinder', tier: 'data' }),
  },
  edges: [
    edge('clients', 'limiter', { label: ({ flows }) => `${compact(flows.searches)} searches/s` }),
    edge('limiter', 'api'),
    edge('api', 'cache'),
    edge('cache', 'db', { label: ({ at }) => `${compact(at.db.searches)} misses/s` }),
  ],
  flows: { searches: { from: 'clients', color: 'accent', label: 'searches' } },
  tiers: { edge: { label: 'Edge' }, services: { label: 'Services' }, data: { label: 'Data' } },
  // no box moves between phases: the pool already draws every pod it may run
  layout: 'stable',
})
