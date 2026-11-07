/** A starter in the "New from template" menu, by its name; its text loads when the reader picks it. */
export interface TemplateEntry {
  id: string
  title: string
  /** One line for a menu or a gallery card. */
  summary: string
}

/** The starters that come with the editor: each compiles, keeps its expectations and lays out without collisions. */
export const CATALOG: readonly TemplateEntry[] = [
  { id: 'web-app', title: 'Web app and database', summary: 'App pods in front of one database.' },
  {
    id: 'read-replicas',
    title: 'Reads on replicas',
    summary: 'Reads on replicas, writes on a primary that ships them on.',
  },
  { id: 'queue-workers', title: 'Queue and workers', summary: 'An API that queues jobs for a pool of workers.' },
  { id: 'notifications', title: 'Notification fan-out', summary: 'One event, several messages, a quota per provider.' },
  { id: 'batch-import', title: 'Batch import', summary: 'Upload, store, parse and load into a warehouse in batches.' },
  {
    id: 'third-party-api',
    title: 'Third-party API with a quota',
    summary: 'A vendor’s rate limit, a cache, and a bigger plan.',
  },
  {
    id: 'cache',
    title: 'Cache in front of a database',
    summary: 'Hits answered at the cache, only misses reach the database.',
  },
  { id: 'autoscale', title: 'Autoscaled API', summary: 'Pods added with the load, up to a ceiling.' },
  {
    id: 'rate-limit',
    title: 'Rate limiter',
    summary: 'A limit that turns away the excess and protects what is behind it.',
  },
  {
    id: 'retry-storm',
    title: 'Retry storm',
    summary: 'Retries that multiply the traffic past capacity, and a budget.',
  },
]
