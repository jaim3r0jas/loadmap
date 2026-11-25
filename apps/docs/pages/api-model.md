# The model in TypeScript

A model written in TypeScript is one `defineModel({ … })` call from `@loadmap/core`, and its drawing one
`defineView(model, { … })`. `@loadmap/react` re-exports both, with every builder on this page, so most pages install
only react. Core has no dependencies and no DOM: a model runs in a Node test as it runs on a page. The same model
written as a `.loadmap` is in [the language guide](/language/); this page is its TypeScript side, field by field.

## defineModel

`defineModel(definition)` checks the definition and returns a `Model`. It throws a `loadmap: …` error that names
what is wrong: a parameter named after a reserved word, a select whose default is not an option, a route through an
unknown stage, a loop between model functions.

```ts
import { defineModel, estimated, measured, p, pass, queue, store, workers } from '@loadmap/core'

export const checkout = defineModel({
  title: 'Checkout pipeline',
  load: p.load({ label: 'Users, × today', max: 100, default: 10 }),
  params: {
    pods: p.select({ label: 'Worker pods', options: [2, 3, 4, 6], default: 3 }),
    threads: p.select({ label: 'Threads per pod', options: [4, 8, 16], default: 8 }),
  },
  flows: {
    orders: { label: 'orders', unit: 'order', rate: ({ load }) => 40 * load },
  },
  components: {
    gateway: {
      name: 'API gateway',
      short: 'the API gateway',
      capacity: estimated(20_000, 'req/s', { source: 'vendor benchmark', within: 0.3 }),
      over: 'clients get 429s',
    },
    workerPool: {
      name: 'Worker pool',
      demand: ({ flows }) => flows.orders * 0.01,
      capacity: ({ pods }) => measured(pods * 2, 'cores', 'pod CPU limit'),
      over: 'messages wait in the topic',
    },
    db: { name: 'Postgres primary', capacity: estimated(4_000, 'commits/s'), over: 'commits queue' },
  },
  stages: {
    gateway: pass('gateway'),
    topic: queue({ partitions: { orders: 12 } }),
    workerPool: workers('workerPool', { pods: ({ pods }) => pods, perPod: ({ threads }) => threads }),
    db: store('db'),
  },
  routes: { orders: ['gateway', 'topic', 'workerPool', 'db'] },
})
```

A test builds its model inline like this: a definition held in a variable first loses its literal types (the flow,
component and stage ids) and fails the typecheck.

| Field         | What                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `title`       | The model's name: the page's heading                                                                   |
| `load`        | The load, from `p.load(…)`: required, one per model                                                    |
| `params`      | The parameters a reader can change, by id: `p.select`, `p.switch`, `p.range`                           |
| `flows`       | What moves, by id: [Flows](#flows). Required                                                           |
| `components`  | What runs out, by id: [Components](#components). Required                                              |
| `stages`      | What the dots do on a route, by id: [Stages](#stages). Required                                        |
| `routes`      | Each flow's stages, in order: `{ orders: ['gateway', 'topic', 'workerPool', 'db'] }`. Required         |
| `connections` | How a stage reaches the next one, and through which part of it: [Connections](#connections)            |
| `delays`      | The time a hop takes whatever the load, `{ from?, to, delay, flows? }`: it adds to the latency         |
| `derived`     | Named formulas every model function can read as `derived.<name>`                                       |
| `presets`     | Named sets of values, the load included: buttons on the page                                           |
| `peaks`       | How long a preset's moment lasts, in seconds, by its label: `backlog()` says what it leaves      |
| `scenarios`   | Named designs to compare: the defaults plus these values, never the load. The first is the baseline    |
| `growth`      | How fast the load grows: `{ rate: 0.06, per: 'month', asOf: '2026-11-01' }` turns multiples into dates |
| `expect`      | What must keep holding: [Expectations](#expectations)                                                  |
| `story`       | A walk through the model, a step at a time: [A story](#a-story)                                        |
| `calibration` | Fits the model uses, by name, listed with the assumptions: `{ 'Worker CPU per request': workerCores }` |
| `snapshot`    | The measured data the model reads, as `parseSnapshot` returns it: each measurement goes in the list    |
| `thresholds`  | `{ target?, full? }`: the utilization of the target (default 0.5) and of "runs out" (default 1)        |
| `searchMax`   | The highest load multiple the limits search (default 2000); past it a component "never" runs out       |

## The load and the parameters

`p` builds the controls. The load is the multiple of today's load the slider sets: every crossing on the page is a
multiple of it. The other parameters are the design's choices; their ids are what model functions read
(`({ pods, threads }) => …`). `load`, `flows`, `at`, `demand`, `util` and `derived` are reserved and cannot name one.

| Builder                                                    | Option defaults                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `p.load({ label?, min?, max, step?, default? })`           | label `'Load, × today'`, min 1, step 1, default the min               |
| `p.select({ label, options, default, format?, … })`        | `default` must be one of `options` (numbers or strings), or it throws |
| `p.switch({ label, default, … })`                          | `default` is `true` or `false`                                        |
| `p.range({ label, min, max, step?, default, format?, … })` | step 1                                                                |

Every parameter but the load also takes `hint` (one line under the control), `tag` (a short word beside the label:
"estimate"), and `enabled`, which greys the control out while it returns false; the value is kept:

```ts
params: {
  batch: p.switch({ label: 'Batch DB writes', default: true }),
  rows: p.select({ label: 'Rows per batch', options: [10, 50], default: 50, enabled: ({ batch }) => batch }),
  hit: p.range({ label: 'Cache hits', min: 0, max: 1, step: 0.05, default: 0.9, format: (v) => `${v * 100} %` }),
},
```

`format` writes a select's or a range's value for the control. `Values<P>` is the type of every value at once, the load
included; `isEnabled(def, values)` says whether a control is on.

## Flows

A flow is what moves through the routes: requests, orders, events. Each has its own dots and colour.

| Field      | What                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `rate`     | Units per second where it enters: a number, or `({ load, … }) => number`. Required                               |
| `label`    | Its name on the page                                                                                             |
| `unit`     | One unit, singular: `'order'`                                                                                    |
| `priority` | 1 is served first; flows of the same priority share capacity                                                     |
| `overload` | What its backlog in a queue does: `{ drop?: { olderThan, reason? }, merge?: { share, reason? } }`, or a function |
| `retry`    | `{ times, budget?, at? }`, or a list of them: what fails is sent again; of the load and the parameters only      |
| `timeout`  | Seconds a client waits: a slower unit fails (and retries with `retry`); needs a `service` on its way             |
| `average`  | Its rate over a day against its peak, 0 to 1: what a [stock](#components) reads. Default 1                       |

`drop` drops units older than `olderThan` simulated seconds before they are handled. `merge` is keep-newest-per-key as a
share: under backlog, that share of what is handled leaves the queue without using capacity. Without a rule a backlog
waits.

`retry.times` is the retries after the first attempt, a whole number; `budget` caps what retries add, as a share of
the flow (0.1 adds at most 10 %). The attempts are what every stage on the route sees, so a retry changes every number
the model computes: that is why `retry` and `timeout` read only the load and the parameters. Retries are the one loop
the model solves (the least fixed point); any other loop between model functions is an error that names it.

```ts
flows: {
  searches: {
    label: 'searches',
    unit: 'search',
    rate: ({ load }) => 300 * load,
    retry: ({ retries, budget }) => ({ times: Number(retries), budget: budget ? 0.1 : 3 }),
    timeout: 0.5,
  },
  events: { rate: ({ load }) => 900 * load, priority: 2, overload: { drop: { olderThan: 60, reason: 'too_old' } } },
},
```

## Components

A component is what runs out: a gateway, a pool of workers, a database. Its utilization is its demand ÷ its capacity,
and the crossings are the load multiples where that reaches the target and 100 %.

| Field      | What                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| `name`     | Its name in the limits list. Required                                                                 |
| `capacity` | A [capacity](#capacities), or a function of the values that returns one. Required                     |
| `over`     | What happens past 100 %, as a clause: `'clients get 429s'`; may be a function. Required               |
| `short`    | The name inside a sentence, with its article: `'the database'`. Default: the name                     |
| `plural`   | `true` makes the verdict say "are past capacity"                                                      |
| `demand`   | In the capacity's unit. Without one: the units per second reaching the stages that use it             |
| `held`     | Seconds each unit holds one of its slots, for every flow or per flow: the demand is then slots in use |
| `through`  | `[from, to]`: a stretch of the way whose time a unit holds its slot for too, on top of `held`         |
| `fails`    | The share of the units its stages work on that fail there, whatever the load: lost as `failed`        |
| `on`       | The stages whose units hold its slots; by default the stages that use it                              |
| `service`  | Seconds a unit takes here when nothing waits: the flows through it get a latency                      |
| `fills`    | What a stock gains a second, in the capacity's unit, every flow at its `average`; no stage runs it    |
| `keeps`    | Seconds a stock keeps what it gains: it settles at fills × keeps                                      |
| `level`    | A capacity: where a stock that grows stands on `growth.asOf`; it grows from there as the load does    |
| `when`     | Leaves the component out (no utilization) while it returns false                                      |
| `describe` | One line under the name in the limits list; may be a function                                         |

`held` counts slots rather than a rate (a connection, a session, a request in flight): by Little's law, the demand is
the units per second reaching `on` times the seconds held, and the capacity counts slots.
`ev.components.<id>.held` gives each flow's time. `service` makes each stage the component runs a queue (M/M/1),
whose time grows as service ÷ (1 − utilization). `fills` makes a stock (a disk, a retention): with `keeps` its level
is fills × keeps, with `level` it is that level plus what it gained up to the day the load reaches the multiple, so it
needs `growth` to be ranked; `ev.components.<id>.stock` gives its `level`, `gains` and, for one that grows, `room`, the
seconds left at what it gains now:

```ts
components: {
  conns: {
    name: 'Postgres connections',
    held: 0.02,
    on: ['db'],
    capacity: configured(200, 'connections', 'pool size'),
    over: 'orders wait for a connection',
  },
  api: {
    name: 'Search API',
    demand: ({ at }) => at.api.searches * 0.001,
    capacity: ({ maxPods }) => measured(maxPods, 'cores', '1 core a pod'),
    service: 0.01,
    over: 'searches queue',
  },
},
```

### Capacities

Every capacity says where it came from: the verdict and the assumptions list show it. Never a bare number.

| Builder                            | What                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `measured(value, unit, source?)`   | Read off a dashboard or a load test                                      |
| `estimated(value, unit, source?)`  | A vendor's figure, a benchmark elsewhere or a guess: the verdict says so |
| `configured(value, unit, source?)` | A limit someone set, such as a rate limiter's: exact, so it takes no ±   |
| `published(component, config?)`    | The figure the catalog publishes for this configuration, or none         |

`measured` and `estimated` take the source as a string, or options `{ source?, within?, origin? }`. `within` is the ±
as a share, from 0 to below 1: `estimated(4_000, 'commits/s', { within: 0.3 })` is ± 30 %. With a ±, every crossing
becomes a range, and the ranking, the first limit, the presets, `compare()` and the expectations use its pessimistic
edge, every capacity at its low bound.

`published(kafka, { brokers: 3, replication: 3, acks: 'all', messageSize: '1 KB', producers: 4 })` takes the figure of
the run whose deciding conditions all match (the components come from `@loadmap/core/catalog`). A configuration no run
matches gets no number, is not ranked, and the verdict says why. `config` also takes `version`, `figure` (which figure
when several match) and `margin`, a share that lowers a best case: the capacity then ranges from (1 − margin) × the
figure up to it. [Published figures](/language/published/) has the catalog; the catalog stays off a page's first
load until the model needs it.

A capacity read from measured data comes from a snapshot reader:
`fromSnapshot(snapshot).capacity('gatewayCapacity', estimated(20_000, 'req/s', 'vendor benchmark'))` is the measured
value with where it came from, or the fallback marked with why there is none. The model's `snapshot` field lists
each measurement with the assumptions; [Snapshots](/api/more/#snapshots-loadmap-core-measure) has the file.

## Stages

A stage is what the dots do at a place on a route. Most take their component's id; numbers that may change with the
values (`partitions`, `pods`, `perPod`, `hit`, `to`) take a function of the context too (`Dyn`). Every stage takes
`label`, the name meters and cluster groups give it.

| Builder                                                                 | What                                                                   |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `pass(component, { label? })`                                           | Flows pass through; past capacity the share above 100 % is rejected    |
| `queue({ partitions, holds?, whenFull?, component?, label? })`          | Flows wait; the next stage on each route drains it at its own capacity |
| `workers(component, { pods \| autoscale, perPod, placement?, label? })` | A pool: pods × workers per pod                                         |
| `cache({ hit, component?, label? })`                                    | A share `hit` is answered here and goes no further                     |
| `limit(component, { label? })`                                          | A rate limiter: what it rejects is gone from every stage after it      |
| `store(component, { label? })`                                          | Where a flow ends: written to its component                            |
| `sink({ label? })`                                                      | Where a flow ends without a component: a receiver, a viewer, an app    |
| `fanout({ to, component?, label? })`                                    | Each unit copied to several sinks or stores, each with its share       |
| `gather({ to, needs?, hedge?, label? })`                                | Each unit makes several calls at once and goes on when `needs` answer  |
| `split({ to, component?, label? })`                                     | Each unit goes one of several ways, by share                           |
| `lost({ from, takes?, label? })`                                        | Where what other stages lose ends, counted                             |

**pass** and **limit** both turn away what is above 100 %. After a `pass`, the stages behind still count what was
offered ("as if what is in front kept up"); after a `limit`, the rate reaching them stops at the limit.

**queue** holds the partitions of each flow, drawn as cells: `queue({ partitions: { orders: 12, events: 24 } })`, or
`({ pods }) => ({ positions: pods * 16 })`. Its `component` (the brokers) is optional. With `holds` it is a queue with
a size: once its reader is past full, what the reader cannot take is turned away at the queue, or with `whenFull:
'block'` at the stage before it.

**workers** takes either `pods` or `autoscale`, never both. `placement: 'round-robin'` (the default) spreads busy
workers across pods; `'in-order'` fills pod 0 first. An autoscaled pool holds each running pod near `target`
utilization between `min` and `max` pods, and its capacity is the pool at `max`:

```ts
api: workers('api', { perPod: 4, autoscale: { min: 2, max: ({ maxPods }) => maxPods, target: 0.7 } }),
```

**cache**: `cache({ hit: ({ hit }) => hit, component: 'resultCache' })`. With a component, past capacity the share
above 100 % is rejected, as at a pass.

**fanout** is the last stage of a route. `to` is one list for every flow, or one per flow; a branch's `share` is the
expected copies per unit and may pass 1:

```ts
push: fanout({
  component: 'push',
  to: {
    alerts: [{ stage: 'contacts', share: 1 }, { stage: 'responders', share: 0.4 }],
    positions: [{ stage: 'watchers', share: 12 }],
  },
}),
```

**split** sends each unit one way: a read/write split, shards, regions, failover. A flow's shares add up to 1; a flow
it does not name goes straight on. A branch that ends in a store, a sink or a fan-out ends there; any other rejoins the
route after the split:

```ts
shards: split({ to: [{ stages: ['db'], share: 0.5 }, { stages: ['db2'], share: 0.5 }] }),
```

**lost** is on no route: `from` names the stages it takes from, `takes` which losses (`'rejected'`, `'dropped'`,
`'timedOut'`, `'failed'`; all of them without one). What reaches it is what is lost after every retry:
`lost({ from: ['limiter'], takes: ['rejected'] })`. Its box says how many per second.

[Building blocks](/language/building-blocks/) has what each one does to the numbers, with the language beside it.

## Connections

A connection says how a stage reaches the next one on a route, and through which part of it. It never changes a rate,
a demand or a capacity: it says how unevenly the work lands on the members of `to`, and the component of `to` runs out
when its busiest member does.

| Field         | What                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| `from`, `to`  | The stage in front and the stage whose members take the parts                                                |
| `assign`      | `'shared'` (the default), `'exclusive'`, `'key'` or `'leader'`                                               |
| `owner`       | What owns a part when `to` is a pool: `'worker'` (the default) or `'pod'`                                    |
| `capacityPer` | What the capacity divides over evenly: `'worker'` or `'pod'`; the owner by default, never finer              |
| `parts`       | The parts of each flow when `from` is not a queue: shards, slots, ranges                                     |
| `members`     | The members of `to` when it is not a pool                                                                    |
| `flows`       | The flows it covers; by default every flow going from `from` straight to `to`                                |
| `open`        | Connections each member of the pool on the hop keeps open to the other side                                  |
| `accepts`     | The most the other side accepts (`max_connections`), a capacity: a limit of its own, named by the connection |
| `skew`        | With `key`: the share of a flow on its hottest part, a capacity (measured or estimated)                      |
| `rule`        | A rule from the catalog, `rule(kafka, 'kafka/consumer-group')`: its assign and owner, and its source         |

`exclusive` deals the partitions of the queue in front to the members, one reader each (a consumer group); `key`
sends each unit to the part its key hashes to; `leader` sends everything to one member.

```ts
connections: {
  group: { from: 'topic', to: 'workerPool', assign: 'exclusive', capacityPer: 'pod' },
  dbPool: { from: 'api', to: 'db', owner: 'pod', open: 20, accepts: configured(100, 'connections', 'max_connections') },
},
```

`ev.components.workerPool.spread` then gives the factor and its line, and `ev.stages.workerPool.assignment` the worker
that reads each partition.

## The context

Every model function gets one object: the values (`load` and every parameter), and what the model worked out.

| Name      | What                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| `flows`   | Units per second of each flow where it enters; with retries, its attempts                                         |
| `at`      | `at.<stage>.<flow>`: units per second reaching a stage. Cache hits and a limiter's rejections are gone after them |
| `demand`  | Each component's demand, in its capacity's unit                                                                   |
| `util`    | Each component's demand ÷ capacity; null when it is switched off                                                  |
| `derived` | The model's `derived` formulas                                                                                    |

```ts
derived: { slow: ({ util }) => ((util.cache ?? 0) > 0.7 ? 2 : 1) },
```

## Scenarios, presets and growth

`scenarios` are the designs a review compares, by label: `{ Today: {}, Proposed: { gateways: 2, pods: 6 } }`. Each is
the defaults plus its values, never the load; the first is the baseline. The page switches between them, and
`compare()` and the headroom chart set them side by side.

`presets` are buttons that set values, the load included: `{ 'Black Friday': { load: 40, pods: 6 } }`. The evaluation's
`presets` adds "Today · 1×" before them and, after them, the load where the target and "runs out" are reached on the
pessimistic edge (`derived: true`).

`peaks` says how long a preset's moment lasts, by its label: `{ 'Black Friday': 7_200 }`. The preset then has its
`lasts`, and `backlog(model, values, seconds)` (from `@loadmap/core/backlog`) gives what that long at those values leaves in each queue whose reader
cannot keep up (`units`, and each flow's), with the seconds its reader then needs to clear it at the default load
(`empties`) and how long its oldest unit has waited (`lag`); a fourth argument, `'low'` or `'high'`, reads an edge of a ±. It follows the sim's rules: a reader drains at its component's `full`, serves priority 1 first, and a drop
or a merge leaves less.

`growth` is `{ rate, per: 'month' | 'year', asOf }`, compounded: 1× is the load on `asOf` (`'2026-11-01'` or
`'2026-11'`), and every period it is `1 + rate` times the last. Dates come from `asOf` alone, never from the clock, so
a page and its recordings say the same date on any day. `model.dateAt(multiple)` is when the load reaches it.

## Expectations

`expect` lists what must keep holding, on the pessimistic edge: `check()`, `assertHolds()` and `loadmap check` test it.

| Field         | What                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `label`       | Names it in a failure: `'Today keeps 7×'`                                                             |
| `scenario`    | The scenario whose values it checks; the defaults without one                                         |
| `component`   | One component; the first limit without one                                                            |
| `underTarget` | Every component (or this one) stays under the target utilization up to at least this multiple         |
| `notFull`     | Nothing (or this component) runs out before this multiple                                             |
| `lasts`       | Nothing (or this component) runs out for this many seconds from `growth.asOf`; needs growth           |
| `flow`        | With `p50`, `p95` or `p99` (seconds): the flow's latency stays under it, up to `underTarget` if given |
| `lost`        | A share: `flow` (or each flow) loses at most this for good, up to `underTarget` if given              |
| `to`          | With `flow`, and `lost` or a percentile: a stage on a fan-out branch; the branch is held, not the flow |
| `preset`      | A preset that lasts: with `lag` or `clears` (seconds), what its moment leaves in `queue` (or each one) |
| `severity`    | `'warn'` is reported but never fails a check run; default `'fail'`                                    |

```ts
expect: [
  { label: 'Today keeps 10×', underTarget: 10 },
  { label: 'Proposed keeps 20×', scenario: 'Proposed', underTarget: 20 },
  { label: 'Searches answer in 150 ms to 10×', flow: 'searches', p99: 0.15, underTarget: 10 },
  { label: 'Searches lose under 0.1 % to 5×', flow: 'searches', lost: 0.001, underTarget: 5 },
],
```

`target` and `full` are the old names of `underTarget` and `notFull`, still read; give one or the other.

## A story

`story` is a walk through the model, a step at a time: the page steps through it or plays it, and
`loadmap record --story` records it.

| Field      | What                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------- |
| `text`     | What to say. Required                                                                          |
| `title`    | The few words the diagram shows while the step plays. Default: what the step changes           |
| `scenario` | Start from a scenario's values; without one, from the defaults                                 |
| `set`      | Values on top, the load included                                                               |
| `focus`    | A component whose box is outlined                                                              |
| `closed`   | The subsystems drawn closed during the step (`[]` opens every one); without it, the page's own |
| `seconds`  | How long a recording holds it. Default 4                                                       |

Each step resolves to every value set (`model.story[i].values`), so a step looks the same whichever came before.

## The view

`defineView(model, { nodes, edges, flows, … })` says which boxes to draw and how the dots move between them. It throws
when a stage has no box, an edge names an unknown box, or a flow goes from one box to the next with no edge between
them (a dot moves only along an edge).

| Builder                                                         | What                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------- |
| `node({ label, sub?, stage?, component?, shape?, tier? })`      | A box; `shape: 'cylinder'` for a store               |
| `cluster({ label, sub?, stage, members, memberLabel?, tier? })` | Brokers holding the partitions of one or more queues |
| `pool({ label, sub?, stage, podLabel?, tier? })`                | A workers stage drawn as pods holding workers        |
| `edge(from, to, { label?, when? })`                             | An edge; `when` leaves it out while it returns false |

`label`, `sub` and an edge's `label` are text or a function of the context
(`({ pods }) => \`${pods} pods\``). A node shows a `stage` (its dots stop there and it takes its component's colour),
or names a `component` to colour by. A cluster's `stage` is one queue or several, partition i of each on member
i mod n; `members` may be a function of the values.

`flows` gives each flow the box its dots start from and a colour: `{ orders: { from: 'gateway', color: 'accent' } }`.
A colour is a theme token (`'accent'`, `'alt'`, `'ok'`, `'warn'`, `'drop'`, `'muted'`) or any CSS colour.

The rest of the view is optional:

| Field        | What                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `tiers`      | Bands across the flow, by id, in the order the flow meets them: `{ label, fill?, fillDark? }`; a box names its own with `tier` |
| `lanes`      | `'filled'` (the default: every lane filled, alternating two shades) or `'striped'`                                             |
| `layout`     | `'compact'` (the default) or `'stable'`                                                                                        |
| `subsystems` | Several boxes as one frame, by id: `{ eu: { label: 'EU region' }, 'eu.orders': { label: 'Orders' } }`                          |

`compact` lays out each phase (a scenario, a story step, a preset, a choice of a select or switch) on its own and moves
the boxes from one to the next; `stable` lays out every box at its largest anywhere the model reaches, so nothing but
the dots moves. The load never moves a box either way.

What a subsystem holds is named `<id>.<name>`, as in a definition's text: the box `eu.orders.topic` stands in
`eu.orders`, which stands in `eu`. Each is a frame around its boxes with its name; with tiers, a subsystem whose boxes
stand in several tiers has no frame (a frame cannot cross a lane). A subsystem can be drawn closed, as one box:
`<Loadmap closed={['eu']}>` and a story step's `closed` say which ([React and the page](/api/react/)).

`directionOf(view)` is the way a diagram runs when nothing holds it: right, unless its widest layer has more boxes than
its longest chain. `layout()` turns a view into a scene: [The layout](/api/more/#the-layout-loadmap-layout).

## The model object

`defineModel` returns a `Model`:

| Member                                                         | What                                                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `evaluate(values?)`                                            | Everything the page shows at these values (the defaults plus what you pass): an `Evaluation`             |
| `defaults()`                                                   | Every value at its default, the load included                                                            |
| `utilization(values?, bound?)`                                 | Each component's utilization, without the crossings; `bound` reads every capacity at `'low'` or `'high'` |
| `latency(values?, bound?, flows?)`                             | Each flow's latency, as `evaluate` gives it                                                              |
| `lost(values?, bound?, flows?)`                                | What each flow loses for good, as `evaluate` gives it                                                    |
| `branch(flow, to, values?, bound?)`                            | A fan-out branch up to a stage on it: its `stages`, what its copies `lost`, their `latency`              |
| `stagesAt(values?)`                                            | `values`, `ctx`, `stages` and `paths` alone: cheap to call for many values                               |
| `scenarioOf(values)`                                           | The scenario these values are (the load aside), or null                                                  |
| `dateAt(multiple)`                                             | When the load reaches it, from `growth`; null without growth, and at 1× or below                         |
| `isEnabled(id, values)`                                        | Whether a parameter's control is on                                                                      |
| `scenarios`, `story`, `expectations`                           | As declared, resolved: each scenario's and step's full values                                            |
| `params`, `load`, `thresholds`, `searchMax`, `growth`, `title` | The definition, with its defaults filled in                                                              |
| `flowIds`, `componentIds`, `stageIds`                          | The ids, in declaration order                                                                            |

## The evaluation

`model.evaluate(values)` returns an `Evaluation`: everything the page draws, for one set of values.

| Field         | What                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `values`      | Every value, defaults filled in                                                                            |
| `verdict`     | `{ tier: 'ok' \| 'warn' \| 'over', text }`: the sentence at the top of the page                            |
| `components`  | Each component's result, by id (below)                                                                     |
| `ranked`      | The components in the order they reach the target, on the pessimistic edge                                 |
| `firstLimit`  | The component that reaches the target first; null when none does                                           |
| `firstFull`   | The component that reaches 100 % first                                                                     |
| `target`      | Where the first limit reaches the target: `{ low, high }`, every capacity at its low and at its high bound |
| `full`        | Where the first component reaches 100 %, the same way                                                      |
| `measure`     | The capacity worth measuring: `{ component, target, firstLimit, text }`; null when the range is narrow     |
| `presets`     | The presets as buttons: `{ label, values, derived }`                                                       |
| `assumptions` | Every capacity, fit, measurement and connection the answer rests on, with where it came from               |
| `flows`       | Units per second of each flow where it enters (with retries, its attempts)                                 |
| `at`          | `at[stage][flow]`: units per second reaching each stage                                                    |
| `stages`      | Each stage worked out for these values (below)                                                             |
| `routes`      | Each flow's route                                                                                          |
| `paths`       | Each flow's ways through, `{ stages, share }`: its route once per branch of every split on it              |
| `overload`    | Each flow's overload rules at these values                                                                 |
| `retry`       | Each retrying flow's `{ times, rate, attempts, rejected, retried, failed }`, and its `hops` by stage       |
| `latency`     | Each flow's time through, or null where no stage on it has a `service`                                     |
| `lost`        | What each flow loses for good: `{ rate, share, causes }`, after every retry and its fallback               |
| `ctx`         | The context model functions saw: for labels and other view callbacks                                       |

A component's result (`ev.components.db`):

| Field                                               | What                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `util`, `demand`, `capacity`                        | At these values; null when switched off. `util` includes a connection's spread       |
| `state`                                             | `'off'`, `'ok'`, `'warn'` (past the target) or `'over'` (past 100 %)                 |
| `target`, `full`                                    | The load multiples where it reaches the target and 100 %; `Infinity` when never      |
| `targetRange`, `fullRange`                          | The same as `{ low, high }`, every capacity at its low and at its high bound         |
| `spread`                                            | `{ factor, text }`, when a connection lands the work unevenly or leaves members idle |
| `held`                                              | For a component that counts slots: the seconds a unit of each flow holds one         |
| `missing`                                           | Why it has no published figure for this configuration: it is then not ranked         |
| `id`, `name`, `short`, `plural`, `over`, `describe` | As declared, functions resolved                                                      |

A stage's result (`ev.stages.workerPool`) has its `id`, `label`, `kind` and `component`, and per kind:

| Kind              | Fields                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `pass`, `limit`   | `rejects` (the share of what is offered above capacity), `shed` (of what reaches it)                  |
| `cache`           | `hit`, `rejects`, `shed`                                                                              |
| `queue`           | `partitions` per flow; `skew`, the hottest partition's share, with a `key` connection; `holds`        |
| `workers`         | `pods` (drawn: an autoscaled pool's max), `running`, `perPod`, `placement`, `autoscale`, `assignment` |
| `fanout`, `split` | `to` per flow, `rejects`, `shed`                                                                      |
| `gather`          | `to` per flow, `needs`, and `failing`: the share of each flow's units that fail there                 |
| `lost`            | `from`, `takes`                                                                                       |

A pool's `assignment`, with an exclusive connection into it, is `{ owner, cells, from, weights }`: per flow, the worker
(pod × workers per pod + its place in the pod) that reads each partition, the queue they come from, and each running
worker's share of the work.

A flow's `latency` is `{ mean, p50, p95, p99 }` in seconds (`Infinity` once a stage on a way is past full), with
`unknown` (components on its way whose time is not known), and with a timeout `timedOut` (the share slower than it)
and `ways` (the same per path).

A flow's `lost` is what it loses for good: `rate` in units a second, `share` of what it sends before retries, and
`causes`, each stage's part as `{ stage, loss, rate }` with `loss` one of `'rejected'`, `'dropped'`, `'timedOut'` and `'failed'`.
What a breaker fails fast has no `stage`. With a fallback, what it serves is not lost, and what its own stages turn
away is.

## Checks, comparisons and headroom

| Function                                         | What                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `check(model, expectations?)`                    | Tests the model's `expect` lines (or these) on the pessimistic edge: `CheckResult[]` |
| `assertHolds(model, expectations?)`              | Throws one error listing every expectation that does not pass: for a test            |
| `compare(model, load?)`                          | The scenarios side by side at a load (default: the load's default): `Comparison`     |
| `headroom(model, values?, { samples? })`         | Utilization over the load multiple, per scenario: what the headroom chart draws      |
| `outages(model, values?)`                        | N−1 from `@loadmap/core/outages`: with one part of each domain out, the first limit  |
| `compareDefinitions(base, head, { tolerance? })` | What a change of the model does to its limits (`loadmap check --base`)               |

```ts
import { assertHolds, check } from '@loadmap/core'
import { expect, test } from 'vitest'
import { checkout } from './model'

test('the design keeps its headroom', () => assertHolds(checkout))

test('each expectation, with why', () => {
  for (const r of check(checkout)) expect(r.outcome, r.message).toBe('pass')
})
```

A `CheckResult` is `{ expectation, ok, outcome, reasons, target, full, message }`. `outcome` is `'pass'`, `'fail'` or
`'inconclusive'`: inconclusive when the answer rests on data that is not there (a measurement missing or too thin, no
published benchmark), or when it holds at the high edge of a ± but not at the low one; `reasons` lists why. `ok` is
true only for a pass. `target` and `full` are where the crossings were found, as ranges; `message` is one sentence.
The severity is the expectation's own (`r.expectation.severity`): `loadmap check` reports a `'warn'` without failing.

A `Comparison` is `{ rows, best, text }`. Each row is one scenario in declaration order (the first is the baseline):
`label`, `values`, `firstLimit`, `firstFull`, `target` and `full` on the pessimistic edge with `targetDate` and
`fullDate` from growth, `targetRange`, `fullRange`, `verdict`, and `components`, each with its `change`: its target
multiple ÷ the baseline's (2 is twice the headroom). `best` is the scenario whose target holds longest (then: runs out
last), null with fewer than two or a tie; `text` says which buys more headroom.

A `Headroom` is `{ from, to, load, lines }`: the x axis, the shown values' load, and one line per scenario (plus the
shown values, first, when they match none). A line has `label`, `selected`, `envelope` (the highest utilization of any
component at each load, as `[multiple, utilization]` pairs), `target` and `full` (the exact crossings), `band` (the
envelope at the low and the high bounds; null without a ±), `targetRange`, `fullRange` and each component's own line.

A `DefinitionChange` is `{ base, head, components, triggers, text }`: each side's first limit and crossings at its
defaults, each component's `change` (head ÷ base headroom: 0.8 lost a fifth), and the triggers that fail it. It fails
when the first limit loses more headroom than `tolerance` (`{ share: 0.1 }` by default, or `{ times: 0.5 }` in load
multiples), when the first limit moves to a component with less headroom, or when a component crosses the target or
100 % from below at today's load.

## Also exported

`rule(component, id)` gives a catalog component's connection rule, for a connection's `rule` (see
[Connections](#connections)). The number formats the verdict uses (`fmt`, `compact`, `pct`, `secs`, `multiple`)
are on [Media, simulation and layout](/api/more/#number-formats-loadmap-core-format), and `fitLinear` with
[the fits](/api/more/#fits-loadmap-core-calibrate). The other helpers the package exports (`dyn`, `boundOf`,
`crossing`, `reach`, …) are what the verdict is made of and may change between versions.
