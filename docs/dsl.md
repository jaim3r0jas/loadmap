# The .loadmap language

A `.loadmap` file defines a whole loadmap as text: the load and the controls, the flows and their routes, the boxes
of the diagram with what each one does and what can run out. `@loadmap/dsl` reads it into the same `model` and
`view` that `defineModel` and `defineView` build in TypeScript, so `<Loadmap>` draws it the same way. The editor
(`@loadmap/editor`, and the docs site's editor) shows it live as you type.

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

- **A stage:** what the dots do there. Write it as a statement inside the box: `pass`, `store`, `sink`, `fanout`,
  `cache` or `limit` in a node, one or more `queue` in a cluster, one `workers` in a pool. Its id is the box's id unless you give it one.
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
  - `flows.x`, `at.stage.x`, `demand.x`, `util.x` and `derived.x` for the model's tables (`at.stage` alone is every
    flow reaching that stage);
  - `i` inside `memberLabel` and `podLabel`, and `value` inside `format`.
- **Calls:** the built-in functions (listed at the end), the fits by their id, and the functions a host page provides.
- **Capacities** come only from `measured(value, unit, source)`, `estimated(value, unit, source)` or, for a limit
  someone set, `configured(value, unit, source)`. A bare number is an error, so every capacity says where it came
  from.

Some properties must be constants (a `priority`, a `unit`). Others may read only the parameters (`enabled`).

**Formulas are safe to share.** The text is parsed into a tree and run as closures. There is no `eval` or
`new Function`, no global name, no property but the five tables, and caps on size and depth. Counts that size the
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

### How sure, and what must hold

A capacity says how sure it is with a `±` in its value, as a share (`30%`) or in its unit (`± 1`). `+/-` is the same
for a keyboard without `±`:

```
capacity: estimated(20_000 * gateways ± 30%, "req/s", "vendor benchmark, not load-tested")
capacity: measured(pods * 2 +/- 5%, "cores", "pod CPU limit")
```

Every crossing is then also found with each capacity at its low bound and at its high bound, and the limits become
ranges: "the 50 % target holds up to between 7.4× and 10×". The ranking, the first limit and the presets use the
pessimistic edge (every capacity low), where it may already happen. The headroom chart draws each scenario as a band
with a bracket where it crosses the target and 100 %, and when the range is wide, a line under the verdict names the
capacity whose measurement would change or narrow the answer most. Fits stay exact.

An **expect** line is something that must keep holding, as minimum load multiples on that pessimistic edge:

```
expect "Today keeps 7×" { target: 7 }
expect "Proposed keeps 14×" { scenario: Proposed; target: 14 }
expect { component: db; full: 100 }
```

`target` is where the 50 % target is reached (by the first limit, or by `component`), `full` where 100 % is; without
a `scenario` the defaults are checked. The editor marks a failing expectation as a warning on its line and still
draws the diagram. `loadmap check` fails on it, so a change that loses headroom cannot land unseen:

```bash
loadmap check examples/checkout/checkout.loadmap      # exits 1 when an expectation fails or the file has an error
```

```
checkout.loadmap:26:1 error: "Today keeps 8×" fails: expected at least 8×, but the 50 % target holds up to between 7.4× and 10×, limited by the API gateway (capacity estimated ±30 %)
  26 | expect "Today keeps 8×" { target: 8 }
     | ^^^^^^^^^^^^^^^^^^^^^^^
checkout.loadmap: 1 of 2 expectations failed
```

Under GitHub Actions (or with `--format github`) each problem is also written as an annotation, so it shows on its
line in the pull request.

### Building blocks

Four shapes of real systems have statements of their own, so a model says what they do instead of working it out in
formulas. Each has a template to start from.

**What reaches a stage.** `at.db.reads` is the rate of `reads` reaching the stage `db`, and `at.db` every flow's. It
is the flow's rate, less what a cache answered and what a rate limiter turned away before it; an overloaded `pass`
does not cut it, so each component's limit stays the one it has if what is in front keeps up. A component without a
`demand` line handles what reaches its stages, in units per second:

```
node db "Database" {
  store
  capacity: estimated(3_000 ± 30%, "queries/s")   # no demand: the misses the cache lets through
  over: "queries queue on the primary"
}
```

**A cache** answers a share of the units and sends them back where they came from; the rest carry on. With capacity
lines it is a component too, and past capacity it rejects like a `pass`:

```
node cache "Cache" {
  cache { hit: hit }
  capacity: estimated(50_000, "ops/s")
  over: "lookups time out and fall through"
}
```

**An autoscaled pool** adds pods while the running ones are above `target`, between `min` and `max`. Its capacity is
the pool at `max` pods, so it runs out where it cannot grow further; the box draws every pod it may run and dashes
the ones it does not run now, and a meter counts them:

```
pool api "API" {
  workers { perPod: 4; autoscale { min: 2; max: maxPods; target: 0.7 } }
  demand: flows.requests * 0.005
  capacity: measured(maxPods * 1, "cores", "1 core a pod, at most pods")
  over: "the pool is at its maximum and requests queue"
}
```

**A rate limiter** is a `limit` stage. Its capacity is the limit, `configured(…)`: a number someone set, exact, so it
takes no `±`. Above it the share over is turned away ("17 % rejected at the limiter"), and the stages after it see
only what got through, so the service behind a limit may never run out.

**Retries** send a unit turned away on its route (by a `pass`, `limit` or `cache` past capacity) again, up to `times`
more times. A `budget` caps the extra attempts at that share of the flow. A retry rule reads only the load and the
parameters: retries change every other number, so they cannot depend on one.

```
flow requests "requests" {
  rate: 1_000 * load
  retry { times: 3; budget: 0.1 }
  route: gateway -> service
  from: clients
}
```

The attempts and the rejections depend on each other, so loadmap solves for where they agree: with `n` retries
against a bottleneck of capacity `C`, each attempt fails with share `p = (1 − C/λ)^(1/(n+1))` and the attempts are
`C ÷ (1 − p)`. Below capacity nothing changes. Past it, retries save no one (the same `λ − C` fail, after more
tries) but multiply what everything in front sees: with 3 retries a gateway of 2,000 req/s before a service of
1,000 runs out at 1,067 req/s instead of 2,000. `flows.requests` is the attempts; the meters show the attempts per
request and the share failing after every retry, and the retries are drawn as rings.

### A story

`step` lines walk a reader through the model in order: what to look at, and the values to show it at. Each step starts
from the defaults (or from its `scenario`), then takes its own values, so it looks the same whichever step came before.
`focus` outlines a component's box:

```
step "An ordinary peak: every box is under half its capacity." { load: 1 }
step "At 20×, the gateway and the workers are near full." { load: 20; focus: gateway }
step "The proposal doubles both: at 20× they are back under half." { scenario: Proposed; load: 20; focus: workers }
```

The page shows a bar above the diagram with the step's text, play, back and next (← and → while the bar has the
focus); play shows each step for its `seconds`.
`loadmap record x.loadmap --out story.gif --story --caption` plays every step for its `seconds` (default 4), its
text below the board; the same options give the same file. A step's own properties are `scenario`, `focus` and
`seconds`; every other line is a value.

A step that changes the structure (more pods, another scenario) does not swap the diagram: the boxes that stay move to
their new places with their edges, and what is new fades in. `transition: 1.2` makes that move take 1.2 seconds (0.8
by default; 0 cuts, and so does a reader who asked for reduced motion). A recording shows it too.

### Full screen

The diagram's **Full screen** fits the screen without scrolling: the diagram as wide as it, and below it the panels
of the page in a compact form, each of which opens whole. `fullScreen` keeps only the ones it lists:

```
fullScreen: [verdict, live, controls]
```

The names are `verdict`, `live` (the meters), `limits` (where it runs out, in order), `controls`, `headroom`,
`compare` (the scenarios side by side) and `assumptions`. `<Loadmap fullScreen={[...]}>` takes the same list.

A switch in full screen, or the F key, turns it into **focus**: the diagram, the story, and the verdict and the load
slider when `fullScreen` lists them. `fullScreenMode: focus` opens full screen there
(`<Loadmap fullScreenMode="focus">`); the default is `panels`.

### What stays code

A host page can give formulas more functions:

```ts
compile(source, { functions: { headroom: (x: number) => x * 1.2 } })
```

A shared link opened where those functions are missing reports which one it needs. Anything beyond formulas stays in
the TypeScript API, which reads the same.

### Layout

`loadmap fmt` (and **Format** in the editor) lays a definition out the one way: two spaces a block, a statement a
line, at most one blank line, one space around operators. Numbers, texts, templates and parentheses stay as written,
and a block written on one line stays on one line while it fits in 120 columns. `format(source)` from `@loadmap/dsl`
does the same in code; a text with a syntax error comes back unchanged, with its diagnostics.

## Errors

Every error has a line and a column, and parsing goes on after one, so a file shows all its problems at once. Names
that are almost right get a suggestion:

```
checkout.loadmap:93:17 error: unknown flow "order"
  93 |   demand: flows.order + flows.events
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

`r.expectations` holds each `expect` line with its place and its `check()` result; `problems(r)` returns the
diagnostics with every failing expectation added (as a warning, or as `problems(r, 'error')`).
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
| `transition` | number, constant | Seconds the diagram takes to move to a new structure (a scenario, a story step, a control that adds pods); 0 cuts. Default 0.8, at most 5; with reduced motion it cuts. |
| `fullScreen` | a list of `verdict`, `live`, `limits`, `controls`, `headroom`, `compare`, `assumptions` | The panels full screen shows, compact, below the diagram. Default all of them. |
| `fullScreenMode` | `panels` \| `focus` | What full screen opens with: the panels, or focus (the diagram, the story, the verdict and the load). Default panels. |
| `assume` | string, constant | A line added before the generated assumptions. |
| `searchMax` | number, constant | The highest load multiple the limits search. Default 2000. |

Holds: `load`, `param`, `preset`, `scenario`, `growth`, `expect`, `step`, `let`, `fit`, `flow`, `component`, `node`, `cluster`, `pool`, `thresholds`.

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

### expect

What must keep holding, on the pessimistic edge (every capacity at its low bound): `loadmap check` fails when it does not.

```
expect "Today keeps 7×" { target: 7 }
```

After the keyword: [label].

| Property | Value | |
| --- | --- | --- |
| `scenario` | scenario, constant | The scenario whose values it checks; the defaults without one. |
| `component` | component, constant | One component; the first limit without one. |
| `target` | number, constant | The target holds up to at least this load multiple. |
| `full` | number, constant | Nothing (or the component) runs out before this load multiple. |

### step

A step of the story the page walks through, in order: its text, and the values to show it at. `loadmap record --story` plays it.

```
step "At 30×, the workers run out first." { load: 30; focus: workers }
```

After the keyword: label.

| Property | Value | |
| --- | --- | --- |
| `scenario` | scenario, constant | Start from this scenario's values; without one, from the defaults. |
| `focus` | component, constant | The component to point at: its box is outlined. |
| `seconds` | number, constant | How long a recording holds the step. Default 4. |

Its properties are named by parameters (and `load`).

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

Holds: `drop`, `merge`, `retry`.

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

### retry

A unit turned away on the route (by a pass, limit or cache stage past capacity) is sent again, up to times more times. The attempts settle where the retries they cause are the ones assumed.

```
retry { times: 3; budget: 0.1 }
```

| Property | Value | |
| --- | --- | --- |
| `times` (required) | number, formula of parameters | Retries after the first attempt: a whole number. Reads only the parameters. |
| `budget` | number, formula of parameters | At most this share of the flow is added as retries: 0.1 adds at most 10 %. Without one, every retry is sent. |
| `when` | boolean, formula of parameters | The rule applies only while this is true; it reads only parameters. |

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
| `demand` | number, formula | What the component must handle, in its capacity's unit. Without one: the units per second reaching its stages. |
| `capacity` | capacity, formula | What it can handle: measured(value, unit, source) or estimated(value, unit, source), `value ± 30%` saying how sure it is; configured(value, unit, source) for a limit someone set. |
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
| `demand` | number, formula | What the component must handle, in its capacity's unit. Without one: the units per second reaching its stages. |
| `capacity` | capacity, formula | What it can handle: measured(value, unit, source) or estimated(value, unit, source), `value ± 30%` saying how sure it is; configured(value, unit, source) for a limit someone set. |
| `when` | boolean, formula | The component is switched off (no utilization) while this is false. |
| `over` | string, formula | What happens past 100 %, as a clause: "clients get 429s". |
| `describe` | string, formula | One line under the name in the limits list. |

Holds: `pass`, `store`, `sink`, `fanout`, `cache`, `limit`, `component`.

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
| `demand` | number, formula | What the component must handle, in its capacity's unit. Without one: the units per second reaching its stages. |
| `capacity` | capacity, formula | What it can handle: measured(value, unit, source) or estimated(value, unit, source), `value ± 30%` saying how sure it is; configured(value, unit, source) for a limit someone set. |
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
| `demand` | number, formula | What the component must handle, in its capacity's unit. Without one: the units per second reaching its stages. |
| `capacity` | capacity, formula | What it can handle: measured(value, unit, source) or estimated(value, unit, source), `value ± 30%` saying how sure it is; configured(value, unit, source) for a limit someone set. |
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

### cache

A share of the units (hit) is answered here and goes no further; the rest carry on to the next stage. Past capacity the share above 100 % is rejected.

```
cache { hit: 0.8 }
```

After the keyword: [id] [label].

| Property | Value | |
| --- | --- | --- |
| `hit` (required) | number, formula | The share answered here, 0 to 1. |
| `component` | component, constant | The component whose capacity this stage uses. Defaults to its box's component. |

### limit

A rate limiter: its component's capacity is the limit. Above it the share over is turned away, and the stages after it see only what got through.

```
limit
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
| `pods` | number, formula | How many pods; an autoscaled pool has autoscale instead. |
| `perPod` (required) | number, formula | Workers per pod. |
| `fill` | `round-robin` \| `in-order` | round-robin spreads work across pods (the default); in-order fills pod 0 first. |
| `component` | component, constant | The component whose capacity this stage uses. Defaults to its box's component. |

Holds: `autoscale`.

### autoscale

Pods are added and removed to hold each running pod near target, between min and max. The component's capacity is the pool at max pods: it runs out when the pool cannot grow further.

```
autoscale { min: 2; max: 10; target: 0.7 }
```

| Property | Value | |
| --- | --- | --- |
| `min` (required) | number, formula | The fewest pods, at least 1. |
| `max` (required) | number, formula | The most pods. |
| `target` (required) | number, formula | The utilization each running pod is held at, above 0 and at most 1: 0.7 scales out above 70 %. |

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

`min`, `max`, `round`, `floor`, `ceil`, `abs`, `sqrt`, `log`, `exp`, `pow`, `fmt`, `compact`, `pct`, `secs`, `measured`, `estimated`, `configured`

<!-- end of reference -->
