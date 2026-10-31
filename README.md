# loadmap

Interactive capacity models for React. Declare the components of a system, the flows through it and the controls
that change it; loadmap draws the architecture with moving dots, ranks the components by when they run out, and
writes the verdict.

```
model (pure TS)          view (pure data)            React
params, flows,      →    nodes, clusters, pools,  →  <Loadmap model view />
components, stages       edges, flow colours          diagram · verdict · live · limits · controls · assumptions
   │                        │
   ├─ limits, verdict       └─ ELK layout, no label collisions
   └─ fluid sim → dots ───────────────────────────→  canvas overlay · PNG / WebM export
```

## A model

```ts
import { defineModel, estimated, measured, p, pass, queue, store, workers } from '@loadmap/core'
import { fitLinear } from '@loadmap/core/calibrate'

const workerCores = fitLinear(cpu, { x: 'rate', y: 'cores', source: 'Grafana, peak week' })

export const checkout = defineModel({
  load: p.load({ label: 'Users, × today', max: 100, default: 10 }),
  params: {
    pods: p.select({ label: 'Worker pods', options: [2, 3, 4, 6], default: 3 }),
    batch: p.switch({ label: 'Batch DB writes', default: true }),
    rows: p.select({ label: 'Rows per batch', options: [10, 50], default: 50, enabled: ({ batch }) => batch }),
  },
  flows: {
    orders: { rate: ({ load }) => 40 * load, priority: 1 },
    events: { rate: ({ load }) => 900 * load, priority: 2, overload: { drop: { olderThan: 60 } } },
  },
  components: {
    workers: {
      name: 'Worker pool',
      demand: ({ flows }) => workerCores(flows.orders + flows.events),
      capacity: ({ pods }) => measured(pods * 2, 'cores', 'pod CPU limit'),
      over: 'messages wait in the topic and the lag keeps growing',
    },
    // …
  },
  stages: {
    topic: queue({ partitions: { orders: 12, events: 24 } }),
    workers: workers('workers', { pods: ({ pods }) => pods, perPod: 8 }),
  },
  routes: { orders: ['topic', 'workers'], events: ['topic', 'workers'] },
})

checkout.evaluate({ load: 40 }).verdict.text
// "At 40×, the worker pool and API gateway are past capacity: messages wait in the topic and …"
```

The full example, with its view and tests, is in [`examples/checkout`](examples/checkout).

## Develop

```bash
nvm use && corepack enable pnpm && pnpm install
pnpm exec playwright install chromium   # once, for the browser tests
pnpm dev                                # the playground
pnpm check                              # typecheck, lint, tests, build
```

## Record a scenario

```bash
pnpm dev &   # or any page that calls expose(handle) from @loadmap/export
pnpm record 'http://localhost:5173/?example=alerts' --out alerts.gif --script ramp.json
```

`ramp.json` is `[{ "at": 0, "set": { "load": 5 } }, { "at": 3, "set": { "load": 30 } }]`; `--out` picks GIF, WebM,
MP4 or PNG. The clock is fixed, so the same options give the same file.

See `CLAUDE.md` for the conventions and `docs/` for the research and the lessons behind the design.
