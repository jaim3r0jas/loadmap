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
checkout.loadmap:26:1 error: "Today keeps 12×" fails: expected at least 12×, but the 50 % target holds up to between 7.4× and 10×, limited by the API gateway (capacity estimated ±30 %)
  26 | expect "Today keeps 12×" { target: 12 }
     | ^^^^^^^^^^^^^^^^^^^^^^^^
checkout.loadmap: 1 of 2 expectations failed
```

Each expectation ends **pass**, **fail** or **inconclusive**. It is inconclusive when the answer rests on what is not
known: it holds at the high edge of a ± but not at the low one (`target: 8` above, between 7.4× and 10×), a
component has no published benchmark, or measured data it reads is missing or too thin. The line says why, and
`loadmap check` reports it as a warning; `--inconclusive fail` makes it fail the run. `severity: warn` makes an
expectation a warning whatever it finds: it is reported, and never fails the run.

```
expect "Black Friday keeps 3×" { scenario: Proposed; target: 3; severity: warn }
```

Under GitHub Actions (or with `--format github`) each problem is also written as an annotation, so it shows on its
line in the pull request, and a table of the expectations goes into the job summary.

`loadmap check --pull` reads the definition's measures first, as `loadmap pull` does (the same `--window`, `--step`
and `--to`), writes the snapshot next to it, and checks against it; `--snapshot <file>` checks against one already
there (a pull request from a fork gets no secrets, and a rerun reads exactly the data a job used). `--dry-run` reports
everything and exits 0, to watch a gate before it blocks. `--json <file>` writes the run's result: the commit
(`GITHUB_SHA`, or `--commit`), the snapshot's window, each expectation's outcome, severity and reasons, the first
limit and each component's utilization and headroom; `--format json` prints it instead of the lines.

```bash
loadmap check shop.loadmap --pull --window 7d --json result.json   # LOADMAP_PROMETHEUS_URL and its token from CI secrets
```

`--base <ref>` compares each definition with itself at a git ref, both against the same data (a pull reads the
measures of both). It fails when the first limit's headroom drops by more than `--tolerance` (`10%` by default, or
load multiples: `0.5×`), when the first limit moves to another component without more headroom, or when a component
crosses the target or 100 % from below at today's load, so a design already over its limit does not block every later
change. Each of those is an annotation on the line of the component it is about. `--accept "<reason>"` turns them
into warnings for a deliberate trade-off; the comment and the summary still say so. `--comment <file>` writes the pull
request comment: one sentence ("The first limit moves from the database at 3.1× to the cache at 1.4×, and runs out in
March 2027 instead of November 2027."), what fails, a table of each component's headroom before and after, and the
assumptions with where each number comes from, behind a marker a workflow finds it by again.

A workflow that runs it on every pull request, and keeps one comment up to date. The check job reads the secrets; the
comment job alone may write to the pull request. A pull request from a fork gets no secrets: it checks against the
snapshot committed next to the definition, gets no comment, and its job summary says so. The `capacity-accepted`
label is the approval path: adding or taking it off runs the check again.

```yaml
# loadmap check on every pull request: the change against its base, on fresh data. A label runs it again.
# No paths filter: a required check must report on every pull request, or one that touches no definition never merges.
name: capacity
on:
  pull_request:
    types: [opened, synchronize, reopened, labeled, unlabeled]

permissions: {}

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
          fetch-depth: 0 # the base, for --base
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 24
      - run: npm ci # @loadmap/cli pinned by the lockfile
      - env:
          LOADMAP_PROMETHEUS_URL: ${{ secrets.LOADMAP_PROMETHEUS_URL }}
          LOADMAP_PROMETHEUS_TOKEN: ${{ secrets.LOADMAP_PROMETHEUS_TOKEN }}
          BASE: origin/${{ github.base_ref }}
          FORK: ${{ github.event.pull_request.head.repo.fork }}
          ACCEPTED: ${{ contains(github.event.pull_request.labels.*.name, 'capacity-accepted') }}
        run: |
          args=(capacity.loadmap --base "$BASE" --comment comment.md --json result.json)
          if [ "$FORK" = true ]; then
            echo "A pull request from a fork gets no secrets: checked against the committed snapshot." >> "$GITHUB_STEP_SUMMARY"
            args+=(--snapshot capacity.snapshot.json)
          else
            args+=(--pull)
          fi
          if [ "$ACCEPTED" = true ]; then args+=(--accept "the capacity-accepted label"); fi
          npx loadmap check "${args[@]}"
      - if: always()
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: capacity-${{ github.sha }}
          path: |
            result.json
            capacity.snapshot.json
            comment.md

  comment:
    needs: check
    if: ${{ !cancelled() && !github.event.pull_request.head.repo.fork }}
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      pull-requests: write
    steps:
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: capacity-${{ github.sha }}
      - env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
          PR: ${{ github.event.pull_request.number }}
        # one comment, found again by its marker and its author and updated in place
        run: |
          id=$(gh api "repos/$REPO/issues/$PR/comments" --paginate --jq '.[]
            | select(.user.login == "github-actions[bot]" and (.body | startswith("<!-- loadmap-check -->"))) | .id' \
            | head -n 1)
          if [ -n "$id" ]; then
            gh api -X PATCH "repos/$REPO/issues/comments/$id" -F body=@comment.md
          else
            gh api "repos/$REPO/issues/$PR/comments" -F body=@comment.md
          fi
```

Make `check` a required status check in the branch's rules, and a failure blocks the merge. Notifications beyond the
comment (Slack, email) go through the CI's own means: a step after the check with `if: failure()`.

### Published figures

A **published** statement takes a capacity from the component catalog: the figure published for a component, under
the conditions its run was made with. One entry per component, whoever runs it: Apache Kafka, RabbitMQ, Valkey
(Redis-compatible), etcd, CockroachDB, ClickHouse, OpenSearch (Elasticsearch-compatible), NGINX, HAProxy, CoreDNS,
Kubernetes and Istio, and PostgreSQL, MySQL, MongoDB and Envoy, for which nothing is published with its conditions.

```
published brokersRef kafka {
  edition: "2026-11"
  version: "4.4"
  brokers: brokers
  replication: 3
  acks: "all"
  messageSize: "1 KB"
  producers: 4
}

cluster kafka "Brokers" {
  members: brokers
  demand: flows.events / 1_000
  capacity: brokersRef
  over: "producers wait"
}
```

Its properties are the component's conditions; a value is a number, a switch, a quoted word or a formula of the
parameters. The figure applies only when every condition its run decided on matches: with `brokers: 6` against runs
of 3 brokers, the brokers have no published benchmark, are not ranked, and the verdict, the limits and `loadmap check`
say so. Nothing is scaled or interpolated. `edition` pins the numbers, so a file keeps them when the catalog adds a
newer edition (the checker says when one has other figures). `version` is kept beside the figure, and decides only for
a component whose published figures change with it (RabbitMQ, Valkey, CockroachDB, OpenSearch, Istio). `figure`
picks one when several match; `margin: 0.3` reads a best case from 70 % of the figure up to it, never above.

A published figure is a best case elsewhere, not a measurement of your system: the verdict says "(capacity
published, a best case)", and the assumptions name its conditions, who ran it and link its source. Autocomplete
offers the components, their conditions and the values their runs used.

### Measured data

Numbers read from the metrics stores a team already runs (Prometheus, Elasticsearch, …) reach a model as a
**snapshot**: a JSON file with each measurement's value, the points it came from and its origin (the provider, the
query, the window, the step, when it was read and how many samples it has). The model reads the file and never the
store, so a page and its recordings say the same thing on any day.

```json
{
  "format": "loadmap-snapshot",
  "version": 1,
  "fetched": "2026-11-08T06:00:00Z",
  "from": "2026-11-01T00:00:00Z",
  "to": "2026-11-08T00:00:00Z",
  "measurements": {
    "apiCapacity": {
      "unit": "req/s",
      "value": 1200,
      "origin": {
        "provider": "prometheus",
        "query": "max_over_time(sum(rate(http_requests_total[5m]))[7d:5m])",
        "from": "2026-11-01T00:00:00Z",
        "to": "2026-11-08T00:00:00Z",
        "step": 300,
        "fetched": "2026-11-08T06:00:00Z",
        "samples": 2016,
        "min": 30,
        "stat": "max"
      }
    },
    "hit": { "unit": "share", "missing": "the query returned no series" }
  }
}
```

A **metric** is the query that measures something, written once; a **measure** is one use of it, with its
arguments and its **fallback**: the value the definition uses until a snapshot has one. Its id is a capacity or a
number, as its fallback is, and names the measurement in the snapshot:

```
metric served "Requests served" {
  prometheus { query: 'max_over_time(sum(rate(http_requests_total{job="{{ args.job }}"}[5m]))[7d:5m])' }
  stat: max
  min: 30
}
measure apiCapacity served { job: "api"; fallback: estimated(1_000, "req/s", "vendor benchmark") }
measure orderRate served { job: "orders"; fallback: 40; unit: "orders/s" }

# capacity: apiCapacity    rate: orderRate * load
```

`{{ args.job }}` is filled by each measure's `job`, so one metric serves several components; the checker names an
argument the query needs and one it never uses. `stat` says how the window becomes one value (`mean` by default) and
`min` how many samples it needs before it counts. A `fit` with `x` and `y` naming two measures is fitted from their
series when there is a snapshot, and from its own `points` when there is none. A value read from a snapshot is
today's system's: it does not change with the parameters.

A metric can read from **Elasticsearch** or OpenSearch instead: the documents of an index, counted or aggregated at
each step of the window. `agg: rate` (the default) is documents per second, `count` documents per step, and `avg`,
`sum`, `min` and `max` read a `field`. The `query` is Elasticsearch query JSON that picks the documents, an argument
inside its texts (filled in escaped, so a measure's word never changes the query's shape), and `time` names the time
field (`@timestamp` by default). A window where nothing matches is missing, not zero:

```
metric logins "Logins" {
  elasticsearch { index: "auth-*"; query: '{"term": {"service": "{{ args.service }}"}}'; agg: rate }
  stat: p95
}
```

**Nothing in a definition fetches anything.** `loadmap pull` reads every measure from its provider and writes the
snapshot next to the definition; the address and the credentials come from the environment, never from the text, so a
shared link cannot make anyone's browser or CLI call a server (Elasticsearch: `LOADMAP_ELASTICSEARCH_URL`, with
`LOADMAP_ELASTICSEARCH_API_KEY` or a user and password):

```bash
export LOADMAP_PROMETHEUS_URL=https://prometheus.example:9090 LOADMAP_PROMETHEUS_TOKEN=…
loadmap pull shop.loadmap --window 7d --step 5m        # writes shop.snapshot.json
```

```
shop.snapshot.json: 1 of 2 measurements, 2026-11-01T06:00:00Z to 2026-11-08T06:00:00Z
  ✓ apiCapacity: 1,200 req/s (2,016 samples, max)
  ✗ orderRate: the query returned 3 series: sum them into one
```

The window ends on the step's grid, so two pulls in the same step read the same points. A query that fails, or a
window with fewer samples than `min`, leaves that measurement missing: the model uses the fallback, and the
assumptions say why. A host compiles with the snapshot, `compile(source, { snapshot: fromSnapshot(parseSnapshot(text))
})`; without one, every measure is its fallback.

In TypeScript, `parseSnapshot` checks the file (an opened file is untrusted input) and `fromSnapshot` reads it inside
the model's functions. Every read names the value the definition uses when the snapshot has none: a measurement that
is missing, or has fewer samples than its `min`, falls back to it, never to an invented one, and the assumptions say
why.

```ts
import { estimated, fromSnapshot, parseSnapshot } from '@loadmap/react'

const snapshot = parseSnapshot(await (await fetch('./checkout.snapshot.json')).text())
const read = fromSnapshot(snapshot)
// capacity: read.capacity('apiCapacity', estimated(1_000, 'req/s', 'vendor benchmark'))
// rate: ({ load }) => read.value('requests', 40) * load
// calibration: { 'Worker CPU per request': read.fit('rate', 'cores', workerCores) }
// defineModel({ snapshot, … }) lists every measurement with the assumptions
```

A value read from a snapshot is `measured`, and its source is its origin: "prometheus: sum(rate(…)), 2026-11-01 to
2026-11-08, every 5 min, 2016 samples, max". A fit can come from two series in it (cost against rate, joined on
their timestamps). `summarize(points, stat)` turns a window into one value (`mean`, `min`, `max`, `last`, `p50`,
`p95`, `p99`).

Each kind has standard measurements, so every provider maps its results onto the same names (`MEASURES`). The role
says what a number is about: `capacity`, `limit`, `latency` and `cost` mean what a published figure's measure means,
so a measured and a published p99 land in the same place. A measurement for a part of the model that is not built
yet (latency, slots, splits) is read and listed, and nothing uses it.

<!-- measures: written from MEASURES in packages/core; UPDATE_DOCS=1 pnpm test:node rewrites it -->

| Kind | Measurement | Role | Dimension | Sets | |
| --- | --- | --- | --- | --- | --- |
| `flow` | `rate` | rate | per second | `rate` | Units per second at the source. |
| `pass` | `served` | rate | per second |  | Units handled per second. |
| `pass` | `rejected` | rate | per second |  | Units turned away per second (429, 503). |
| `pass` | `capacity` | capacity | per second | `capacity` | The most it handled: a load test or a saturated peak. |
| `pass` | `instances` | count | count |  | Instances serving. |
| `pass` | `latencyP50` | latency | ms | not modelled yet | Median response time. |
| `pass` | `latencyP95` | latency | ms | not modelled yet | 95th percentile response time. |
| `pass` | `latencyP99` | latency | ms | not modelled yet | 99th percentile response time. |
| `queue` | `produced` | rate | per second | `rate` | Messages written per second. |
| `queue` | `consumed` | rate | per second |  | Messages read per second. |
| `queue` | `lag` | count | count |  | Messages waiting. |
| `queue` | `lagSeconds` | duration | seconds |  | How old the oldest waiting message is. |
| `queue` | `partitions` | count | count | `partitions` | Partitions of the topic. |
| `queue` | `bytesIn` | rate | bytes per second |  | Bytes written per second. |
| `queue` | `bytesOut` | rate | bytes per second |  | Bytes read per second. |
| `workers` | `pods` | count | count | `pods` | Pods running. |
| `workers` | `perPod` | count | count | `perPod` | Workers in each pod. |
| `workers` | `busy` | share | share |  | The share of workers busy. |
| `workers` | `cores` | cost | cores |  | CPU cores used: fitted against a rate, the cost per unit. |
| `workers` | `coresLimit` | capacity | cores | `capacity` | CPU cores the pool may use. |
| `cache` | `ops` | rate | per second |  | Lookups per second. |
| `cache` | `hit` | share | share | `hit` | The share of lookups answered from the cache. |
| `cache` | `evictions` | rate | per second |  | Entries evicted per second. |
| `cache` | `memory` | size | bytes |  | Memory used. |
| `cache` | `capacity` | capacity | per second | `capacity` | The most lookups it handled. |
| `limit` | `allowed` | rate | per second |  | Units let through per second. |
| `limit` | `rejected` | rate | per second |  | Units rejected per second. |
| `limit` | `limit` | limit | per second | `capacity` | The limit it is set to. |
| `store` | `queries` | rate | per second |  | Queries per second. |
| `store` | `commits` | rate | per second |  | Commits per second. |
| `store` | `capacity` | capacity | per second | `capacity` | The most commits (or queries) it handled. |
| `store` | `replicaLag` | duration | seconds |  | How far the replicas are behind. |
| `store` | `writeLatency` | latency | ms | not modelled yet | Time a write takes. |
| `store` | `connections` | count | count | not modelled yet | Connections open: a pool of slots. |
| `fanout` | `copies` | share | per unit | `share` | Copies sent per unit, per branch. |
| `fanout` | `deliveries` | rate | per second |  | Copies delivered per second, per branch. |
| `split` | `share` | share | share | not modelled yet | The share of units sent to each branch. |
| `slots` | `inUse` | count | count | not modelled yet | Slots in use: connections, sessions, in-flight requests. |
| `slots` | `available` | capacity | count | not modelled yet | Slots there are. |
| `slots` | `held` | duration | seconds | not modelled yet | How long each is held. |
| `slots` | `wait` | duration | seconds | not modelled yet | The wait for a free slot. |

<!-- end of measures -->

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
step "An ordinary peak: every box is under half its capacity." { load: 1; title: "An ordinary peak" }
step "At 20×, the gateway and the workers are near full." { load: 20; focus: gateway }
step "The proposal doubles both: at 20× they are back under half." { scenario: Proposed; load: 20; focus: workers }
```

The page shows a bar above the diagram with the step's text, play, back and next (← and → while the bar has the
focus). Back and next show a step at once. Play tells it on the diagram: the whole diagram first, then for each step a
close-up on what it changes (the box it points at and any box it reshapes; else what it reshapes; else the boxes whose
state changes; else the first limit), the change, and the whole diagram again for the step's `seconds`. A short
`title` names the step on the diagram meanwhile; without one it says what changes ("Users 1× → 20×"). With reduced
motion the camera cuts between the shots. The component that runs out first wears a ring and a tag; it breathes while
the story plays and once it is past the target.
`loadmap record x.loadmap --out story.gif --story --caption` plays it the same way, from the defaults, the title on the
board and the step's text below it; the same options give the same file. A step's own properties are `scenario`,
`focus`, `title` and `seconds`; every other line is a value.

A step that changes the structure (more pods, another scenario) is laid out on its own and the boxes move to their new
places: what stays slides and resizes, what is new fades in. Each step, scenario, preset and choice of a select or
switch takes only the room it needs, over every load and every value of the range controls, so dragging a slider never
moves a box, and a step looks the same whichever came before. `layout: stable` gives every box one place instead, the largest it needs anywhere the model
reaches (its scenarios, steps, presets and controls): no step moves a box, a pool that gains pods grows where it
stands, and every step pays for the room of the largest. `transition: 1.2` makes a change take 1.2 seconds (0.8 by
default; 0 cuts, and so does a reader who asked for reduced motion). A recording shows it too.

### Direction and tiers

The diagram runs right, or down when it fans out wider than it is long: when its widest layer has more boxes than its
longest chain. Every edge counts, whatever its `when`, so the direction never turns with the values. `direction:
right` or `direction: down` says which way (`layout: right` and `layout: down`, its old name, still work, and `loadmap
fmt` rewrites them); narrow screens always run down.

The boxes nothing feeds stand first and the sinks and stores that feed nothing stand last. To cut the diagram into
bands across the flow (edge, services, data), declare tiers in the order the flow meets them and put a box in one:

```
tier edge "Edge"
tier services "Services"
tier data "Data"

node gateway "Gateway" { tier: edge; pass }
pool api "API" { tier: services; workers { pods: pods; perPod: 8 } }
node db "Database" { tier: data; store }
```

Each tier is a lane behind its boxes: filled in two alternating shades, a line between them, and a header with its
name in capitals at the lane's start, a strip across the top (a column on the left running down, and on a phone, the
name reading up). A name wider than its lane takes two lines, and every header on the board then takes two. A box
without a tier stands in the tier of the boxes that feed it, or of those it feeds when nothing feeds it, so a
definition names the tier where it changes. In TypeScript:
`tiers: { edge: { label: 'Edge' }, … }` in the view, `tier: 'edge'` on a box.

`lanes: striped` leaves every other lane clear. A tier can have a colour of its own, and one for the dark theme;
without it, dark keeps the colour's hue as dark as the theme's lanes, and a dark one alone leaves light the theme's. A colour is `"#rrggbb"`, `"rgb(…)"` or
`"hsl(…)"`, nothing that fetches:

```loadmap
tier data "Data" { fill: "#e6f2ec"; fillDark: "#1c2b26" }
```

In TypeScript: `lanes: 'striped'` in the view, `fill` and `fillDark` beside a tier's `label`. The page's theme sets
the shades: `--lm-tier-base` for the first, third… lanes, `--lm-tier` for the others. In the editor, **View** switches
the lanes' fills and the dot grid behind the diagram (`grid: false`), and the model's tab gives each lane its colours.

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
checkout.loadmap:102:17 error: unknown flow "order"
  102 |   demand: flows.order + flows.events
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
`completions(source, offset)` lists what may be typed at a place, ranked by what fits there, with snippets in the
language server protocol's `${1:field}` form. `hover(source, offset, definition?)` says what the word there is (a
statement, a property, a name the definition declares, a builtin) and, given the compiled definition, its values at the
defaults: a flow's rate, what reaches a stage, a component's utilization and where it runs out. `signatureHelp(source,
offset)` names the arguments of the builtin or fit the cursor is in. `quickFixes(source, diagnostics)` gives each
diagnostic's fixes as text changes (the did-you-mean, a missing property, a bare number made a capacity).
`definition` and `references(source, offset)` find where a name is declared and every place it is written, and
`rename(source, offset, name)` renames it everywhere: a box's id with the stage and the component that take it. `encodeShare` and `decodeShare` write and read share
links: `#v1.` followed by the text deflated and base64url-encoded, then the values that differ from the defaults
(`&load=30`). The link carries everything, so nothing goes to a server.

## In your editor

In **VS Code** (and Cursor, VSCodium and the other editors on Open VSX), install the extension **loadmap**
(`jaim3r0jas.loadmap`, from the Marketplace or Open VSX). It brings the language server below, highlighting, and a
live preview beside the text: **loadmap: Open Preview to the Side** (Ctrl+K V, ⌘K V on a Mac) draws the file as you
type, a click on a box selects its declaration, the eye over it tracks live changes (the boxes each edit changed come
into view and glow), **loadmap: Add from the Catalog…** writes a component's published figure, and **Copy Share Link**
opens the text in this editor. Nothing else to install; `loadmap.server.path` runs a project's own `loadmap` instead.

`loadmap lsp` (in `@loadmap/cli`) speaks the language server protocol over standard input and output, so an editor
that speaks it gets the help the docs' editor has: errors and failing `expect` lines as you type, completion with
snippets, hover with the values at the defaults, the arguments of a call, formatting, quick fixes, go to definition,
references, rename and an outline. It needs no browser. Install the CLI in the project (`npm i -D @loadmap/cli`), then
tell the editor about it. Neovim (0.11 or later):

```lua
vim.filetype.add({ extension = { loadmap = 'loadmap' } })
vim.lsp.config('loadmap', { cmd = { 'npx', 'loadmap', 'lsp' }, filetypes = { 'loadmap' }, root_markers = { 'package.json' } })
vim.lsp.enable('loadmap')
```

On Neovim 0.10, start it when a `.loadmap` file opens instead:

```lua
vim.filetype.add({ extension = { loadmap = 'loadmap' } })
vim.api.nvim_create_autocmd('FileType', {
  pattern = 'loadmap',
  callback = function() vim.lsp.start({ name = 'loadmap', cmd = { 'npx', 'loadmap', 'lsp' } }) end,
})
```

Helix, in `languages.toml`:

```toml
[[language]]
name = "loadmap"
scope = "source.loadmap"
file-types = ["loadmap"]
comment-token = "#"
indent = { tab-width = 2, unit = "  " }
language-servers = ["loadmap"]

[language-server.loadmap]
command = "npx"
args = ["loadmap", "lsp"]
```

The server reads one file at a time, the whole text on each change, and colours nothing: highlighting stays the
editor's.

## Reference

<!-- reference: written by reference() in packages/dsl; UPDATE_DOCS=1 pnpm test:node rewrites it -->

### The top level

A loadmap definition.

| Property | Value | |
| --- | --- | --- |
| `title` | string, constant | The heading above the diagram. |
| `direction` | `right` \| `down` | Which way the diagram runs. Default right, or down when its widest layer has more boxes than its longest chain. Narrow screens always run down. |
| `layout` | `compact` \| `stable` | compact (the default) lays out each scenario, story step, preset and choice of a select or switch on its own and moves the boxes from one to the next; stable gives every box one place, the largest it needs anywhere, so none of them moves a box. Neither the load nor a range moves one. |
| `speed` | number, constant | Simulated seconds per real second. Default 10. |
| `transition` | number, constant | Seconds the diagram takes to move to a new structure (a scenario, a story step, a control that adds pods); 0 cuts. Default 0.8, at most 5; with reduced motion it cuts. |
| `fullScreen` | a list of `verdict`, `live`, `limits`, `controls`, `headroom`, `compare`, `assumptions` | The panels full screen shows, compact, below the diagram. Default all of them. |
| `fullScreenMode` | `panels` \| `focus` | What full screen opens with: the panels, or focus (the diagram, the story, the verdict and the load). Default panels. |
| `assume` | string, constant | A line added before the generated assumptions. |
| `searchMax` | number, constant | The highest load multiple the limits search. Default 2000. |
| `lanes` | `filled` \| `striped` | filled (the default): every lane in two alternating shades; striped: every other one clear. |
| `grid` | boolean, constant | The editor's dot grid. Default true. |

Holds: `load`, `param`, `preset`, `scenario`, `growth`, `expect`, `step`, `let`, `fit`, `published`, `metric`, `measure`, `flow`, `component`, `node`, `cluster`, `pool`, `tier`, `thresholds`.

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
| `severity` | `fail` \| `warn` | warn: `loadmap check` reports it, and never fails because of it. Default fail. |

### step

A step of the story the page walks through, in order: its text, and the values to show it at. Play (and `loadmap record --story`) shows the whole diagram, closes in on what the step changes, changes it, and steps back.

```
step "At 30×, the workers run out first." { load: 30; focus: workers; title: "Users to 30×" }
```

After the keyword: label.

| Property | Value | |
| --- | --- | --- |
| `scenario` | scenario, constant | Start from this scenario's values; without one, from the defaults. |
| `title` | string, constant | The few words the diagram shows while Play shows the step. Default: what the step changes. |
| `focus` | component, constant | The component to point at: its box is outlined. |
| `seconds` | number, constant | How long Play holds the whole diagram after the step changes it: the time to read it. Default 4. |

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
| `x` | measure, constant | A measure whose series is x: with `y`, a snapshot fits the two, and the points are what it falls back to. |
| `y` | measure, constant | A measure whose series is y (the cost), with `x`. |

Holds: `points`.

### metric

A mapping written once: the query that measures something, how its window becomes one value, and how many samples it needs. Each `measure` that uses it fills `{{ args.name }}` in the query. Nothing is read until `loadmap pull`, which takes the address and the credentials from the environment, never from the text.

```
metric served "Requests served" {
  prometheus { query: "sum(rate(http_requests_total{job=\"{{ args.job }}\"}[5m]))" }
  stat: max
  min: 30
}
```

After the keyword: id [label].

| Property | Value | |
| --- | --- | --- |
| `stat` | `mean` \| `min` \| `max` \| `last` \| `p50` \| `p95` \| `p99` | How the window becomes one value. Default mean. |
| `min` | number, constant | The samples a window needs before its value counts; with fewer, the fallback is used. |

Holds: `prometheus`, `elasticsearch`.

### prometheus

A metric read from Prometheus: a PromQL query over a range, at the address `LOADMAP_PROMETHEUS_URL` gives `loadmap pull`. The query is data sent to Prometheus, never code loadmap runs; it must return one series.

```
prometheus { query: "sum(rate(http_requests_total[5m]))" }
```

| Property | Value | |
| --- | --- | --- |
| `query` (required) | string, constant | The PromQL query; `{{ args.name }}` is filled by each measure. |

### elasticsearch

A metric read from Elasticsearch or OpenSearch: an index, counted or aggregated at each step, from `LOADMAP_ELASTICSEARCH_URL`.

```
elasticsearch { index: "logs-*"; query: '{"term": {"service": "{{ args.service }}"}}'; agg: rate }
```

| Property | Value | |
| --- | --- | --- |
| `index` (required) | string, constant | A name, a pattern ("logs-*") or names joined by commas. |
| `query` | string, constant | Which documents count: query JSON, `{{ args.name }}` inside its texts. Default all. |
| `agg` | `rate` \| `count` \| `avg` \| `sum` \| `min` \| `max` | rate (documents per second, the default), count (per step), or avg, sum, min or max of `field`. |
| `field` | string, constant | What avg, sum, min and max read: "duration_ms". |
| `time` | string, constant | The time field. Default "@timestamp". |

### measure

One use of a metric: its arguments, and the value the definition uses until a snapshot has one. Its id is a capacity or a number, as its fallback is (`capacity: apiPeak`), and names the measurement in the snapshot `loadmap pull` writes. Read from a snapshot, the value is today's system's: it does not change with the parameters.

```
measure apiPeak served { job: "api"; fallback: estimated(1_000, "req/s", "vendor benchmark") }
```

After the keyword: id metric.

| Property | Value | |
| --- | --- | --- |
| `fallback` (required) | value, constant | A capacity (`measured(…)`, `estimated(…)`) or a number: what the definition uses when the snapshot has no value, or there is no snapshot. |
| `unit` | string, constant | The unit of a number, as the snapshot writes it: "orders/s". A capacity has its own. |

Its properties are named by the arguments its metric's query names (`{{ args.job }}`: `job`).

### published

A figure from the component catalog, as published for a configuration: its id is a capacity (`capacity: brokersRef`). It applies only when every condition its run was made under matches; otherwise the component has no published benchmark and is not ranked. Nothing is scaled.

```
published brokersRef kafka { edition: "2026-11"; brokers: 3; replication: 3; acks: "all"; messageSize: "1 KB"; producers: 4 }
```

After the keyword: id component.

| Property | Value | |
| --- | --- | --- |
| `edition` (required) | string, constant | The catalog edition its figures come from, "YYYY-MM": an old file keeps its numbers. |
| `version` | string, formula of parameters | The version you run. It decides only for a component whose figures change with the version; elsewhere it is kept beside the figure. |
| `figure` | string, constant | Which figure, when several match: its id in the catalog. |
| `margin` | number, constant | Lowers the best case, as a share from 0 to below 1: 0.3 reads the capacity from 70 % of the figure up to it. |

Its properties are named by the catalog component's conditions (its runs' brokers, message size, …).

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

### tier

A lane across the flow (edge, app, data) drawn behind its boxes, its name in a header. Tiers run in the order they are declared.

```
tier data "Data"
```

After the keyword: id [label].

| Property | Value | |
| --- | --- | --- |
| `fill` | string, constant | The lane's own colour: "#rrggbb", "rgb(…)" or "hsl(…)". |
| `fillDark` | string, constant | Its colour in the dark theme. Default: fill's hue, as dark as the theme's lanes. |

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
| `tier` | tier, constant | The tier the box stands in; without one, that of the boxes that feed it. |
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
| `tier` | tier, constant | The tier the box stands in; without one, that of the boxes that feed it. |
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
| `tier` | tier, constant | The tier the box stands in; without one, that of the boxes that feed it. |
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
