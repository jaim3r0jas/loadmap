# The .loadmap language

A `.loadmap` file defines a whole loadmap as text: the load and the controls, the flows and their routes, the boxes
of the diagram with what each one does and what can run out. `@loadmap/dsl` reads it into the same `model` and
`view` that `defineModel` and `defineView` build in TypeScript, so `<Loadmap>` draws it the same way. The editor
(`@loadmap/editor`, and the docs site's editor) shows it live as you type.

```loadmap
loadmap 1.5
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
  pods: pods
  perPod: 4
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

- **The first line is the version:** `loadmap 1.5`. A file keeps reading as it did under the version it names, and
  one written for a newer version says so instead of half working ([Versions](#versions)).
- **A statement with an id starts with its keyword:** `param pods "Worker pods" { … }`. The words after the keyword
  are its id and its label (and for a box, the line under it). An id names one thing: a box, its stage and its
  component share one, and any other pair that does (`param pods` beside `pool pods`), or an id that is also a keyword
  (`param merge`, `pool workers`), compiles with a `shadowed-name` warning, since `${pods}` and `focus: pods` would
  then read two different things.
- **A property is `key: value`**, one per line or separated by `;`.
- **An edge is `a -> b`**, with an optional label after `:`.
- **A text is `"…"` on one line.** A long one continues on the next line as another text (from `loadmap 1.2`): the
  pieces are one text, joined as written, so the space goes inside a piece. `loadmap fmt` breaks a text that runs past
  120 columns this way. A text in backticks may run over lines, and keeps its line breaks.
- **`#` starts a comment.**

### Boxes, stages and components

A **box** (`node`, `cluster`, `pool`) is what the diagram shows. Two more things can live in a box:

- **A stage:** what the dots do there. Write it as a statement inside the box: `pass`, `store`, `sink`, `fanout`,
  `split`, `cache` or `limit` in a node, one or more `queue` in a cluster. Its id is the box's id unless you give it
  one. A label after the keyword names it in the meters and the sentences: `queue topic "orders topic"`. Without one it
  takes its component's `short` ("the gateway") when no other stage runs that component, and its id otherwise. A pool
  is its stage: its workers are lines of the pool (`pods`, `perPod`, `placement`, `autoscale { … }`), its id is the
  pool's and `stageLabel: "…"` names it (from `loadmap 1.5`; before it they were a `workers { … }` block in the pool).
- **A component:** what can run out. Write its lines on the box: `demand`, `capacity`, `over`, and optionally
  `name`, `short`, `plural`, `describe` and `when`. Its id is the box's id and its name is the box's label. A stage in
  the box uses this component unless it names another one with `component: …`. A component without a box is a
  top-level `component id "Name" { … }`.

A route lists stages: `route: gateway -> topic -> workerPool`. It may also name a box that runs exactly one stage.

**Dots move only along edges.** Every hop a flow takes needs an edge drawn the way it goes: from its `from` box to
its first stage, between the stages next to each other on its route, on each way of a split (and where a way rejoins
the route), and from a fan-out to each stage it copies to. Two stages in one box are no hop. A hop without its edge is
an error at the hop (`"signups" goes from "gateway" to "api", and no edge joins them`); the editor offers to add the edge
or, when other edges already join the two boxes, to route the flow through them. In a file stamped before
`loadmap 1.1` it is a warning, and its dots cross straight, as they did. An edge a flow takes may still have a
`when`, but where it hides the edge (at the defaults, in a preset or a scenario) and the flow still goes that way, the
checker warns.

**A box like another** (from `loadmap 1.2`) says `like:` and the other box's id, and writes only what differs:

```loadmap
node db "Index shard 1" {
  store
  capacity: estimated(1_000 ± 30%, "queries/s", "a load test of one shard")
  over: "queries queue"
}
node db2 "Index shard 2" { like: db; short: "the second shard" }
```

It takes every line and stage of that box it does not write itself; a line written here replaces the same line there,
and a stage written here replaces its stages. A line taken that reads the other box by its name (`at.db.orders`,
`out.db`, `util.db`) reads this box here. The id, the label and the edges are each box's own. The other box is of
the same kind (a pool is like a pool), may itself be like a third, and gives its stage and its component no id of
their own, since each would then be declared twice.

### Formulas

Every value is a formula: a small subset of TypeScript expressions, so a lambda body from a TypeScript model pastes
as it is.

- **Literals:** numbers (`20_000`), `"texts"`, `true`, `false`, and templates (`` `${pods} pods` ``).
- **Units:** a number may carry its unit straight after it, with no space. `ms`, `s`, `min` and `h` count in seconds,
  as every time in the language does (`held: 20ms` is `held: 0.02`); `%` makes a share (`hit: 80%` is `hit: 0.8`);
  `×` (or `x`) marks a load multiple and leaves the number as it is. So `demand: flows.events * 2ms` reads as what it
  is, events a second times the CPU seconds each takes. The two are checked where a property says which it takes:
  `underTarget: 70%` (a load multiple goes there) and `thresholds { target: 7× }` (a share) are errors from
  `loadmap 1.2`, and a warning in a file stamped before it. A `%` straight after a number is always a share
  (`80% * x` is 0.8 × x, `30%+1` is 1.3), and the remainder is `mod(10, 3)`. Before `loadmap 1.5` a `%` between two
  values was also the remainder (`10 % 3`, and `30%+1` where a share was likely meant): from 1.5 that is an error,
  which `loadmap fmt` and its quick fix write as `mod(a, b)`.
- **Sizes** (from `loadmap 1.2`): `KB`, `MB`, `GB` and `TB` after a number count in bytes, decimal as a network counts
  (`1.5KB` is 1,500). A demand written with a size is brought to the size its capacity counts in, so
  `demand: flows.alerts * 1.5KB` against `estimated(20, "MB/s", …)` is megabytes a second, with no `/ 1000` to forget (a capacity in `"bytes/s"` or `"B/s"` takes the bytes as they are).
  A size against a capacity that names none (`"req/s"`, or `"Mb/s"`: megabits), a size added to a plain number, and a
  size in the capacity's number instead of its unit are errors.
- **Operators:** `+ - * /`, `< <= > >= == !=`, `&& || !`, `? :` and parentheses (`===` and `!==` are old
  spellings of `==` and `!=`: they warn, and `loadmap fmt` rewrites them).
- **Names:**
  - `load` and the parameters by their id;
  - `let` names;
  - `flows.x`, `at.stage.x`, `demand.x` and `util.x` for the model's tables (`at.stage` alone is every flow reaching
    that stage). `derived.x` is an old spelling of the let `x`: it warns, and `loadmap fmt` writes `x`;
  - `out.stage` for what a fan-out sends, a second: what reaches it of each flow times that branch's copies. A box that
    runs a fan-out says `demand: out.push` instead of repeating the copies (from `loadmap 1.2`);
  - `i` inside `memberLabel` and `podLabel`, and `value` inside `format`.
- **Calls:** the built-in functions (listed at the end), the fits by their id, and the functions a host page provides.
- **Capacities** come only from `measured(value, unit, source)`, `estimated(value, unit, source)` or, for a limit
  someone set, `configured(value, unit, source)`. A bare number is an error, so every capacity says where it came
  from.

**Units are checked where the text says them.** `flows.x` and `at.stage.x` are units a second, a number with a unit is
what it says, a fit returns its y (`points rate cores` gives cores) and `demand: … as "cores"` declares the rest. A
capacity in `"…/s"` counts units a second; any other unit (`"cores"`, `"connections"`) is a count of it. Where a
demand's unit is known and differs from its capacity's (per second against cores, cores against connections), or a
property gets a unit it is not in (`held: 80%`, `hit: 5s`; the reference says each one's), the definition still
compiles, with a warning. A bare number is any unit, so `flows.events * 0.002` is never warned about: write
`flows.events * 2ms`, and the check sees events a second times seconds, a count, as a capacity in cores is. A
component without a demand line handles the units a second reaching its stages, so a capacity in cores there warns
too. Words of two rates are never compared: orders a second become requests or writes a second all the time. In CI,
`loadmap check --units fail` fails the run on any of these warnings.

**Formulas are typed, as TypeScript's are, without its loose reading of values.** A condition (the test of `? :`,
each side of `&&`, `||` and `!`, a `when`, an `enabled`) is `true` or `false`, never a number or a text read as one:
`pods ? …` is `pods != 0 ? …`. `< <= > >=` compare numbers, `==` and `!=` compare like with like (`pods == "4"` is
always false), a literal compared with a select is one of its options, and comparisons don't chain: `1 < load < 3`
is `1 < load && load < 3`. Both answers of a `? :` have the same type. Where the definition is computed (the
defaults, each preset and scenario), a rate and a demand are at least 0, a capacity is above 0, and a preset's load
and slider values stay in their ranges. From `loadmap 1.1` each of these is an error; a file stamped before it gets a warning
that says so and computes as it did. A demand that is not a number (`flows.x / (pods - 2)` with 2 pods) is a warning,
as a rate's is.

Some properties must be constants (a `priority`, a `unit`). Others may read only the parameters (`enabled`).

**Formulas are safe to share.** The text is parsed into a tree and run as closures. There is no `eval` or
`new Function`, no global name, no property but the five tables, and caps on size and depth. Counts that size the
drawing are capped too: at most 64 members, 256 pods, 256 workers a pod and 1,024 partitions a flow.

### Scenarios and growth

A **scenario** is a design to compare: the defaults plus some parameter values, never the load. The first one is the
baseline the others are measured against, so name today's design first:

```loadmap
scenario "Today" {}
scenario "Proposed" { gateways: 2; pods: 6 }
growth { rate: 0.06; per: month; asOf: "2026-11-01" }
```

A scenario may have an id before its label (from `loadmap 1.2`): `scenario proposed "Proposed" { … }`. A step or an
expect then says `scenario: proposed`, and the button's text can be reworded without touching them; naming it by its
label, `scenario: "Proposed"`, still works.

The page shows a button per scenario above the diagram, a table of where each one first runs out, and a headroom
chart with one line per scenario. **Growth** turns load multiples into dates: the load is 1× on `asOf` and grows by
`rate` every `per`, compounded, so 10× at 6 % a month is about 40 months later ("around February 2030"). Dates come
from `asOf` alone, never from today's date, so a page and its recordings say the same thing on any day.

A share link carries the scenarios in the text and the shown one in its values (`&gateways=2&pods=6`), so it opens
with that scenario's button pressed.

### How sure, and what must hold

A capacity says how sure it is with a `±` in its value, as a share (`30%`) or in its unit (`± 1`). `+/-` is the same
for a keyboard without `±`:

```loadmap
capacity: estimated(20_000 * gateways ± 30%, "req/s", "vendor benchmark, not load-tested")
capacity: measured(pods * 2 +/- 5%, "cores", "pod CPU limit")
```

Every crossing is then also found with each capacity at its low bound and at its high bound, and the limits become
ranges: "the 50 % target holds up to between 7.4× and 10×". The ranking, the first limit and the presets use the
pessimistic edge (every capacity low), where it may already happen. The headroom chart draws each scenario as a band
with a bracket where it crosses the target and 100 %, and when the range is wide, a line under the verdict names the
capacity whose measurement would change or narrow the answer most. Fits stay exact.

An **expect** line is something that must keep holding, as minimum load multiples on that pessimistic edge:

```loadmap
expect "Today keeps 7×" { underTarget: 7 }
expect "Proposed keeps 14×" { scenario: Proposed; underTarget: 14 }
expect { component: db; notFull: 100 }
```

`underTarget` holds while everything (or `component`) stays under the 50 % target, `notFull` while nothing runs out
(100 %); without a `scenario` the defaults are checked. Before loadmap 1.1 they were `target` and `full`: from 1.1 those
warn, and `loadmap fmt` renames them. A load multiple may say its unit, `underTarget: 7×`. The editor marks a failing expectation as a warning on its line and still
draws the diagram. `loadmap check` fails on it, so a change that loses headroom cannot land unseen:

```bash
loadmap check examples/checkout/checkout.loadmap      # exits 1 when an expectation fails or the file has an error
```

```text
checkout.loadmap:29:1 error[expect-failed]: "Today keeps 12×" fails: expected at least 12×, but the 50 % target holds up to between 7.4× and 10×, limited by the API gateway (capacity estimated ±30 %)
  29 | expect "Today keeps 12×" { underTarget: 12 }
     | ^^^^^^^^^^^^^^^^^^^^^^^^
checkout.loadmap: 1 of 2 expectations failed
```

Each expectation ends **pass**, **fail** or **inconclusive**. It is inconclusive when the answer rests on what is not
known: it holds at the high edge of a ± but not at the low one (`underTarget: 8` above, between 7.4× and 10×), a
component has no published benchmark, or measured data it reads is missing or too thin. The line says why, and
`loadmap check` reports it as a warning; `--inconclusive fail` makes it fail the run. `severity: warn` makes an
expectation a warning whatever it finds: it is reported, and never fails the run.

```loadmap
expect "Black Friday keeps 3×" { scenario: Proposed; underTarget: 3; severity: warn }
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
            | select(.user.login == "github-actions[bot]" and (.body | startswith("\u003c!-- loadmap-check -->"))) | .id' \
            | head -n 1)
          if [ -n "$id" ]; then
            gh api -X PATCH "repos/$REPO/issues/comments/$id" -F body=@comment.md
          else
            gh api "repos/$REPO/issues/$PR/comments" -F body=@comment.md
          fi
```

Make `check` a required status check in the branch's rules, and a failure blocks the merge. Notifications beyond the
comment (Slack, email) go through the CI's own means: a step after the check with `if: failure()`.

**Drift** is what moves in the data while no line of the definition does: a slower query, a cache that hits less, a
cost per request that grew. `loadmap drift` looks for it in a snapshot, against main's own history:

```bash
loadmap drift capacity.loadmap --pull --window 1d --history history/ --markers deploys.json --issue issue.md
```

```text
capacity.loadmap: 3 drifts, 2026-11-12T04:00:00Z to 2026-11-13T04:00:00Z, against 30 past runs
  ✗ dbWrites shifted +23 % from the run of 2026-11-09T04:17:00Z: 410 → 504 writes/s (p 4.1e-12), after deploy 4f2a1c
  ✗ API CPU per request: a slope of 0.003, above the band of the last 30 runs (0.00191 to 0.00209)
  ✗ headroom: the target at 5.7×, below the band of the last 30 runs (8.8 to 10.1)
```

- **Change points**, as Apache Otava finds them: each measurement's value across main's runs, one a run, is split
  where its energy statistic peaks (E-divisive), and a split is kept only when Welch's t-test between its two sides is
  below `--p-value` (0.001). One value a run, not the points inside a window: those are too alike, and a day's shape
  is no shift. A shift needs five runs on either side, and is reported while it is in the last seven. `--markers`
  names the latest deploy before it, since the run before. Deterministic: the same data gives the same report.
- **Two windows**, as Kayenta judges them: each series against the last run's, by a Mann-Whitney U test at
  `--confidence` (98 %), with a `--dead-zone` (5 %) so a tiny shift never counts. Only the points the last run did not
  read are compared: what both windows hold is no evidence either way.
- **Main's own history**, as Bencher sets its thresholds: each measured value, each fit's slope (the cost per unit)
  and the first limit's headroom, against the band of the last `--runs` (30) snapshots in `--history`, once there are
  `--min-runs` (5). `--test` builds it: `t_test` (the default, at 99 %), `percentage` (± 10 %) or `iqr`. A slope counts
  only above its band and headroom only below: a cheaper request or more room is no drift.

It exits 1 when something drifted and 3 when it cannot look: a definition with an error, a snapshot it cannot read or
with no data at all (a provider down, a token expired), a file it cannot write. A scheduled job opens an issue for a
drift and fails for a broken run, and nobody's pull request fails for either. `--json` writes the result, and `--issue` the body of
an issue a workflow opens and keeps up to date. A nightly one, keeping the history in the Actions cache:

```yaml
# loadmap drift every night on main: what moved in the measured data, in one issue kept up to date
name: capacity drift
on:
  schedule:
    - cron: "17 4 * * *"
  workflow_dispatch:

permissions: {}

jobs:
  drift:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      contents: read
    outputs:
      drifted: ${{ steps.drift.outputs.drifted }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 24
      - run: npm ci # @loadmap/cli pinned by the lockfile
      # main's past snapshots, as the last night left them
      - uses: actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
        with:
          path: history
          key: capacity-history-${{ github.run_id }}
          restore-keys: capacity-history-
      - id: drift
        env:
          LOADMAP_PROMETHEUS_URL: ${{ secrets.LOADMAP_PROMETHEUS_URL }}
          LOADMAP_PROMETHEUS_TOKEN: ${{ secrets.LOADMAP_PROMETHEUS_TOKEN }}
        run: |
          mkdir -p history
          now="history/$(date -u +%Y-%m-%dT%H%MZ).snapshot.json"
          set +e
          npx loadmap drift capacity.loadmap --pull --window 1d --out "$now" --history history \
            --issue issue.md --json drift.json
          code=$?
          set -e
          # 0: nothing moved, 1: a drift, for the issue; anything else is a broken run, and fails here
          case "$code" in
            0) echo "drifted=false" >> "$GITHUB_OUTPUT" ;;
            1) echo "drifted=true" >> "$GITHUB_OUTPUT" ;;
            *) exit "$code" ;;
          esac
          # sixty nights are history enough
          ls history/*.json | sort | head -n -60 | xargs -r rm --
      - uses: actions/cache/save@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
        with:
          path: history
          key: capacity-history-${{ github.run_id }}
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: capacity-drift-${{ github.run_id }}
          path: |
            drift.json
            issue.md

  issue:
    needs: drift
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      issues: write
    steps:
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: capacity-drift-${{ github.run_id }}
      - env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
          DRIFTED: ${{ needs.drift.outputs.drifted }}
        # one open issue, found again by its title and its author: updated on a drift, closed on a quiet night
        run: |
          title="Capacity drift in capacity.loadmap"
          n=$(gh issue list --state open --author "app/github-actions" --search "\"$title\" in:title" \
            --json number --jq '.[0].number // empty')
          if [ "$DRIFTED" = true ] && [ -n "$n" ]; then
            gh issue edit "$n" --body-file issue.md
          elif [ "$DRIFTED" = true ]; then
            gh issue create --title "$title" --body-file issue.md
          elif [ -n "$n" ]; then
            gh issue close "$n" --comment "$(cat issue.md)"
          fi
```

### Published figures

A **published** statement takes a capacity from the component catalog: the figure published for a component, under
the conditions its run was made with. One entry per component, whoever runs it: Apache Kafka, RabbitMQ, Valkey
(Redis-compatible), etcd, CockroachDB, ClickHouse, OpenSearch (Elasticsearch-compatible), NGINX, HAProxy, CoreDNS,
Kubernetes and Istio, and PostgreSQL, MySQL, MongoDB and Envoy, for which nothing is published with its conditions.

```loadmap
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

```loadmap
metric served "Requests served" {
  prometheus { query: 'max_over_time(sum(rate(http_requests_total{job="{{ args.job }}"}[5m]))[7d:5m])' }
  stat: max
  minSamples: 30
}
measure apiCapacity served { job: "api"; fallback: estimated(1_000, "req/s", "vendor benchmark") }
measure orderRate served { job: "orders"; fallback: 40; unit: "orders/s" }

# capacity: apiCapacity    rate: orderRate * load
```

`{{ args.job }}` is filled by each measure's `job`, so one metric serves several components; the checker names an
argument the query needs and one it never uses. `stat` says how the window becomes one value (`mean` by default) and
`minSamples` how many samples it needs before it counts. A `fit` with `x` and `y` naming two measures is fitted from their
series when there is a snapshot, and from its own `points` when there is none. A value read from a snapshot is
today's system's: it does not change with the parameters.

A metric can read from **Elasticsearch** or OpenSearch instead: the documents of an index, counted or aggregated at
each step of the window. `agg: rate` (the default) is documents per second, `count` documents per step, and `avg`,
`sum`, `min` and `max` read a `field`. The `query` is Elasticsearch query JSON that picks the documents, an argument
inside its texts (filled in escaped, so a measure's word never changes the query's shape), and `time` names the time
field (`@timestamp` by default). A window where nothing matches is missing, not zero:

```loadmap
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

```text
shop.snapshot.json: 1 of 2 measurements, 2026-11-01T06:00:00Z to 2026-11-08T06:00:00Z
  ✓ apiCapacity: 1,200 req/s (2,016 samples, max)
  ✗ orderRate: the query returned 3 series: sum them into one
```

The window ends on the step's grid, so two pulls in the same step read the same points. A query that fails, or a
window with fewer samples than `minSamples`, leaves that measurement missing: the model uses the fallback, and the
assumptions say why. A host compiles with the snapshot, `compile(source, { snapshot: fromSnapshot(parseSnapshot(text))
})`; without one, every measure is its fallback.

In TypeScript, `parseSnapshot` checks the file (an opened file is untrusted input) and `fromSnapshot` reads it inside
the model's functions. Every read names the value the definition uses when the snapshot has none: a measurement that
is missing, or has fewer samples than its `minSamples`, falls back to it, never to an invented one, and the assumptions say
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
yet (the wait for a slot) is read and listed, and nothing uses it.

<!-- measures: written from MEASURES in packages/core; UPDATE_DOCS=1 pnpm test:node rewrites it -->

| Kind | Measurement | Role | Dimension | Sets | |
| --- | --- | --- | --- | --- | --- |
| `flow` | `rate` | rate | per second | `rate` | Units per second at the source. |
| `pass` | `served` | rate | per second |  | Units handled per second. |
| `pass` | `rejected` | rate | per second |  | Units turned away per second (429, 503). |
| `pass` | `capacity` | capacity | per second | `capacity` | The most it handled: a load test or a saturated peak. |
| `pass` | `instances` | count | count |  | Instances serving. |
| `pass` | `latencyP50` | latency | ms |  | Median response time. |
| `pass` | `latencyP95` | latency | ms |  | 95th percentile response time. |
| `pass` | `latencyP99` | latency | ms |  | 99th percentile response time. |
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
| `store` | `connections` | count | count |  | Connections open: a pool of slots (see slots). |
| `fanout` | `copies` | share | per unit | `share` | Copies sent per unit, per branch. |
| `fanout` | `deliveries` | rate | per second |  | Copies delivered per second, per branch. |
| `split` | `share` | share | share | `share` | The share of units sent each way. |
| `slots` | `inUse` | count | count |  | Slots in use: connections, sessions, in-flight requests. Over the rate, the time each is held. |
| `slots` | `available` | capacity | count | `capacity` | Slots there are. |
| `slots` | `held` | duration | seconds | `held` | How long each is held. |
| `slots` | `wait` | duration | seconds | not modelled yet | The wait for a free slot. |

<!-- end of measures -->

### Building blocks

Four shapes of real systems have statements of their own, so a model says what they do instead of working it out in
formulas. Each has a template to start from.

**What reaches a stage.** `at.db.reads` is the rate of `reads` reaching the stage `db`, and `at.db` every flow's. It
is the flow's rate, less what a cache answered and what a rate limiter turned away before it; an overloaded `pass`
does not cut it, so each component's limit stays the one it has if what is in front keeps up. A component without a
`demand` line handles what reaches its stages, in units per second:

```loadmap
node db "Database" {
  store
  capacity: estimated(3_000 ± 30%, "queries/s") # no demand: the misses the cache lets through
  over: "queries queue on the primary"
}
```

**A cache** answers a share of the units and sends them back where they came from; the rest carry on. With capacity
lines it is a component too, and past capacity it rejects like a `pass`:

```loadmap
node sessionCache "Cache" {
  cache { hit: hit }
  capacity: estimated(50_000, "ops/s")
  over: "lookups time out and fall through"
}
```

**An autoscaled pool** adds pods while the running ones are above `target`, between `min` and `max`. Its capacity is
the pool at `max` pods, so it runs out where it cannot grow further; the box draws every pod it may run and dashes
the ones it does not run now, and a meter counts them:

```loadmap
pool api "API" {
  perPod: 4
  autoscale { min: 2; max: maxPods; target: 0.7 }
  demand: flows.requests * 5ms
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

```loadmap
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

**A lost box** is where what other boxes lose goes, counted. A unit a stage turns away (a limiter above its limit, a
pass, cache or split past capacity), one a queue drops as too old, or one too slow for its client at the end of its
way leaves the diagram there; with a lost box, its dot goes along the edge into it and fades inside. An edge from a box
into a lost box sends what that box loses there, and `takes` keeps only some losses (`rejected`, `dropped`,
`timedOut`; all three without one):

```loadmap
node tooMany "Turned away" { lost { takes: [rejected] } }
limiter -> tooMany
```

`at.tooMany` is what reaches it, units per second lost for good: with retries, only what fails every attempt (a
retried unit's attempt fades where it was turned away, and its retry starts again at the source). A queue's drops are
what its reader cannot drain, in steady state. The box is drawn dashed in the colour of a loss and says its rate on its
second line ("120 rejected/s") unless it has one of its own; a lost box is on no route. In TypeScript,
`lost({ from: ['limiter'], takes: ['rejected'] })`, with a node for it and `edge('limiter', 'tooMany')`.

A loss the definition plans and no lost box counts is a warning: what a limiter turns away, what a `drop` rule drops,
what a `timeout` fails. The editor's quick fix adds the lost box after the box and the edge into it. A pass, cache or
split past capacity warns nothing: any of them could, and the bars and their `over` line already say so.

A `merge` loses nothing: the newer unit of the key carries it. On the board a merged dot shrinks into a ripple of its
flow's colour where it waited, so a queue that keeps only the newest shows it.

**A split** sends each unit on one way of several, by share: a read/write split, shards, regions, an A/B test,
failover. One line per way, the flow, the stages it goes through and its share; a flow's shares add up to 1, and a
flow the split names on no line goes straight on. A way that ends in a store, a sink or a fan-out ends there; any
other goes on with the route after the split, so reads can return through the API they came from:

```loadmap
node router "DB router" {
  split {
    orders -> primary: 1 - reads
    orders -> replica: reads
  }
}
```

With `route: gateway -> app -> router -> respond`, writes end at the primary and reads go through the replica to
`respond`. Each component then sees the share of the flow that goes its way: `at.replica.orders` is the reads, and a
replica past capacity turns away only the reads. In TypeScript, `split({ to: [{ stages: ['primary'], share: 0.2 },
…] })`, and `ev.paths` lists each flow's ways with their shares.

**A pool of slots** runs out of slots, not of rate: connections, sessions, threads, requests in flight. `held` says
how many seconds each unit holds one, and the demand is then the slots in use, by Little's law: what reaches its
stages each second times `held`. Its capacity counts slots. A pool beside the limit that runs a stage names the stage
with `on`:

```loadmap
component conns "Postgres connections" {
  on: db
  held: 20ms
  capacity: configured(100, "connections", "pool size")
  over: "orders wait for a connection"
}
```

At 40 orders a second, 0.8 connections are in use; the pool reaches half at 62.5×. Flows that hold a slot for
different times take a block, `held { orders: 20ms; sessions: 1h }`, and a flow it does not name holds none. A
slower query raises `held`, so a formula such as `held: queryMs / 1_000` moves the limit with it. In TypeScript,
`held` and `on` sit on the component, and `ev.components.conns.held` gives each flow's time.

**A connection** says how a stage reaches the next one on a route, and through which part of it. In a Kafka consumer
group each partition is read by one consumer only: `assign: exclusive` deals the partitions of the queue in front to
the workers of the pool after it, in turn, alternating pods. Workers beyond the partitions read nothing, and the
component runs out when its busiest member does:

```loadmap
connection group {
  hop: topic -> pool
  assign: exclusive
  capacityPer: pod
}
```

`capacityPer` says what the capacity divides over. Per worker, each handles one unit at a time: 12 partitions on 16
workers leave 4 idle, the pool runs out at 75 % of its capacity, and a fifth pod adds nothing. Per pod, the workers
of a pod share its CPU, so idle threads cost nothing, but a pod with fewer partitions than another does: 6 partitions
on 4 pods read 2, 2, 1 and 1. `owner: pod` gives each partition to a pod instead of a worker. A connection changes no
rate, demand or capacity: the limits list says what it does ("The busiest pod reads 2 of 6 partitions"), and an
autoscaler still sees the pool's average. On the board each unit goes to the worker that reads its partition, a worker
that reads none is dashed and stays idle, and a partition a quieter worker reads waits less of the queue's lag; the
latency times each group of workers at its own utilization. Between two stages that are not a queue and a pool,
`parts` and `members` give the counts: `parts: 16; members: 4` for a sharded store. `flows: [orders]` covers some
flows only, so two flows on one hop can follow different rules; `shared` (the default) is any member taking any unit.
In TypeScript, `connections: { group: { from: 'topic', to: 'pool', assign: 'exclusive' } }`, `ev.components.pool.spread`
gives the factor and the line, and `ev.stages.pool.assignment` the worker that reads each partition.

A connection also counts what it holds open. `open` is the connections each member of the pool on the hop keeps to
the other side (per pod with `owner: pod`), and `accepts` the most that side accepts, a capacity like any other. Together
they make a limit of their own, named by the connection, "Connections to db": the members running times what each
keeps open, added up over every connection into the stage:

```loadmap
connection dbPool {
  hop: api -> db
  owner: pod
  open: 20
  accepts: configured(100, "connections", "max_connections")
}
```

An autoscaled pool opens more as it adds pods, so this limit runs out at a load: 20 a pod reach 100 at the fifth pod.
One connection into a stage gives `accepts`; the others into it only `open`.

The stage a connection reaches can be uneven too. `assign: key` sends each unit to the part its key hashes to,
partition i of each flow on member i mod `members` of that stage (a cluster's queue takes the cluster's members):
12 partitions on 5 brokers put 3 on the busiest, which runs out at 80 % of the cluster's capacity. `skew` is the share
of a flow on its hottest key, measured or estimated, and on the board that share of the dots lands on partition 0.
`assign: leader` sends every unit to one member: a Raft leader, a primary. Both apply to a capacity you measured or
estimated for the whole stage; a published figure keeps its number, since its run spread the work its own way, and
the limits list says what the key would have done:

```loadmap
connection produce {
  hop: gateway -> topic
  assign: key
  skew: estimated(0.25, "share", "busiest customer")
}
```

The catalog says how callers connect to each of its components, from their documentation: `rule:
"kafka/consumer-group"` gives a connection that rule's `assign` and `owner` (what the connection writes wins), and
the assumptions cite its source. Autocomplete lists every rule. A setting's documented default is a figure taken by
its name only, never matched to a configuration: PostgreSQL's 97 connections (its 100, less the 3 kept for
superusers) are `published dbMax postgresql { edition: "2026-12"; figure: "max-connections" }`, for `accepts: dbMax`. In TypeScript, `rule(kafka, 'kafka/consumer-group')` and
`published(postgresql, { figure: 'max-connections' })`.

**Latency** comes from service times. `service` on a component is the seconds a unit takes there when nothing waits;
each stage it runs is then a queue whose time grows as `service ÷ (1 − utilization)`, so it doubles at half and has
no end at 100 %. A flow's time through is the sum of its stages (a cache's hits leave there, a split's ways mix by
share), and `ev.latency.orders` gives its mean, p50, p95 and p99. The limits still say when a box runs out; the
latency says how slow it gets on the way, and the Live panel shows each flow's p99.

```loadmap
node api "API" {
  pass
  capacity: measured(2_000, "req/s")
  service: 10ms
  over: "clients wait"
}

expect "Searches answer in 150 ms to 10×" { flow: searches; p99: 150ms; underTarget: 10 }
```

The expect holds when the p99 stays under 150 ms up to 10× on the pessimistic edge (every capacity at its low
bound); without `underTarget`, at the values. It is a single queue per stage (M/M/1) fitted over the way, an estimate of
the shape, not a measurement. To set a service time from data, take a measured p99 at today's utilization: a single
queue's p99 is `service × ln 100 ÷ (1 − utilization)`, so `service: latencyP99 / 1_000 * (1 - 0.4) / 4.6` for a p99
in ms at 40 %.

A **timeout** on a flow (`timeout: 2s`) turns its latency into failures: the units slower than it fail, as
if the client gave up, though the work they set off still uses its capacity. With `retry` they come back as attempts,
which load every stage again and make it slower still: a timeout storm. The retries settle where the share too slow
gives back the same attempts, the least such point, and past the knee there is none below what the retries allow.
`ev.latency.orders.timedOut` is the share, the Live panel shows it, and the dots that time out fade where they end. A
timeout needs a latency: a `service` on the flow's way.

### A story

`step` lines walk a reader through the model in order: what to look at, and the values to show it at. Each step starts
from the defaults (or from its `scenario`), then takes its own values, so it looks the same whichever step came before.
`focus` outlines a component's box:

```loadmap
step "An ordinary peak: every box is under half its capacity." { load: 1; title: "An ordinary peak" }
step "At 20×, the gateway and the workers are near full." { load: 20; focus: gateway }
step "The proposal doubles both: at 20× they are back under half." { scenario: Proposed; load: 20; focus: workerPool }
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
moves a box, and a step looks the same whichever came before. `view { layout: stable }` gives every box one place instead, the largest it needs anywhere the model
reaches (its scenarios, steps, presets and controls): no step moves a box, a pool that gains pods grows where it
stands, and every step pays for the room of the largest. `view { transition: 1.2 }` makes a change take 1.2 seconds (0.8 by
default; 0 cuts, and so does a reader who asked for reduced motion). A recording shows it too.

### Direction and tiers

The diagram runs the way that fits the room it is drawn in larger: a long chain runs right in a wide frame and down in
a tall one. Where both fit about as well it runs right, or down when it fans out wider than it is long: when its
widest layer has more boxes than its longest chain. Every edge counts, whatever its `when`. Only the room and the
structure turn it, never the values. `view { direction: right }` or `direction: down` holds it, `direction: auto`
says the default out loud, and narrow screens always run down. (`layout: right` and `layout: down` at the top, its old
name, are errors from `loadmap 1.5` and warn before it; `loadmap fmt` rewrites them.)

A long diagram is folded where its titles would be hard to read in one row: into two or three rows one under the
other (columns side by side, running down), cut between two tiers where it can, each row with its own lanes, an edge
to the next row going round the end of its row. `view { rows: 1 }` never folds, and `rows: 2` draws two wherever there is
room: a narrow screen never folds, and a diagram with one layer has one row.

The boxes nothing feeds stand first and the sinks and stores that feed nothing stand last. To cut the diagram into
bands across the flow (edge, services, data), declare tiers in the order the flow meets them and put a box in one:

```loadmap
tier edge "Edge"
tier services "Services"
tier data "Data"

node gateway "Gateway" { tier: edge; pass }
pool api "API" { tier: services; pods: pods; perPod: 8 }
node db "Database" { tier: data; store }
```

Each tier is a lane behind its boxes: filled in two alternating shades, a line between them, and a header with its
name in capitals at the lane's start, a strip across the top (a column on the left running down, and on a phone, the
name reading up). A name wider than its lane takes two lines, and every header on the board then takes two. A box
without a tier stands in the tier of the boxes that feed it, or of those it feeds when nothing feeds it, so a
definition names the tier where it changes. In TypeScript:
`tiers: { edge: { label: 'Edge' }, … }` in the view, `tier: 'edge'` on a box.

`view { lanes: striped }` leaves every other lane clear. A tier can have a colour of its own, and one for the dark theme;
without it, dark keeps the colour's hue as dark as the theme's lanes, and a dark one alone leaves light the theme's. A colour is `"#rrggbb"`, `"rgb(…)"` or
`"hsl(…)"`, nothing that fetches:

```loadmap
tier data "Data" { fill: "#e6f2ec"; fillDark: "#1c2b26" }
```

In TypeScript: `lanes: 'striped'` in the view, `fill` and `fillDark` beside a tier's `label`. The page's theme sets
the shades: `--lm-tier-base` for the first, third… lanes, `--lm-tier` for the others. In the editor, **View** switches
the lanes' fills (a line of the text) and the dot grid behind the diagram (the editor's own setting, kept in the
browser: before `loadmap 1.5` a file could say `view { grid: false }`), and the model's tab gives each lane its colours.

### The view block

What only changes how the page looks and plays stands in one block, `view { … }`: `direction`, `rows`, `layout`,
`speed`, `transition`, `fullScreen`, `fullScreenMode` and `lanes`. Nothing in it changes a number, so a reviewer of a
change to the model can skip it. The block is from `loadmap 1.2`, and `direction`, `rows` and `layout` joined it in
`loadmap 1.5`; a file stamped before writes those settings at the top, as it always did. A setting at the top of a
file whose version has it in the block warns (an error from `loadmap 1.5`), and `loadmap fmt` moves it there, with
`layout: right` as `direction: right`.

### Full screen

The diagram's **Full screen** fits the screen without scrolling: the diagram as wide as it, and below it the panels
of the page in a compact form, each of which opens whole. `fullScreen` keeps only the ones it lists:

```loadmap
view { fullScreen: [verdict, live, controls] }
```

The names are `verdict`, `live` (the meters), `limits` (where it runs out, in order), `controls`, `headroom`,
`compare` (the scenarios side by side) and `assumptions`. `<Loadmap fullScreen={[...]}>` takes the same list.

A switch in full screen, or the F key, turns it into **focus**: the diagram, the story, and the verdict and the load
slider when `fullScreen` lists them. `view { fullScreenMode: focus }` opens full screen there
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
and a block written on one line stays on one line while it fits in 120 columns. From `loadmap 1.2` a `"…"` text that
runs past them is broken at a space into pieces, one under the other, and pieces that fit are one text again. `format(source)` from `@loadmap/dsl`
does the same in code; a text with a syntax error comes back unchanged, with its diagnostics.

### Several files

A definition may be written in several files (from `loadmap 1.3`). A file says what it is in its head, the lines
straight under `loadmap`, before any other statement:

- **A model** is what you open, draw, check and record: the file with the one `load`. Its head names every other file
  it needs, so the files of a model are always the ones its text names, never the ones a folder happens to hold.
- **A part** (`part of "./shop.loadmap"`) belongs to one model, which includes it (`include "./shop.story.loadmap"`).
  Its statements are the model's, as if written there: one namespace, so a part names the model's boxes and the model
  a part's. A part holds anything a model does but what there is one of (`load`, `view { … }`, `title` and the other
  properties of the top) and the head. It says its model's version. A natural home for the story, the measured points
  of a fit, or the expectations.
- **A library** (`library "Platform building blocks"`) holds what several models share: values (`let`, `fit`,
  `metric`, `measure`, `tier`, `published`), boxes and subsystems. It is checked on its own, draws nothing, has a
  version of its own, and reads nothing of the model that imports it. A name that starts with `_` stays in its file.
- **A variant** (`extends "./shop.loadmap"`) is its model with what it writes changed: a `param` here replaces the
  lines it writes of that parameter, a `let`, `fit`, `measure`, `metric` or `published` replaces the one of its name,
  and presets, scenarios, expectations and steps are added. The flows, the boxes and the edges are the model's.

```loadmap
# shop.loadmap
loadmap 1.5
include "./shop.story.loadmap"
import "./platform.loadmap" { postgres; pipeline }

title: "A shop in several files"
# …
```

**A path** is relative to the file that writes it (`./`, `../`) or starts at the project root (`/lib/x.loadmap`), and
ends in `.loadmap`. It is never a URL. The compiler reads no disk and no network: the page, the editor or the command
hands it the files (`compile(source, { path, files })`), and a path they do not have is an error where it is written.
`loadmap check` and the language server read nothing outside the project root (the git checkout, else the working
directory; in an editor the workspace folder). A definition has at most 64 files and a million characters.

**An import names what it takes:** `import "./platform.loadmap" { postgres; pool: podPool }`. `a` is used here under
its own name, `local: theirs` under another. There is no "everything": a library that adds a name never changes a
model. Libraries may import libraries, never in a loop.

**A box with inputs** is a prototype. In a library, a box says what it needs from the model with `input`, and a box of
the model says `like:` and sets them in `with { … }`:

```loadmap
# platform.loadmap
node postgres "Postgres" "primary" {
  input writes
  input limit = 4_000
  store
  demand: writes
  capacity: estimated(limit ± 30%, "commits/s", "load test of the primary")
}

# shop.loadmap
node db "Postgres" "primary" { like: postgres; with { writes: flows.orders } }
```

An input without a default must be set; a value in `with` is a formula of the file that writes it, of the type its
default has (a number for a number), and where both say a unit, the same one: `wait: flows.orders` for an
`input wait = 20ms` compiles with a warning. The lines of the
prototype read only its inputs and its library's own names: `load`, a parameter or a flow of the model reach it only
as an input. `input flow main` takes the name of a flow instead of a value, for `flows.main`, `at.topic.main` and
`partitions { main: 12 }`; the model sets it with `main: orders`. The rules of `like:` are the same as in one file: a
line written here replaces the same line there.

**A subsystem** is several boxes as one: boxes, components, connections, the edges between them and `let`s.

```loadmap
# platform.loadmap
subsystem pipeline "Queue and workers" {
  input flow main
  input pods = 3
  cluster kafka "Kafka" { members: 3; queue topic { partitions { main: 12 } } }
  pool consumers "Workers" {
    pods: pods
    perPod: 8
    demand: flows.main * 2ms
    capacity: measured(pods * 1, "cores", "pod CPU limit")
  }
  kafka -> consumers
  route: topic -> consumers
}

# shop.loadmap
subsystem orderLine "Orders" { like: pipeline; tier: services; with { main: orders; pods: pods } }
flow orders "orders" { rate: 40 * load; route: gateway -> orderLine -> db; from: phones }
gateway -> orderLine
orderLine -> db
```

Outside it, each thing a subsystem holds is named `<id>.<name>`: `orderLine.consumers` in a `focus`, an `expect`, a
route, an edge, `util.orderLine.consumers`, `at.orderLine.topic.orders`. With a `route:` of its own, a flow's route and
an edge may name the subsystem itself: the flow passes the stages of that route, an edge to it ends at the box of the
first and an edge from it starts at the box of the last. `tier:` on the subsystem is the tier of every box in it that
names none. A subsystem written in a model is drawn as it is, and another may be `like` it; subsystems may hold
subsystems, four deep, and a definition has at most 256 boxes once they are written out.

On the board a subsystem is a frame around its boxes with its name at the top: its own, else that of the subsystem it
is like, else its id. A subsystem in another is a frame in that one's frame. The frame's line takes the colour of the
worst box inside once one is past its target, so a glance says which subsystem to look into. A frame cannot cross a
lane: with tiers, a subsystem whose boxes stand in several tiers is drawn without one, and the subsystems in it keep
theirs. A subsystem that holds no box draws nothing.

A subsystem can be drawn closed (from `loadmap 1.5`): one box that stands for everything inside it. The box takes the
colour of the worst component inside, names the busiest one on its second line, and wears the limit when the first
limit is inside ("LIMIT · 12×"), so a board of closed subsystems says which one to open. The reader opens one with a
click on it and closes one with a click on its name; a subsystem in a closed one is closed with it. `view { closed:
[eu, us] }` says which the page starts with, and a step says its own: `step "…" { closed: [us] }`, or `closed: []` for
every one open. Closing changes no number: the dots still pass every stage inside.

On a board that zooms, a click on a frame flies in to it, and the path to where the view is shows over the board
("Whole diagram › EU region › Orders"); each step of it flies back out. Copies of one subsystem name their components
alike, so each such name takes the names of the subsystems around it that tell the copies apart: the verdict says
"limited by EU region › Workers" and "the workers in EU region", while the box itself still reads "Workers" in its
frame. A name no other component has stays as written.

In the editor, the files' explorer lists under each file the subsystems it declares, one in another indented under
it; a click opens the file at that subsystem's line.

A problem is reported in the file that can fix it: a library's own mistake in the library, a wrong or missing input
at the box that sets it. `loadmap check` prints each with its file (`--format json` adds `file` to a diagnostic that
is not in the checked file). `loadmap fmt` on a model sets its parts' `loadmap` lines to its own. `loadmap bundle
shop.loadmap` writes the definition as one file that draws and computes the same, for a host that reads one file. What
it keeps of a subsystem is its first line (`subsystem orderLine "Orders"`, no block): the frame around the boxes named
`orderLine.…`. A share link carries every file (`#v2.`); a definition in one file keeps making the `#v1.` link every
page reads.
`docs/multi-file/` holds a model with a part, a library and a variant; `examples/checkout/split/` and
`examples/alerts/split/` are the two examples in several files, each held to the same TypeScript model, and
`examples/regions/` is written in several files from the start: two regions as copies of one subsystem of a library.

## Errors

Every error has a line and a column, and parsing goes on after one, so a file shows all its problems at once. Each
mistake is marked once, where it is: what it breaks further on (the uses of a name its line would have declared, a
property whose value does not parse, a list with a wrong word) is not marked again. Names that are almost right get a
suggestion:

```text
checkout.loadmap:104:17 error[unknown-name]: unknown flow "order"
  104 |   demand: flows.order + flows.events
      |                 ^^^^^ did you mean "orders"?
```

`compile` also runs the model at its defaults, at every preset and in every scenario. A formula that fails there,
such as a loop between two `let`s, is marked where it is written.

Each diagnostic has a code in brackets: the kind of problem, which stays when its message is reworded. Quick fixes
key on it, and so can a script: `loadmap check --format json` gives every diagnostic its `code`, `hint`, and where its
span ends (`endLine`, `endColumn`, the column after its last character).

<!-- codes: written from CODES in packages/dsl; UPDATE_DOCS=1 pnpm test:node rewrites it -->

| Code | |
| --- | --- |
| `syntax` | the text does not parse: a character, a token or a line out of place |
| `too-large` | the definition, a block, a formula or a template is larger or deeper than loadmap reads |
| `language-version` | the "loadmap" line is missing, misplaced, or names a version this loadmap does not read |
| `unknown-name` | a name that nothing declares: a flow, stage, node, component, parameter, function, … |
| `unknown-property` | a property the statement does not have |
| `unknown-statement` | a statement the place does not have |
| `misplaced` | a statement or property in a place it does not belong |
| `duplicate` | something set, declared or listed twice |
| `reserved-name` | an id that loadmap keeps for itself |
| `shadowed-name` | an id that names two kinds of thing, or is also a keyword of the language |
| `missing-property` | a required property is missing |
| `missing-part` | a required statement, argument or block is missing |
| `unknown-unit` | a number with a suffix that is not a unit: 5sec |
| `wrong-type` | a value of the wrong type |
| `chained-comparison` | comparisons written as a chain: 1 < load < 3 |
| `bad-value` | a value of the right type that the property does not take |
| `out-of-range` | a number outside the range the property takes |
| `wrong-scope` | a formula reads what its place may not read |
| `wrong-arguments` | a function called with the wrong number of values |
| `bad-formula` | a formula that uses a table, a function, a list or "±" where they do not go |
| `glued-percent` | a "%" straight after a number and before a value: the remainder, where a share was likely meant |
| `unit-mismatch` | a demand, capacity or property whose unit differs from the one it should have |
| `empty-unit` | a capacity whose unit is empty |
| `bare-capacity` | a capacity without measured(…), estimated(…) or configured(…) |
| `colon-before-block` | an edge written "a -> b: { … }" |
| `missing-edge` | a flow goes from one box to another that no edge joins |
| `reversed-edge` | a flow goes from one box to another against their edge |
| `hidden-edge` | an edge hidden by its when while a flow still goes that way |
| `unseen-loss` | what a stage loses reaches no lost box |
| `bad-lost` | a lost box that takes nothing, feeds on, or takes what another lost box takes |
| `bad-box` | a box whose stages and component do not fit together |
| `bad-route` | a flow's route, hops, ways or branches that do not fit its stages |
| `bad-edge` | an edge with a property or label it cannot have |
| `bad-param` | a parameter whose options, range or default do not fit |
| `bad-scenario` | a scenario or preset that sets what it cannot |
| `bad-expect` | an expectation without a target, or with one that does not fit |
| `bad-step` | a story step that sets what it cannot |
| `bad-fit` | a fit whose points or measures do not fit |
| `missing-file` | a file a definition names is not among the files it was given, or its path is not one |
| `import-loop` | libraries that import each other in a loop |
| `bad-file` | a file used as what it is not: a part that is not of this model, a model imported as a library |
| `bad-input` | an input of a prototype or a subsystem that is not set, is set twice, or does not exist |
| `bad-metric` | a metric, measure or query that cannot be read |
| `bad-rate` | a flow whose rate is not a finite number from 0 up at some values |
| `bad-demand` | a component whose demand is not a finite number from 0 up at some values |
| `unused-stage` | a stage no flow passes |
| `unused-component` | a component no stage uses or holds |
| `tier-order` | an edge that runs back against the tiers |
| `deprecated` | an old spelling: loadmap fmt rewrites it |
| `removed` | a statement or a property a language version dropped: what to write is in the hint |
| `remainder` | a "%" between two values, the remainder: mod(a, b) from loadmap 1.5 |
| `catalog-not-loaded` | the definition names the component catalog, and the host did not load it |
| `no-benchmark` | no published run matches the configuration: the component is not ranked |
| `newer-edition` | a later edition of the catalog has other figures for the component |
| `runtime` | a formula that fails when it is computed |
| `model` | the model refuses the definition |
| `expect-failed` | an expectation that does not hold |
| `expect-inconclusive` | an expectation that holds only at the high edge of a ±, or rests on missing data |
| `against-base` | a component's verdict changed against the base the check compares with |
| `unreadable` | loadmap check cannot read the file, its snapshot, or a provider it needs |
| `internal` | a bug in loadmap |

<!-- end of codes -->

## Versions

The first line names the language version a definition is written in: `loadmap 1.5`, a major and a minor (`loadmap 1`
is 1.0, and `1.10` comes after `1.9`). A loadmap reads every version up to its own; one older than the file says
"update @loadmap/dsl" instead of half working.

**The rule.** A file that compiled under its version keeps compiling, and computes the same limits, verdict and
expectations, on every later loadmap with the same major:

- A change that refuses a file the last release read, or changes what it computes, comes with a new minor version. A
  file stamped before it gets a **warning** that says "(an error from loadmap 1.N)", with a quick fix where one
  exists, and keeps its old meaning; from 1.N on it is an **error**.
- An old spelling keeps working and warns, and `loadmap fmt` rewrites it (`layout: right` became `direction: right`).
- A new statement, property or syntax also comes with a minor version: a file that uses it says that version or a
  later one (an error with a quick fix otherwise), so a loadmap too old for it says "update" instead of "unknown
  statement". `loadmap fmt` raises the first line to the lowest version that has everything the file uses, and never
  lowers it.
- A new warning, a change to how the diagram is drawn, and a fix of a figure that was wrong (a unit counted twice)
  need no version; the fix says so in its release notes.

A new definition starts at the newest version, which has every check. A major version, `loadmap 2`, would be a change
with no warning first; none is planned.

| Version | Added | Strict from here |
| ------- | ----- | ---------------- |
| 1.0 | the language as @loadmap/dsl 0.32 reads it | |
| 1.1 | `lost` boxes, numbers with units (`20ms`, `80%`, `7×`), `as` after a demand; new names for overloaded words: `underTarget` and `notFull` in `expect`, `minSamples` on a metric, `placement` in `workers`, `accepts` on a connection (the old ones warn) | a hop needs its edge (`missing-edge`, `reversed-edge`); typed formulas and value ranges (`wrong-type`, `chained-comparison`, `bad-value`, `bad-rate`, `bad-demand`, `out-of-range`) |
| 1.2 | `mod(a, b)`, sizes (`1.5KB`, `20MB`), `like:` on a box, `out.<stage>`, a text continued on the next line, a scenario's id, the `view { … }` block (its settings at the top warn) | a `%` where a load multiple goes, a `×` where a share goes (`unit-mismatch`); a `%` glued to a number before a value, `30%+1` (`glued-percent`); `mod` and `out` as names |
| 1.3 | several files: `include` and `part of`, `library` and `import { … }`, `input` and `with { … }`, `subsystem`, `extends`; a dotted name for a box of a subsystem (`orderLine.workers`) | |
| 1.4 | `direction: auto` and `rows`, the rows a long diagram is folded into | |
| 1.5 | `closed`, in `view` and in a `step`: the subsystems drawn closed, each as one box; one spelling each: `direction`, `rows` and `layout` in `view { … }`; a pool's workers on the pool (`pods`, `perPod`, `placement`, `stageLabel`, `autoscale { … }`); a `%` after a number is always a share; `===`, `!==` and `derived.x` warn (`loadmap fmt` writes `==`, `!=` and `x`) | gone: the `workers` block, `label:` in an edge's block, `sub:` on a box, `tag` on a param, `grid` in the view (`removed`); `%` between two values (`remainder`, `mod(a, b)`); the old names and the view settings at the top (`deprecated`) |

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

A definition in several files is compiled with them: `compile(source, { path, files })`, `path` being the text's own
path from the project root and `files` the others by theirs (a function, a Map or a plain object; the compiler reads
nothing itself). A part or a variant is read through its model, and `r.role` says what the text is. A diagnostic or a
symbol in another file carries its `file`, with its offsets, line and column in that file. `imports(source, path)`
reads only the head, for a host that must fetch the files first; `gather(source, { path, files })` returns every file
the definition reaches; `flatten(source, { path, files })` writes it as one file. `encodeShare(source, values, {
path, files })` makes a `#v2.` link when there is more than one file, and `decodeShare` gives them back.
`definitionAcross`, `referencesAcross`, `renameAcross`, `hoverAcross` and `completionsAcross` are the help above over
a model and its parts, each place with its `file`.

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

The server takes the whole text on each change and colours nothing: highlighting stays the editor's. A definition in
several files is read with them: an open document before the file on disk, and nothing outside the workspace folder.
A part is checked through its model, and a problem is reported in the file it is in. Go to definition, references and
rename cross the files of a model; in a head, a path completes to the workspace's `.loadmap` files and an import's
braces to the library's names; a name that a library declares has a quick fix that imports it.

## Reference

<!-- reference: written by reference() in packages/dsl; UPDATE_DOCS=1 pnpm test:node rewrites it -->

### The top level

A loadmap definition.

| Property | Value | |
| --- | --- | --- |
| `title` | string, constant | The heading above the diagram. |
| `assume` | string, constant | A line added before the generated assumptions. |
| `searchMax` | number, constant | The highest load multiple the limits search. Default 2000. |

Holds: `load`, `param`, `preset`, `scenario`, `growth`, `expect`, `step`, `let`, `fit`, `published`, `metric`, `measure`, `flow`, `component`, `node`, `cluster`, `pool`, `connection`, `tier`, `thresholds`, `view`, `include`, `part`, `library`, `import`, `extends`, `subsystem`.

Holds edges: `a -> b`, `a -> b: label`, `a -> b: label { when: … }`.

### include

A part of this model: another file whose statements join this one, as if written here. In the head, before anything else. The part says `part of` and this file. From loadmap 1.3.

```loadmap
include "./checkout.story.loadmap"
```

After the keyword: path.

### part

The second line of a part: the model this file belongs to, which includes it. A part holds anything a model does but its load, its view, its title and its head, and says its model's version. From loadmap 1.3.

```loadmap
part of "./checkout.loadmap"
```

After the keyword: of path.

### library

The second line of a library: a file of values (let, fit, metric, measure, tier, published), box prototypes and subsystems that models import by name. It is checked on its own, draws nothing, and reads nothing of who imports it. From loadmap 1.3.

```loadmap
library "Platform building blocks"
```

After the keyword: [label].

### import

Names of a library, used here as if declared here: `a`, or `local: theirs` to give one another name. In the head. The path is relative to this file (`./`, `../`) or starts at the project root (`/`), and ends in .loadmap. From loadmap 1.3.

```loadmap
import "./lib/platform.loadmap" { postgres; pool: podPool }
```

After the keyword: path.

Its properties are named by this file: each a name of the library, `local: theirs` to give it another.

### extends

The second line of a variant: the model this file is, with what it writes changed. A parameter here replaces the lines it writes of that parameter; a let, fit, measure or published figure replaces the one of its name; presets, scenarios, expectations and steps are added. From loadmap 1.3.

```loadmap
extends "./checkout.loadmap"
```

After the keyword: path.

### input

A value a prototype or a subsystem takes from the box that is like it, set there in `with { … }`; with `= …` it has a default. `input flow main` takes the name of a flow instead, for `flows.main`, `at.topic.main` and `partitions { main: 12 }`. From loadmap 1.3.

```loadmap
input pods = 3
```

After the keyword: id [name] [= formula].

### with

The inputs of the prototype or subsystem this one is like, each by its name. A value is a formula of this file. From loadmap 1.3.

```loadmap
with { pods: pods; need: flows.orders }
```

Its properties are named by the inputs of the prototype or the subsystem it is like.

### subsystem

Several boxes as one: its boxes, components, connections, the edges between them and its lets, each named `<id>.<name>` outside it. In a library it takes inputs; `like:` makes one from another. With `route:`, a flow or an edge may name the subsystem itself. From loadmap 1.3.

```loadmap
subsystem orderLine "Orders" { like: pipeline; with { main: orders } }
```

After the keyword: id [label].

| Property | Value | |
| --- | --- | --- |
| `like` | node, constant | Another subsystem, of this file or imported, to be like: everything it holds, under this id. |
| `tier` | tier, constant | The tier the box stands in; without one, that of the boxes that feed it. |
| `route` | route, constant | The stages a flow passes when its route names the subsystem, a -> b. An edge to the subsystem ends at the first one's box, an edge from it starts at the last one's. |

Holds: `input`, `with`, `node`, `cluster`, `pool`, `component`, `connection`, `let`, `subsystem`.

Holds edges: `a -> b`, `a -> b: label`, `a -> b: label { when: … }`.

### view

How the page looks and plays: nothing in here changes a number. Once in a definition. From loadmap 1.2.

```loadmap
view { direction: right; speed: 10; fullScreen: [verdict, controls] }
```

| Property | Value | |
| --- | --- | --- |
| `speed` | number, constant | Simulated seconds per real second. Default 10. |
| `transition` | number in seconds, constant | Seconds the diagram takes to move to a new structure (a scenario, a story step, a control that adds pods); 0 cuts. Default 0.8, at most 5; with reduced motion it cuts. |
| `fullScreen` | a list of `verdict`, `live`, `limits`, `controls`, `headroom`, `compare`, `assumptions` | The panels full screen shows, compact, below the diagram. Default all of them. |
| `fullScreenMode` | `panels` \| `focus` | What full screen opens with: the panels, or focus (the diagram, the story, the verdict and the load). Default panels. |
| `lanes` | `filled` \| `striped` | filled (the default): every lane in two alternating shades; striped: every other one clear. |
| `direction` | `right` \| `down` \| `auto` | Which way the diagram runs. Default auto: the way that fits the room it is drawn in larger, and where both fit about as well, right, or down when its widest layer has more boxes than its longest chain. right or down holds it. Narrow screens always run down. From loadmap 1.5. |
| `rows` | number, constant | The rows a long diagram is folded into (columns, running down), 1 to 6. Default: one row where its titles read with ease in the room it is drawn in, else two or three. 1 never folds; a diagram with fewer layers has fewer rows, and a narrow screen never folds. From loadmap 1.5. |
| `layout` | `compact` \| `stable` | compact (the default) lays out each scenario, story step, preset and choice of a select or switch on its own and moves the boxes from one to the next; stable gives every box one place, the largest it needs anywhere, so none of them moves a box. Neither the load nor a range moves one. From loadmap 1.5. |
| `closed` | subsystems, constant | The subsystems drawn closed at first, each as one box: `closed: [eu, us]`. Default none. From loadmap 1.5. |

### loadmap

The first line: the version of the language this definition is written in. `loadmap 1` is 1.0.

```loadmap
loadmap 1.5
```

After the keyword: version.

### load

The load, as a multiple of today. It drives the limits.

```loadmap
load "Users, × today" { max: 100; default: 10 }
```

After the keyword: [label].

| Property | Value | |
| --- | --- | --- |
| `min` | load multiple, constant | The lowest multiple. Default 1. |
| `max` (required) | load multiple, constant | The highest multiple on the slider. |
| `step` | number, constant | The slider step. Default 1. |
| `default` | load multiple, constant | Where the slider starts. Default the minimum. |

### param

A control: options make a select, min and max a slider, a true or false default a switch.

```loadmap
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
| `enabled` | boolean, formula of parameters | Greys the control out while this is false; it reads only parameters. |
| `format` | string, formula of `value` | How a value is shown, from `value`: `${value} pods`. |

### preset

A named set of values, offered as a button.

```loadmap
preset "Black Friday" { load: 40; pods: 6 }
```

After the keyword: label.

Its properties are named by parameters (and `load`).

### scenario

A named design to compare: the defaults plus these values, never the load. The first is the baseline. An id before the label (from loadmap 1.2) is what a step or an expect names it by, so the button can be reworded.

```loadmap
scenario proposed "Proposed" { pods: 6; gateways: 2 }
```

After the keyword: [id] label.

Its properties are named by parameters (not `load`).

### growth

How fast the load grows, compounded from asOf, where it is 1×: load multiples become dates.

```loadmap
growth { rate: 0.06; per: month; asOf: "2026-11-01" }
```

| Property | Value | |
| --- | --- | --- |
| `rate` (required) | share, constant | Growth per period, as a share: 0.06 is 6 %. |
| `per` (required) | `month` \| `year` | month or year. |
| `asOf` (required) | string, constant | The day the load is 1×: "2026-11-01". |

### expect

What must keep holding, on the pessimistic edge (every capacity at its low bound): `loadmap check` fails when it does not.

```loadmap
expect "Today keeps 7×" { underTarget: 7× }
```

After the keyword: [label].

| Property | Value | |
| --- | --- | --- |
| `scenario` | scenario, constant | The scenario whose values it checks; the defaults without one. |
| `component` | component, constant | One component; the first limit without one. |
| `flow` | flow, constant | One flow's latency, with p50, p95 or p99: it stays under that time up to underTarget, or at the values. |
| `p50` | number in seconds, constant | The flow's median stays under this many seconds. |
| `p95` | number in seconds, constant | The flow's 95th percentile stays under this many seconds. |
| `p99` | number in seconds, constant | The flow's 99th percentile stays under this many seconds. |
| `underTarget` | load multiple, constant | Every component (or this one) stays under the target utilization up to at least this load multiple. From loadmap 1.1; `target` before. |
| `notFull` | load multiple, constant | Nothing (or this component) runs out before this load multiple. From loadmap 1.1; `full` before. |
| `severity` | `fail` \| `warn` | warn: `loadmap check` reports it, and never fails because of it. Default fail. |

### step

A step of the story the page walks through, in order: its text, and the values to show it at. Play (and `loadmap record --story`) shows the whole diagram, closes in on what the step changes, changes it, and steps back.

```loadmap
step "At 30×, the workers run out first." { load: 30; focus: workerPool; title: "Users to 30×" }
```

After the keyword: label.

| Property | Value | |
| --- | --- | --- |
| `scenario` | scenario, constant | Start from this scenario's values; without one, from the defaults. |
| `title` | string, constant | The few words the diagram shows while Play shows the step. Default: what the step changes. |
| `focus` | component, constant | The component to point at: its box is outlined. |
| `closed` | subsystems, constant | The subsystems drawn closed during the step: `closed: [us]`, `[]` for none. Default: as `view` says. From loadmap 1.5. |
| `seconds` | number, constant | How long Play holds the whole diagram after the step changes it: the time to read it. Default 4. |

Its properties are named by parameters (and `load`).

### let

A named formula other formulas can use by its name.

```loadmap
let perPosition = watchOnly ? 0.3 : 1.2
```

After the keyword: id = formula.

### fit

cost = a + b × x, fitted from measured points. Call it like a function: workerCores(rate).

```loadmap
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

```loadmap
metric served "Requests served" {
  prometheus { query: "sum(rate(http_requests_total{job=\"{{ args.job }}\"}[5m]))" }
  stat: max
  minSamples: 30
}
```

After the keyword: id [label].

| Property | Value | |
| --- | --- | --- |
| `stat` | `mean` \| `min` \| `max` \| `last` \| `p50` \| `p95` \| `p99` | How the window becomes one value. Default mean. |
| `minSamples` | number, constant | The samples a window needs before its value counts; with fewer, the fallback is used. From loadmap 1.1; `min` before. |

Holds: `prometheus`, `elasticsearch`.

### prometheus

A metric read from Prometheus: a PromQL query over a range, at the address `LOADMAP_PROMETHEUS_URL` gives `loadmap pull`. The query is data sent to Prometheus, never code loadmap runs; it must return one series.

```loadmap
prometheus { query: "sum(rate(http_requests_total[5m]))" }
```

| Property | Value | |
| --- | --- | --- |
| `query` (required) | string, constant | The PromQL query; `{{ args.name }}` is filled by each measure. |

### elasticsearch

A metric read from Elasticsearch or OpenSearch: an index, counted or aggregated at each step, from `LOADMAP_ELASTICSEARCH_URL`.

```loadmap
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

```loadmap
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

```loadmap
published brokersRef kafka {
  edition: "2026-11"
  brokers: 3
  replication: 3
  acks: "all"
  messageSize: "1 KB"
  producers: 4
}
```

After the keyword: id component.

| Property | Value | |
| --- | --- | --- |
| `edition` (required) | string, constant | The catalog edition its figures come from, "YYYY-MM": an old file keeps its numbers. |
| `version` | string, formula of parameters | The version you run. It decides only for a component whose figures change with the version; elsewhere it is kept beside the figure. |
| `figure` | string, constant | Which figure, when several match: its id in the catalog. |
| `margin` | share, constant | Lowers the best case, as a share from 0 to below 1: 0.3 reads the capacity from 70 % of the figure up to it. |

Its properties are named by the catalog component's conditions (its runs' brokers, message size, …).

### points

The measured points of a fit: the names of x and y, then one "x y" row per line.

```loadmap
points rate cores {
  200 0.2599
  350 0.3061
}
```

After the keyword: x y.

### flow

Something that moves through the system, with its rate and its route.

```loadmap
flow orders "orders" { unit: "order"; rate: 40 * load; route: gateway -> topic -> workerPool }
```

After the keyword: id [label].

| Property | Value | |
| --- | --- | --- |
| `unit` | string, constant | One unit of the flow, singular: "order". |
| `rate` (required) | number per second, formula | Units per second. |
| `priority` | number, constant | 1 is served first. Flows of the same priority share. |
| `timeout` | number in seconds, formula of parameters | Seconds a client waits: a unit slower than this fails, and is sent again with retry, though its work still runs. It needs a service time on its way. |
| `route` (required) | route, constant | The stages it passes, in order: a -> b -> c. An edge draws each hop. |
| `from` (required) | node, constant | The node its dots start from. |
| `color` | `accent` \| `alt` \| `ok` \| `warn` \| `drop` \| `muted` | A theme colour (accent, alt, ok, warn, drop, muted) or a CSS colour in quotes. |

Holds: `drop`, `merge`, `retry`.

### drop

Units older than olderThan simulated seconds are dropped before they are handled.

```loadmap
drop { olderThan: 60; reason: "too old" }
```

| Property | Value | |
| --- | --- | --- |
| `olderThan` (required) | number in seconds, formula | Seconds. |
| `reason` | string, formula | Shown with the drop meter. |
| `when` | boolean, formula | The rule applies only while this is true. |

### merge

Under backlog, this share of what is handled is superseded by a newer unit: keep the newest per key.

```loadmap
merge { share: 0.37; reason: "newest kept" }
```

| Property | Value | |
| --- | --- | --- |
| `share` (required) | share, formula | The share superseded, 0 to 1. |
| `reason` | string, formula | Shown with the meter. |
| `when` | boolean, formula | The rule applies only while this is true. |

### retry

A unit turned away on the route (by a pass, limit or cache stage past capacity) is sent again, up to times more times. The attempts settle where the retries they cause are the ones assumed.

```loadmap
retry { times: 3; budget: 0.1 }
```

| Property | Value | |
| --- | --- | --- |
| `times` (required) | number, formula of parameters | Retries after the first attempt: a whole number. Reads only the parameters. |
| `budget` | share, formula of parameters | At most this share of the flow is added as retries: 0.1 adds at most 10 %. Without one, every retry is sent. |
| `when` | boolean, formula of parameters | The rule applies only while this is true; it reads only parameters. |

### component

Something that can run out: its demand against its capacity. On a box, write these lines on the box.

```loadmap
component cache "Cache" { demand: flows.reads; capacity: estimated(9000, "req/s") }
```

After the keyword: [id] [label].

| Property | Value | |
| --- | --- | --- |
| `name` | string, constant | The component's name in the limits list. Defaults to the label. |
| `short` | string, constant | The name inside a sentence, with its article: "the database". |
| `plural` | boolean, constant | "are past capacity" instead of "is". |
| `demand` | number, formula | What the component must handle, in its capacity's unit. Without one: the units per second reaching its stages. |
| `held` | number in seconds, formula | The seconds each unit holds one of its slots (a connection, a session); per flow in a held { … } block. Its demand is then the slots in use: what reaches its stages × held, and its capacity counts slots. |
| `service` | number in seconds, formula | The seconds a unit takes here when nothing waits. Each stage it runs is then a queue whose time grows as service ÷ (1 − utilization), and the flows through it have a latency (p50, p95, p99). |
| `on` | route, constant | The stages whose units hold its slots, a -> b; without it, the stages it runs. |
| `capacity` | capacity, formula | What it can handle: measured(value, unit, source) or estimated(value, unit, source), `value ± 30%` saying how sure it is; configured(value, unit, source) for a limit someone set. |
| `when` | boolean, formula | The component is switched off (no utilization) while this is false. |
| `over` | string, formula | What happens past 100 %, as a clause: "clients get 429s". |
| `describe` | string, formula | One line under the name in the limits list. |

Holds: `held`.

### held

How long a unit of each flow holds one of the component's slots, in seconds; a flow it does not name holds none.

```loadmap
held { orders: 0.02; sessions: 3600 }
```

Its properties are named by flows.

### tier

A lane across the flow (edge, app, data) drawn behind its boxes, its name in a header. Tiers run in the order they are declared.

```loadmap
tier data "Data"
```

After the keyword: id [label].

| Property | Value | |
| --- | --- | --- |
| `fill` | string, constant | The lane's own colour: "#rrggbb", "rgb(…)" or "hsl(…)". |
| `fillDark` | string, constant | Its colour in the dark theme. Default: fill's hue, as dark as the theme's lanes. |

### node

A box. It may run a stage (pass, store, sink, lost, fanout) and own a component (demand and capacity lines).

```loadmap
node gateway "API gateway" { pass; demand: flows.orders; capacity: estimated(20000, "req/s") }
```

After the keyword: id [label] [sub].

| Property | Value | |
| --- | --- | --- |
| `shape` | `box` \| `cylinder` | box (the default) or cylinder. |
| `tier` | tier, constant | The tier the box stands in; without one, that of the boxes that feed it. |
| `like` | node, constant | Another box of the same kind to be like: every line and stage of that box this one does not write itself. A line written here replaces the same line there; a stage written here replaces its stages. From loadmap 1.2. |
| `name` | string, constant | The component's name in the limits list. Defaults to the label. |
| `short` | string, constant | The name inside a sentence, with its article: "the database". |
| `plural` | boolean, constant | "are past capacity" instead of "is". |
| `demand` | number, formula | What the component must handle, in its capacity's unit. Without one: the units per second reaching its stages. |
| `held` | number in seconds, formula | The seconds each unit holds one of its slots (a connection, a session); per flow in a held { … } block. Its demand is then the slots in use: what reaches its stages × held, and its capacity counts slots. |
| `service` | number in seconds, formula | The seconds a unit takes here when nothing waits. Each stage it runs is then a queue whose time grows as service ÷ (1 − utilization), and the flows through it have a latency (p50, p95, p99). |
| `on` | route, constant | The stages whose units hold its slots, a -> b; without it, the stages it runs. |
| `capacity` | capacity, formula | What it can handle: measured(value, unit, source) or estimated(value, unit, source), `value ± 30%` saying how sure it is; configured(value, unit, source) for a limit someone set. |
| `when` | boolean, formula | The component is switched off (no utilization) while this is false. |
| `over` | string, formula | What happens past 100 %, as a clause: "clients get 429s". |
| `describe` | string, formula | One line under the name in the limits list. |

Holds: `pass`, `store`, `sink`, `lost`, `fanout`, `split`, `cache`, `limit`, `component`, `held`, `input`, `with`.

### cluster

Members (brokers) holding the partitions of one or more queues (topics).

```loadmap
cluster kafka "Kafka" { members: 3; queue topic { partitions { orders: 12 } } }
```

After the keyword: id [label] [sub].

| Property | Value | |
| --- | --- | --- |
| `members` (required) | number, formula | How many members. |
| `memberLabel` | string, formula of `i` | Each member's label, from its index i: `broker ${i}`. |
| `tier` | tier, constant | The tier the box stands in; without one, that of the boxes that feed it. |
| `like` | node, constant | Another box of the same kind to be like: every line and stage of that box this one does not write itself. A line written here replaces the same line there; a stage written here replaces its stages. From loadmap 1.2. |
| `name` | string, constant | The component's name in the limits list. Defaults to the label. |
| `short` | string, constant | The name inside a sentence, with its article: "the database". |
| `plural` | boolean, constant | "are past capacity" instead of "is". |
| `demand` | number, formula | What the component must handle, in its capacity's unit. Without one: the units per second reaching its stages. |
| `held` | number in seconds, formula | The seconds each unit holds one of its slots (a connection, a session); per flow in a held { … } block. Its demand is then the slots in use: what reaches its stages × held, and its capacity counts slots. |
| `service` | number in seconds, formula | The seconds a unit takes here when nothing waits. Each stage it runs is then a queue whose time grows as service ÷ (1 − utilization), and the flows through it have a latency (p50, p95, p99). |
| `on` | route, constant | The stages whose units hold its slots, a -> b; without it, the stages it runs. |
| `capacity` | capacity, formula | What it can handle: measured(value, unit, source) or estimated(value, unit, source), `value ± 30%` saying how sure it is; configured(value, unit, source) for a limit someone set. |
| `when` | boolean, formula | The component is switched off (no utilization) while this is false. |
| `over` | string, formula | What happens past 100 %, as a clause: "clients get 429s". |
| `describe` | string, formula | One line under the name in the limits list. |

Holds: `queue`, `component`, `held`, `input`, `with`.

### pool

A pool of workers, pods × workers per pod, drawn as pods holding a grid of workers. Flows are worked off here; a route names the pool.

```loadmap
pool workerPool "Workers" { pods: pods; perPod: 8 }
```

After the keyword: id [label] [sub].

| Property | Value | |
| --- | --- | --- |
| `pods` | number, formula | How many pods; an autoscaled pool has autoscale instead. From loadmap 1.5. |
| `perPod` | number, formula | Workers per pod. From loadmap 1.5. |
| `placement` | `round-robin` \| `in-order` | round-robin spreads work across pods (the default); in-order fills pod 0 first. From loadmap 1.5; `fill` before. |
| `stageLabel` | string, constant | The name of its work inside a sentence: "alert pipeline". Defaults to the id. From loadmap 1.5. |
| `component` | component, constant | The component whose capacity this stage uses. Defaults to its box's component. From loadmap 1.5. |
| `podLabel` | string, formula of `i` | Each pod's label, from its index i: `pod ${i}`. |
| `tier` | tier, constant | The tier the box stands in; without one, that of the boxes that feed it. |
| `like` | node, constant | Another box of the same kind to be like: every line and stage of that box this one does not write itself. A line written here replaces the same line there; a stage written here replaces its stages. From loadmap 1.2. |
| `name` | string, constant | The component's name in the limits list. Defaults to the label. |
| `short` | string, constant | The name inside a sentence, with its article: "the database". |
| `plural` | boolean, constant | "are past capacity" instead of "is". |
| `demand` | number, formula | What the component must handle, in its capacity's unit. Without one: the units per second reaching its stages. |
| `held` | number in seconds, formula | The seconds each unit holds one of its slots (a connection, a session); per flow in a held { … } block. Its demand is then the slots in use: what reaches its stages × held, and its capacity counts slots. |
| `service` | number in seconds, formula | The seconds a unit takes here when nothing waits. Each stage it runs is then a queue whose time grows as service ÷ (1 − utilization), and the flows through it have a latency (p50, p95, p99). |
| `on` | route, constant | The stages whose units hold its slots, a -> b; without it, the stages it runs. |
| `capacity` | capacity, formula | What it can handle: measured(value, unit, source) or estimated(value, unit, source), `value ± 30%` saying how sure it is; configured(value, unit, source) for a limit someone set. |
| `when` | boolean, formula | The component is switched off (no utilization) while this is false. |
| `over` | string, formula | What happens past 100 %, as a clause: "clients get 429s". |
| `describe` | string, formula | One line under the name in the limits list. |

Holds: `autoscale`, `component`, `held`, `input`, `with`.

### pass

Flows pass through; past capacity the share above 100 % is rejected.

```loadmap
pass "the gateway"
```

After the keyword: [id] [label].

| Property | Value | |
| --- | --- | --- |
| `component` | component, constant | The component whose capacity this stage uses. Defaults to its box's component. |

### cache

A share of the units (hit) is answered here and goes no further; the rest carry on to the next stage. Past capacity the share above 100 % is rejected.

```loadmap
cache { hit: 0.8 }
```

After the keyword: [id] [label].

| Property | Value | |
| --- | --- | --- |
| `hit` (required) | share, formula | The share answered here, 0 to 1. |
| `component` | component, constant | The component whose capacity this stage uses. Defaults to its box's component. |

### limit

A rate limiter: its component's capacity is the limit. Above it the share over is turned away, and the stages after it see only what got through.

```loadmap
limit
```

After the keyword: [id] [label].

| Property | Value | |
| --- | --- | --- |
| `component` | component, constant | The component whose capacity this stage uses. Defaults to its box's component. |

### store

Where a flow ends: written to its component.

```loadmap
store
```

After the keyword: [id] [label].

| Property | Value | |
| --- | --- | --- |
| `component` | component, constant | The component whose capacity this stage uses. Defaults to its box's component. |

### sink

Where a flow ends without a component: a receiver, a viewer.

```loadmap
sink "contacts"
```

After the keyword: [id] [label].

### lost

Where what other boxes lose goes, counted: an edge from a box into this one sends what that box turns away, drops as too old or times out here, after every retry. It is on no route. From loadmap 1.1.

```loadmap
lost { takes: [rejected] }
```

After the keyword: [id] [label].

| Property | Value | |
| --- | --- | --- |
| `takes` | a list of `rejected`, `dropped`, `timedOut` | Which losses it takes: rejected (turned away past capacity or a limit), dropped (too old in a queue), timedOut (too slow for the client). Default all three. |

### queue

Flows wait here; the next stage of each route drains it.

```loadmap
queue topic "orders topic" { partitions { orders: 12 } }
```

After the keyword: [id] [label].

| Property | Value | |
| --- | --- | --- |
| `component` | component, constant | The component whose capacity this stage uses. Defaults to its box's component. |

Holds: `partitions`.

### partitions

Partitions per flow, drawn as cells across the members.

```loadmap
partitions { orders: 12; events: 24 }
```

Its properties are named by flows.

### autoscale

Pods are added and removed to hold each running pod near target, between min and max. The component's capacity is the pool at max pods: it runs out when the pool cannot grow further.

```loadmap
autoscale { min: 2; max: 10; target: 0.7 }
```

| Property | Value | |
| --- | --- | --- |
| `min` (required) | number, formula | The fewest pods, at least 1. |
| `max` (required) | number, formula | The most pods. |
| `target` (required) | share, formula | The utilization each running pod is held at, above 0 and at most 1: 0.7 scales out above 70 %. |

### split

Each unit goes on one way of several, by share: a read/write split, shards, regions, an A/B test, failover. One "flow -> stage -> …: share" line per way; a flow's shares add up to 1, and a flow it names on no line goes straight on. A way that ends in a store, a sink or a fan-out ends there; any other goes on with the route after the split.

```loadmap
split "DB router" {
  orders -> primary: 0.2
  orders -> replica: 0.8
}
```

After the keyword: [id] [label].

| Property | Value | |
| --- | --- | --- |
| `component` | component, constant | The component whose capacity this stage uses. Defaults to its box's component. |

Holds branches: `flow -> stage -> …: share`.

### fanout

Each unit is copied to several stages; one "flow -> stage: copies" line per branch. Last on a route.

```loadmap
fanout "push broker" {
  alerts -> contacts: 1
}
```

After the keyword: [id] [label].

| Property | Value | |
| --- | --- | --- |
| `component` | component, constant | The component whose capacity this stage uses. Defaults to its box's component. |

Holds branches: `flow -> stage: copies per unit`.

### connection

How a stage reaches the next one on a route. exclusive gives each part one owner: a Kafka consumer group. The component runs out when its busiest member does.

```loadmap
connection group { hop: topic -> workerPool; assign: exclusive }
```

After the keyword: id.

| Property | Value | |
| --- | --- | --- |
| `hop` (required) | route, constant | The two stages it joins: from -> to. |
| `assign` | `shared` \| `exclusive` \| `key` \| `leader` | shared (the default); exclusive: each part read by one member; key: each unit to its part, part i on member i mod members; leader: every unit to one member. |
| `owner` | `worker` \| `pod` | What owns a part in a pool. Default worker. |
| `capacityPer` | `worker` \| `pod` | What the capacity divides over. Default the owner. |
| `parts` | number, formula | Parts of each flow, when the stage in front is no queue. |
| `members` | number, formula | Members of the stage after, when it is no pool. A cluster's members for its queues. |
| `flows` | flows, constant | The flows it covers. Default every flow on the hop. |
| `open` | number, formula | Connections each member of the pool on the hop keeps open to the other side. |
| `accepts` | capacity, formula | The most connections the other side accepts: a limit named by this connection. From loadmap 1.1; `max` before. |
| `skew` | capacity, formula | With key: a flow's share on its hottest part. |
| `rule` | string, constant | A rule from the catalog, "kafka/consumer-group": its assign and owner unless written, its source cited. |

### thresholds

The utilization of the target and of "runs out".

```loadmap
thresholds { target: 0.5; full: 1 }
```

| Property | Value | |
| --- | --- | --- |
| `target` | share, constant | Default 0.5. |
| `full` | share, constant | Default 1. |

### Edges

A line between two nodes: `a -> b`, a chain `a -> b -> c`, or with a label `a -> b: "…"`.

| Property | Value | |
| --- | --- | --- |
| `when` | boolean, formula | The edge is left out while this is false. |

### Functions

`min`, `max`, `round`, `floor`, `ceil`, `abs`, `sqrt`, `log`, `exp`, `pow`, `mod`, `fmt`, `compact`, `pct`, `secs`, `measured`, `estimated`, `configured`

<!-- end of reference -->
