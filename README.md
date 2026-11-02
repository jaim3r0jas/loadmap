# loadmap

Interactive capacity models for React. Declare the components of a system, the flows through it and the controls
that change it; loadmap draws the architecture with moving dots, ranks the components by when they run out, and
writes the verdict.

```
model (pure TS)          view (pure data)            React
params, flows,      →    nodes, clusters, pools,  →  <Loadmap model view />
components, stages       edges, flow colours          scenarios · diagram · verdict · headroom · compare · live · limits · controls
   │                        │
   ├─ limits, verdict       └─ ELK layout, no label collisions
   └─ fluid sim → dots ───────────────────────────→  canvas overlay · PNG / WebM export
```

## Install

```bash
npm i @loadmap/react react react-dom
```

`@loadmap/react` brings the model, the view and the components; [its README](packages/react/README.md) has a page
that works in a few minutes. `@loadmap/dsl` and `@loadmap/editor` add the `.loadmap` language and its editor,
`@loadmap/export` media, `@loadmap/cli` the `loadmap` command.

## A model

```ts
import { defineModel, estimated, fitLinear, measured, p, pass, queue, store, workers } from '@loadmap/react'

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

## Scenarios and headroom

A design review sets today beside a proposal. Scenarios are named parameter values (never the load); growth turns
load multiples into dates, counted from a fixed day so the page says the same thing tomorrow:

```ts
defineModel({
  // …
  scenarios: { Today: {}, Proposed: { gateways: 2, pods: 6 } },
  growth: { rate: 0.06, per: 'month', asOf: '2026-11-01' },
})

compare(checkout).text
// "Proposed buys more headroom: the 50 % target holds up to 20× (around March 2031), limited by the worker pool,
//  against 10× (around February 2030) in Today."
```

`<Loadmap>` shows a button per scenario, a headroom chart (utilization over the load multiple, one line per scenario,
its crossings exactly where the limits are) and the scenarios side by side. Hovering or focusing a box tells its
utilization, capacity and where it runs out. `compare()` and `headroom()` give the same numbers without React.

## Numbers you can defend

A capacity can say how sure it is. The limits then become ranges, ranked on the pessimistic edge, and a model can
promise headroom that a test or CI checks:

```ts
capacity: ({ gateways }) =>
  estimated(20_000 * gateways, 'req/s', { source: 'vendor benchmark, not load-tested', within: 0.3 }),
// …
expect: [{ label: 'Today keeps 7×', target: 7 }, { scenario: 'Proposed', target: 14 }],

checkout.evaluate({ load: 1 }).verdict.text
// "At 1×, every component is under the 50 % target. It holds up to between 7.4× and 10× (…); the API gateway is
//  the first limit (capacity estimated ±30 %)."
checkout.evaluate().measure?.text
// "Measuring the API gateway would change the answer: at its stated capacity, the worker pool is the first limit
//  and the 50 % target holds up to 10×."

it('keeps its headroom', () => assertHolds(checkout))   // throws, listing every failed expectation
```

The headroom chart draws a band per scenario. In a `.loadmap` it reads `estimated(20_000 ± 30%, …)` and
`expect "Today keeps 7×" { target: 7 }`; `loadmap check checkout.loadmap` exits 1 when one fails, with its line and
column, and writes GitHub annotations under Actions.

## Or as text

The same model and view can be written as a `.loadmap` definition and edited next to its live diagram (`pnpm dev`,
then the editor tab). `@loadmap/dsl` compiles it to what `<Loadmap>` takes:

```
loadmap 1
load "Users, × today" { max: 100; default: 10 }
param pods "Worker pods" { options: [2, 3, 4, 6]; default: 3 }

flow orders "orders" { rate: 40 * load; route: gateway -> workers; from: phones }

node phones "Phones"
node gateway "API gateway" {
  pass
  demand: flows.orders
  capacity: estimated(20_000, "req/s", "vendor benchmark")
  over: "clients get 429s"
}
pool workers "Workers" `${pods} pods × 8 threads` {
  workers { pods: pods; perPod: 8 }
  demand: flows.orders * 0.004
  capacity: measured(pods * 2, "cores", "pod CPU limit")
  over: "messages wait and the lag keeps growing"
}

phones -> gateway -> workers
```

Formulas are a small subset of TypeScript expressions, never `eval`, so a definition can be shared as a link. See
[`docs/dsl.md`](docs/dsl.md).

## Develop

```bash
nvm use && corepack enable pnpm && pnpm install
pnpm exec playwright install chromium   # once, for the browser tests
pnpm dev                                # the playground
pnpm check                              # typecheck, lint, tests, build, bundle budget
pnpm verify:pack                        # the tarballs in a fresh Vite app outside the monorepo
```

Releases use changesets with one version for every package; see [`.changeset/README.md`](.changeset/README.md).

## Record a scenario

A `.loadmap` records without a page of its own: `pnpm record examples/checkout/checkout.loadmap --out checkout.gif`.


```bash
pnpm dev &   # or any page that calls expose(handle) from @loadmap/export
pnpm record 'http://localhost:5173/?example=alerts' --out alerts.gif --script ramp.json
```

`ramp.json` is `[{ "at": 0, "set": { "load": 5 } }, { "at": 3, "scenario": "Proposed" }]`; `--out` picks GIF,
WebM, MP4, PNG or SVG. The clock is fixed, so the same options give the same file. Media can stand alone:

```bash
pnpm record 'http://localhost:5173/?example=checkout' --out checkout.gif --caption --script ramp.json
pnpm record 'http://localhost:5173/?example=checkout' --out poster.png --poster --scenario Proposed
```

`--caption` puts the title, scenario and load above the board and the verdict below it; `--poster` draws the board
with the verdict, where each component runs out and the scenarios compared.

See `CLAUDE.md` for the conventions and `docs/` for the research and the lessons behind the design.
