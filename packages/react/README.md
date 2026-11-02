# @loadmap/react

Interactive capacity models for React. Declare the components of a system, the flows through it and what each one
can take; `<Loadmap>` draws the architecture with moving dots, ranks the components by when they run out, and writes
the verdict.

```bash
npm i @loadmap/react react react-dom
```

```tsx
import {
  defineModel,
  defineView,
  edge,
  estimated,
  Loadmap,
  measured,
  node,
  p,
  pool,
  store,
  workers,
} from '@loadmap/react'

// the model: plain TypeScript, no React
const shop = defineModel({
  title: 'Web shop',
  load: p.load({ label: 'Visitors, × today', max: 50, default: 1 }),
  params: { pods: p.select({ label: 'App pods', options: [2, 4, 8], default: 2 }) },
  flows: { requests: { label: 'requests', rate: ({ load }) => 300 * load, unit: 'request' } },
  components: {
    app: {
      name: 'App pods',
      demand: ({ flows }) => flows.requests * 0.002,
      capacity: ({ pods }) => measured(pods * 2, 'cores', 'pod CPU limit'),
      over: 'requests wait and time out',
    },
    db: {
      name: 'Postgres',
      demand: ({ flows }) => flows.requests * 2,
      capacity: estimated(5_000, 'queries/s', { source: 'last year’s load test', within: 0.3 }),
      over: 'queries queue on the primary',
    },
  },
  stages: { app: workers('app', { pods: ({ pods }) => pods, perPod: 4 }), db: store('db') },
  routes: { requests: ['app', 'db'] },
})

// the view: which boxes to draw and where the dots start
const view = defineView(shop, {
  nodes: {
    users: node({ label: 'Browsers' }),
    app: pool({ label: 'App', sub: ({ pods }) => `${pods} pods`, stage: 'app' }),
    db: node({ label: 'Postgres', stage: 'db', shape: 'cylinder' }),
  },
  edges: [edge('users', 'app'), edge('app', 'db')],
  flows: { requests: { from: 'users', color: 'accent' } },
})

export function App() {
  return <Loadmap model={shop} view={view} />
}
```

Every capacity says where it came from (`measured`, `estimated`, or a fit from measurements), and `± 30 %` turns
each limit into a range. Add `scenarios` to compare designs, `growth` to turn multiples into dates, `expect` to fail
a test when headroom is lost. The layout runs in a Web Worker; nothing loads it before the first diagram.

`useLoadmap` with `LoadmapRoot`, `Diagram`, `Verdict`, `Limits`, `Controls` and the others builds a page of your own
layout from the same pieces.

Docs, live examples and the editor: https://jaim3r0jas.github.io/loadmap/ · MIT
