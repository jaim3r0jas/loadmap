import type { TemplateEntry } from './catalog'
import autoscale from './templates/autoscale.loadmap?raw'
import batchImport from './templates/batch-import.loadmap?raw'
import cache from './templates/cache.loadmap?raw'
import notifications from './templates/notifications.loadmap?raw'
import queueWorkers from './templates/queue-workers.loadmap?raw'
import rateLimit from './templates/rate-limit.loadmap?raw'
import readReplicas from './templates/read-replicas.loadmap?raw'
import retryStorm from './templates/retry-storm.loadmap?raw'
import thirdPartyApi from './templates/third-party-api.loadmap?raw'
import webApp from './templates/web-app.loadmap?raw'

export interface Template extends TemplateEntry {
  source: string
}

/**
 * Starters for "New from template": each compiles, keeps its expectations and lays out without collisions. Written out
 * whole, not built from the catalog: the editor's first load holds the catalog, and this module stays a chunk of its
 * own, loaded when a starter is picked (templates.test.ts keeps the two the same).
 */
export const TEMPLATES: readonly Template[] = [
  { id: 'web-app', title: 'Web app and database', summary: 'App pods in front of one database.', source: webApp },
  {
    id: 'read-replicas',
    title: 'Reads on replicas',
    summary: 'Reads on replicas, writes on a primary that ships them on.',
    source: readReplicas,
  },
  {
    id: 'queue-workers',
    title: 'Queue and workers',
    summary: 'An API that queues jobs for a pool of workers.',
    source: queueWorkers,
  },
  {
    id: 'notifications',
    title: 'Notification fan-out',
    summary: 'One event, several messages, a quota per provider.',
    source: notifications,
  },
  {
    id: 'batch-import',
    title: 'Batch import',
    summary: 'Upload, store, parse and load into a warehouse in batches.',
    source: batchImport,
  },
  {
    id: 'third-party-api',
    title: 'Third-party API with a quota',
    summary: 'A vendor’s rate limit, a cache, and a bigger plan.',
    source: thirdPartyApi,
  },
  {
    id: 'cache',
    title: 'Cache in front of a database',
    summary: 'Hits answered at the cache, only misses reach the database.',
    source: cache,
  },
  {
    id: 'autoscale',
    title: 'Autoscaled API',
    summary: 'Pods added with the load, up to a ceiling.',
    source: autoscale,
  },
  {
    id: 'rate-limit',
    title: 'Rate limiter',
    summary: 'A limit that turns away the excess and protects what is behind it.',
    source: rateLimit,
  },
  {
    id: 'retry-storm',
    title: 'Retry storm',
    summary: 'Retries that multiply the traffic past capacity, and a budget.',
    source: retryStorm,
  },
]
