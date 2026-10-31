# The .loadmap language

A `.loadmap` file defines a whole loadmap as text: the load and the controls, the flows and their routes, the boxes
of the diagram with what each one does and what can run out. `@loadmap/dsl` reads it into the same `model` and
`view` that `defineModel` and `topology` build in TypeScript, so `<Loadmap>` draws it the same way. The editor
(`@loadmap/editor`, the playground's Editor tab) shows it live as you type.

```
loadmap 1
title: "Photo uploads"

load "Uploads, × today" { max: 50; default: 5 }
param pods "Resizer pods" { options: [2, 4, 8]; default: 4 }

flow photos "photos" {
  rate: 20 * load
  route: api -> resizers
  from: phones
}

node phones "Phones"

node api "API" {
  pass
  demand: flows.photos
  capacity: estimated(1_500, "req/s", "vendor benchmark")
  over: "uploads fail with 503s"
}

pool resizers "Resizers" `${pods} pods × 4 threads` {
  workers { pods: pods; perPod: 4 }
  demand: flows.photos * 0.03
  capacity: measured(pods * 2, "cores", "pod CPU limit")
  over: "photos wait and the lag grows"
}

phones -> api: "POST /photos"
api -> resizers
```

`examples/checkout/checkout.loadmap` and `examples/alerts/alerts.loadmap` are the two examples written this way. Their
tests check that each draws exactly what its TypeScript draws.

## How it reads

- **The first line is the version:** `loadmap 1`. A file written for a newer version says so instead of half working.
- **A statement with an id starts with its keyword:** `param pods "Worker pods" { … }`. The words after the keyword
  are its id and its label (and for a box, the line under it).
- **A property is `key: value`**, one per line or separated by `;`.
- **An edge is `a -> b`**, with an optional label after `:`.
- **`#` starts a comment.**

### Boxes, stages and components

A **box** (`node`, `cluster`, `pool`) is what the diagram shows. Two more things can live in a box:

- **A stage:** what the dots do there. Write it as a statement inside the box: `pass`, `store`, `sink` or `fanout` in
  a node, one or more `queue` in a cluster, one `workers` in a pool. Its id is the box's id unless you give it one.
  A label after the keyword names it in the meters: `pass "the gateway"`.
- **A component:** what can run out. Write its lines on the box: `demand`, `capacity`, `over`, and optionally
  `name`, `short`, `plural`, `describe` and `when`. Its id is the box's id and its name is the box's label. A stage in
  the box uses this component unless it names another one with `component: …`. A component without a box is a
  top-level `component id "Name" { … }`.

A route lists stages: `route: gateway -> topic -> workers`. It may also name a box that runs exactly one stage.

### Formulas

Every value is a formula: a small subset of TypeScript expressions, so a lambda body from a TypeScript model pastes
as it is.

- **Literals:** numbers (`20_000`), `"texts"`, `true`, `false`, and templates (`` `${pods} pods` ``).
- **Operators:** `+ - * / %`, `< <= > >= == != === !==`, `&& || !`, `? :` and parentheses.
- **Names:**
  - `load` and the parameters by their id;
  - `let` names;
  - `flows.x`, `demand.x`, `util.x` and `derived.x` for the model's tables;
  - `i` inside `memberLabel` and `podLabel`, and `value` inside `format`.
- **Calls:** the built-in functions (listed at the end), the fits by their id, and the functions a host page provides.
- **Capacities** come only from `measured(value, unit, source)` or `estimated(value, unit, source)`. A bare number is
  an error, so every capacity says where it came from.

Some properties must be constants (a `priority`, a `unit`). Others may read only the parameters (`enabled`).

**Formulas are safe to share.** The text is parsed into a tree and run as closures. There is no `eval` or
`new Function`, no global name, no property but the four tables, and caps on size and depth. Counts that size the
drawing are capped too: at most 64 members, 256 pods, 256 workers a pod and 1,024 partitions a flow.

### Scenarios and growth

A **scenario** is a design to compare: the defaults plus some parameter values, never the load. The first one is the
baseline the others are measured against, so name today's design first:

```
scenario "Today" {}
scenario "Proposed" { gateways: 2; pods: 6 }
growth { rate: 0.06; per: month; asOf: "2026-11-01" }
```

The page shows a button per scenario above the diagram, a table of where each one first runs out, and a headroom
chart with one line per scenario. **Growth** turns load multiples into dates: the load is 1× on `asOf` and grows by
`rate` every `per`, compounded, so 10× at 6 % a month is about 40 months later ("around February 2030"). Dates come
from `asOf` alone, never from today's date, so a page and its recordings say the same thing on any day.

A share link carries the scenarios in the text and the shown one in its values (`&gateways=2&pods=6`), so it opens
with that scenario's button pressed.

### What stays code

A host page can give formulas more functions:

```ts
compile(source, { functions: { headroom: (x: number) => x * 1.2 } })
```

A shared link opened where those functions are missing reports which one it needs. Anything beyond formulas stays in
the TypeScript API, which reads the same.

## Errors

Every error has a line and a column, and parsing goes on after one, so a file shows all its problems at once. Names
that are almost right get a suggestion:

```
checkout.loadmap:73:17 error: unknown flow "order"
  73 |   demand: flows.order + flows.events
     |                 ^^^^^ did you mean "orders"?
```

`compile` also runs the model at its defaults, at every preset and in every scenario. A formula that fails there,
such as a loop between two `let`s, is marked where it is written.

## In code

```ts
import { compile, formatDiagnostic } from '@loadmap/dsl'

const r = compile(source)
if (!r.ok) for (const d of r.diagnostics) console.error(formatDiagnostic(d, source, 'my.loadmap'))
const { model, view, options } = r.definition!
// <Loadmap model={model} view={view} {...options} />
```

`completions(source, offset)` lists what may be typed at a place. `encodeShare` and `decodeShare` write and read share
links: `#v1.` followed by the text deflated and base64url-encoded, then the values that differ from the defaults
(`&load=30`). The link carries everything, so nothing goes to a server.

## Reference

<!-- reference: written by reference() in packages/dsl; UPDATE_DOCS=1 pnpm test:node rewrites it -->

### The top level

A loadmap definition.

| Property | Value | |
| --- | --- | --- |
| `title` | string, constant | The heading above the diagram. |
| `layout` | `right` \| `down` | Which way the diagram runs. Narrow screens always run down. |
| `speed` | number, constant | Simulated seconds per real second. Default 10. |
| `assume` | string, constant | A line added before the generated assumptions. |
| `searchMax` | number, constant | The highest load multiple the limits search. Default 2000. |

Holds: `load`, `param`, `preset`, `scenario`, `growth`, `let`, `fit`, `flow`, `component`, `node`, `cluster`, `pool`, `thresholds`.

Holds edges: `a -> b`, `a -> b: label`, `a -> b { label: …; when: … }`.

### loadmap

The first line: the version of the language this definition is written in.

```
loadmap 1
```

After the keyword: version.

### load

The load, as a multiple of today. It drives the limits.

```
load "Users, × today" { max: 100; default: 10 }
```

After the keyword: [label].

| Property | Value | |
| --- | --- | --- |
| `min` | number, constant | The lowest multiple. Default 1. |
| `max` (required) | number, constant | The highest multiple on the slider. |
| `step` | number, constant | The slider step. Default 1. |
| `default` | number, constant | Where the slider starts. Default the minimum. |

### param

A control: options make a select, min and max a slider, a true or false default a switch.

```
param pods "Worker pods" { options: [2, 3, 4, 6]; default: 3 }
```

After the keyword: id [label].

| Property | Value | |
| --- | --- | --- |
| `options` | options, constant | The choices of a select: [2, 3, 4] or ["a", "b"]. |
| `min` | number, constant | The lowest value of a slider. |
| `max` | number, constant | The highest value of a slider. |
| `step` | number, constant | The step of a slider. Default 1. |
| `default` (required) | value, constant | The starting value. |
| `hint` | string, constant | One line under the control. |
| `tag` | string, constant | A short tag next to the label, e.g. "estimate". |
| `enabled` | boolean, formula of parameters | Greys the control out while this is false; it reads only parameters. |
| `format` | string, formula of `value` | How a value is shown, from `value`: `${value} pods`. |

### preset

A named set of values, offered as a button.

```
preset "Black Friday" { load: 40; pods: 6 }
```

After the keyword: label.

Its properties are named by parameters (and `load`).

### scenario

A named design to compare: the defaults plus these values, never the load. The first is the baseline.

```
scenario "Proposed" { pods: 6; gateways: 2 }
```

After the keyword: label.

Its properties are named by parameters (not `load`).

### growth

How fast the load grows, compounded from asOf, where it is 1×: load multiples become dates.

```
growth { rate: 0.06; per: month; asOf: "2026-11-01" }
```

| Property | Value | |
| --- | --- | --- |
| `rate` (required) | number, constant | Growth per period, as a share: 0.06 is 6 %. |
| `per` (required) | `month` \| `year` | month or year. |
| `asOf` (required) | string, constant | The day the load is 1×: "2026-11-01". |

### let

A named formula other formulas can use by its name.

```
let perPosition = watchOnly ? 0.3 : 1.2
```

After the keyword: id = formula.

### fit

cost = a + b × x, fitted from measured points. Call it like a function: workerCores(rate).

```
fit workerCores "Worker CPU per request" { source: "load test"; points rate cores { 200 0.26 } }
```

After the keyword: id [label].

| Property | Value | |
| --- | --- | --- |
| `source` | string, constant | Where the points came from. |
| `through` | `origin` | origin: a cost with no idle part (a = 0). |

Holds: `points`.

### points

The measured points of a fit: the names of x and y, then one "x y" row per line.

```
points rate cores {
  200 0.2599
  350 0.3061
}
```

After the keyword: x y.

### flow

Something that moves through the system, with its rate and its route.

```
flow orders "orders" { unit: "order"; rate: 40 * load; route: gateway -> topic -> workers }
```

After the keyword: id [label].

| Property | Value | |
| --- | --- | --- |
| `unit` | string, constant | One unit of the flow, singular: "order". |
| `rate` (required) | number, formula | Units per second. |
| `priority` | number, constant | 1 is served first. Flows of the same priority share. |
| `route` (required) | route, constant | The stages it passes, in order: a -> b -> c. |
| `from` (required) | node, constant | The node its dots start from. |
| `color` | `accent` \| `alt` \| `ok` \| `warn` \| `drop` \| `muted` | A theme colour (accent, alt, ok, warn, drop, muted) or a CSS colour in quotes. |

Holds: `drop`, `merge`.

### drop

Units older than olderThan simulated seconds are dropped before they are handled.

```
drop { olderThan: 60; reason: "too old" }
```

| Property | Value | |
| --- | --- | --- |
| `olderThan` (required) | number, formula | Seconds. |
| `reason` | string, formula | Shown with the drop meter. |
| `when` | boolean, formula | The rule applies only while this is true. |

### merge

Under backlog, this share of what is handled is superseded by a newer unit: keep the newest per key.

```
merge { share: 0.37; reason: "newest kept" }
```

| Property | Value | |
| --- | --- | --- |
| `share` (required) | number, formula | The share superseded, 0 to 1. |
| `reason` | string, formula | Shown with the meter. |
| `when` | boolean, formula | The rule applies only while this is true. |

### component

Something that can run out: its demand against its capacity. On a box, write these lines on the box.

```
component cache "Cache" { demand: flows.reads; capacity: estimated(9000, "req/s") }
```

After the keyword: [id] [label].

| Property | Value | |
| --- | --- | --- |
| `name` | string, constant | The component's name in the limits list. Defaults to the label. |
| `short` | string, constant | The name inside a sentence, with its article: "the database". |
| `plural` | boolean, constant | "are past capacity" instead of "is". |
| `demand` | number, formula | What the component must handle, in its capacity's unit. |
| `capacity` | capacity, formula | What it can handle: measured(value, unit, source) or estimated(value, unit, source). |
| `when` | boolean, formula | The component is switched off (no utilization) while this is false. |
| `over` | string, formula | What happens past 100 %, as a clause: "clients get 429s". |
| `describe` | string, formula | One line under the name in the limits list. |

### node

A box. It may run a stage (pass, store, sink, fanout) and own a component (demand and capacity lines).

```
node gateway "API gateway" { pass; demand: flows.orders; capacity: estimated(20000, "req/s") }
```

After the keyword: id [label] [sub].

| Property | Value | |
| --- | --- | --- |
| `sub` | string, formula | The second line of the box. |
| `shape` | `box` \| `cylinder` | box (the default) or cylinder. |
| `name` | string, constant | The component's name in the limits list. Defaults to the label. |
| `short` | string, constant | The name inside a sentence, with its article: "the database". |
| `plural` | boolean, constant | "are past capacity" instead of "is". |
| `demand` | number, formula | What the component must handle, in its capacity's unit. |
| `capacity` | capacity, formula | What it can handle: measured(value, unit, source) or estimated(value, unit, source). |
| `when` | boolean, formula | The component is switched off (no utilization) while this is false. |
| `over` | string, formula | What happens past 100 %, as a clause: "clients get 429s". |
| `describe` | string, formula | One line under the name in the limits list. |

Holds: `pass`, `store`, `sink`, `fanout`, `component`.

### cluster

Members (brokers) holding the partitions of one or more queues (topics).

```
cluster kafka "Kafka" { members: 3; queue topic { partitions { orders: 12 } } }
```

After the keyword: id [label] [sub].

| Property | Value | |
| --- | --- | --- |
| `sub` | string, formula | The second line of the box. |
| `members` (required) | number, formula | How many members. |
| `memberLabel` | string, formula of `i` | Each member's label, from its index i: `broker ${i}`. |
| `name` | string, constant | The component's name in the limits list. Defaults to the label. |
| `short` | string, constant | The name inside a sentence, with its article: "the database". |
| `plural` | boolean, constant | "are past capacity" instead of "is". |
| `demand` | number, formula | What the component must handle, in its capacity's unit. |
| `capacity` | capacity, formula | What it can handle: measured(value, unit, source) or estimated(value, unit, source). |
| `when` | boolean, formula | The component is switched off (no utilization) while this is false. |
| `over` | string, formula | What happens past 100 %, as a clause: "clients get 429s". |
| `describe` | string, formula | One line under the name in the limits list. |

Holds: `queue`, `component`.

### pool

A workers stage drawn as pods holding a grid of workers.

```
pool workers "Workers" { workers { pods: pods; perPod: 8 } }
```

After the keyword: id [label] [sub].

| Property | Value | |
| --- | --- | --- |
| `sub` | string, formula | The second line of the box. |
| `podLabel` | string, formula of `i` | Each pod's label, from its index i: `pod ${i}`. |
| `name` | string, constant | The component's name in the limits list. Defaults to the label. |
| `short` | string, constant | The name inside a sentence, with its article: "the database". |
| `plural` | boolean, constant | "are past capacity" instead of "is". |
| `demand` | number, formula | What the component must handle, in its capacity's unit. |
| `capacity` | capacity, formula | What it can handle: measured(value, unit, source) or estimated(value, unit, source). |
| `when` | boolean, formula | The component is switched off (no utilization) while this is false. |
| `over` | string, formula | What happens past 100 %, as a clause: "clients get 429s". |
| `describe` | string, formula | One line under the name in the limits list. |

Holds: `workers`, `component`.

### pass

Flows pass through; past capacity the share above 100 % is rejected.

```
pass "the gateway"
```

After the keyword: [id] [label].

| Property | Value | |
| --- | --- | --- |
| `component` | component, constant | The component whose capacity this stage uses. Defaults to its box's component. |

### store

Where a flow ends: written to its component.

```
store
```

After the keyword: [id] [label].

| Property | Value | |
| --- | --- | --- |
| `component` | component, constant | The component whose capacity this stage uses. Defaults to its box's component. |

### sink

Where a flow ends without a component: a receiver, a viewer.

```
sink "contacts"
```

After the keyword: [id] [label].

### queue

Flows wait here; the next stage of each route drains it.

```
queue topic "orders topic" { partitions { orders: 12 } }
```

After the keyword: [id] [label].

| Property | Value | |
| --- | --- | --- |
| `component` | component, constant | The component whose capacity this stage uses. Defaults to its box's component. |

Holds: `partitions`.

### partitions

Partitions per flow, drawn as cells across the members.

```
partitions { orders: 12; events: 24 }
```

Its properties are named by flows.

### workers

A pool of workers: pods × workers per pod.

```
workers { pods: pods; perPod: 8 }
```

After the keyword: [id] [label].

| Property | Value | |
| --- | --- | --- |
| `pods` (required) | number, formula | How many pods. |
| `perPod` (required) | number, formula | Workers per pod. |
| `fill` | `round-robin` \| `in-order` | round-robin spreads work across pods (the default); in-order fills pod 0 first. |
| `component` | component, constant | The component whose capacity this stage uses. Defaults to its box's component. |

### fanout

Each unit is copied to several stages; one "flow -> stage: copies" line per branch. Last on a route.

```
fanout "push broker" {
  alerts -> contacts: 1
}
```

After the keyword: [id] [label].

| Property | Value | |
| --- | --- | --- |
| `component` | component, constant | The component whose capacity this stage uses. Defaults to its box's component. |

Holds branches: `flow -> stage: copies per unit`.

### thresholds

The utilization of the target and of "runs out".

```
thresholds { target: 0.5; full: 1 }
```

| Property | Value | |
| --- | --- | --- |
| `target` | number, constant | Default 0.5. |
| `full` | number, constant | Default 1. |

### Edges

A line between two nodes: `a -> b`, a chain `a -> b -> c`, or with a label `a -> b: "…"`.

| Property | Value | |
| --- | --- | --- |
| `label` | string, formula | The text on the edge. |
| `when` | boolean, formula | The edge is left out while this is false. |

### Functions

`min`, `max`, `round`, `floor`, `ceil`, `abs`, `sqrt`, `log`, `exp`, `pow`, `fmt`, `kfmt`, `pct`, `secs`, `measured`, `estimated`

<!-- end of reference -->
