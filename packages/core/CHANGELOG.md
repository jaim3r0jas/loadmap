# @loadmap/core

## 0.46.0

### Minor Changes

- b547540: A batch: `runs { every: 1d; within: 4h }` on a component (language 1.7; `runs: { every, within }` in TypeScript).
  What reaches it in `every` is worked off `within`, so its demand is the rate a run needs, and it runs out where a run
  misses its window, at a load multiple. Every a day or more reads each flow at its average. The limits list says how
  long a run takes of its time (`ev.components.<id>.runs.takes`).

  Docs: /language/building-blocks/#batches
- 37f77bd: A circuit breaker: `breaker { opens: 50% }` on a flow (language 1.7; `breaker: { opens }` in TypeScript). Past that
  share of its attempts failing, its callers fail calls fast. In steady state it admits the share α at which the
  failures among what it admits are `opens`, p(α·rate) = opens, found by a bracketed root search; below that it
  stays closed. What it fails fast reaches no stage: it goes to the flow's fallback, if any, and on the board fades at
  the source (`ev.breakers.<flow>`: `admitted`, `failedFast`). A flow that retries takes no breaker.

  Docs: /language/building-blocks/#lost-units
- 00a1e85: A fallback: `fallback { after: api; route: staleQuotes }` on a flow (language 1.7; `fallback: { after, route }` in
  TypeScript). What the flow fails for good, turned away or too slow after every retry, goes back to `after` and is
  served along `route`: each fallback stage sees that rate (`ev.fallbacks.<flow>.rate`) and may run out like any other.
  A lost box on the route counts none of it; one behind a fallback stage counts what that stage turns away. On the board
  a failed dot fades where it failed and a dot sets out from `after` along its edge to the fallback, which needs that
  edge (`missing-edge`). The budgets go to 74, 230 and 140 kB.

  Docs: /language/building-blocks/#lost-units
- f89851d: N−1 in the answers: with every part of a failure domain up, `outages(model, values)` (`@loadmap/core/outages`, an
  entry of its own) ranks again with one part out. The page says it under the verdict ("With one availability zone out, the 50 % target holds up to
  8.3×, limited by the search API, which keeps 5 of 8."), each limit gives its own figure with a part out when that
  comes sooner, and the headroom chart draws the shown line with one part out, dashed (`HeadroomLine.outage`). The
  search example expects 8× with a zone out.

  Docs: /language/building-blocks/#failure-domains
- a993b1b: A preset can say how long its moment lasts: `preset "Black Friday" { load: 12; lasts: 2h }` (language 1.7; `peaks` in
  TypeScript). While its values are shown, the verdict says what that long leaves in each queue whose reader cannot keep
  up, and how long the reader then needs to clear it at the default load: "After 2 h of Black Friday, 1.4M events wait
  in the events topic, which at 1× clears in 5 h." `backlog(model, values, seconds)` (from `@loadmap/core/backlog`) gives it, by the sim's own rules (a
  reader drains at its component's full, priority 1 first, a drop or a merge leaves less), and the sim builds the same.

  Docs: /language/controls/#presets
- 9222ee2: A quota over a window: `limit { per: day }` (or `hour`, `month`; language 1.7; `limit('plan', { per: 'day' })` in
  TypeScript). Its capacity is what the window allows, `configured(5_000_000, "requests/day", …)`, and its demand what
  reaches it in one window, at the peak for an hour and at each flow's average for a day or a month. It runs out at a
  load multiple like any rate, and past it the limits list says how far into the window it is gone. A quota whose
  capacity is written per second warns.

  Docs: /language/building-blocks/#rate-limits
- 66323a1: A scaling curve: `fit apiScale { curve: usl; points n rate { … } }` (language 1.7; `fitScaling` from
  `@loadmap/core/scaling`) fits the Universal Scalability Law to sizes and the capacity
  measured at each: contention and coherency, so twice the pods give less than twice the capacity and past a peak less.
  Call it like a fit, `measured(apiScale(pods), "req/s", …)`. The assumptions list it with its peak, in the page and in
  `loadmap check`, and a parameter it reads that reaches past the peak warns (`past-peak`). It never applies to a
  published figure.

  Docs: /language/controls/#fitted-costs
- 56e90eb: Skew drawn on a sharded store: a store or a pass that a key connection shards over `members` and `parts` is drawn as
  its members, each holding the parts it keeps (part i on member i mod members), and its dots land on their parts, the
  hot key's share on part 0, as on a queue. The resolved stage says so (`ResolvedStage.shards`: `members`, `parts`,
  `skew`). The `<Loadmap>` page's budget goes to 76 kB.

  Docs: /language/building-blocks/#connections
- a4b725f: Shedding by priority: `pass { shed: priority }` (language 1.7; `pass('gw', { shed: 'priority' })` in TypeScript). Past
  capacity the pass lets through as much as ever, but the flow with the smaller `priority` number first, so priority 1
  keeps going while there is room for it. Each flow's share is on the stage (`shedBy`), and the dots, the lost boxes and
  the retries follow it.

  Docs: /language/building-blocks/#lost-units
- 0aef603: Stocks: a component that fills over time, not at a load. `fills` is what it gains a second (a disk, a topic's
  retention, a database's size), read with every flow at its new `average`, its rate over a day against its peak. With
  `keeps: 7d` it holds what it gains that long and settles at fills × keeps; with `level: measured(120, "GB", …)` it
  stands there on growth's `asOf` and grows as the load does, so it is ranked at the load multiple whose day it is full,
  with that date. Without growth such a stock is not ranked, and the verdict says why. `expect { lasts: 365d }` holds a
  time through the growth. The limits list says what a stock gains a day and how long it has left at that rate
  (`ev.components.<id>.stock`), and the editor has a starter, "Disk that fills up". All new in language 1.7.

  Docs: /language/building-blocks/#stocks
- 3f8470d: Failure domains: `domain zone "Availability zone" { count: 3 }`, `across: zone` on a pool, a cluster or a node, and
  `down: zone` in a scenario, a step, a preset or an expect (language 1.7; `domains` and `across: { domain, members }`
  in TypeScript). The model gets an Outage control, `down`. With one part out, a box's members in the fullest part are
  out: its utilization is its own times members ÷ members left, a connection deals its parts over the members left,
  and the members out are drawn as idle pods are. A published figure is then left without a benchmark, never scaled
  (`ev.components.<id>.out`: `members`, `left`).

  Docs: /language/building-blocks/#failure-domains

## 0.45.0

No changes in this release.

## 0.44.0

No changes in this release.

## 0.43.0

No changes in this release.

## 0.42.1

No changes in this release.

## 0.42.0

No changes in this release.

## 0.41.0

No changes in this release.

## 0.40.0

No changes in this release.

## 0.39.0

No changes in this release.

## 0.38.1

No changes in this release.

## 0.38.0

### Minor Changes

- 7bd53ff: Catalog edition 2027-01: the figures of 2026-12, with each component's `box` the one its stage lives in. RabbitMQ is a
  cluster (a queue lives only in one); etcd, CockroachDB, OpenSearch, MongoDB, Kubernetes and Istio are nodes (a cluster
  holds nothing but queues, and a pool is its own workers). Add → From the catalog writes that box running its kind's
  stage instead of a plain node with `demand: 0`: a queue for Kafka and RabbitMQ (as many members as the run's brokers
  or nodes), a cache for Valkey, a store or a pass for a database, a pass for a proxy. It can put the box on flows'
  routes, with the edges each hop needs (an edge no route takes any more goes) and a connection rule such as
  `kafka/consumer-group`, and writes its demand in the figure's unit: for Kafka, what reaches the queue at the run's
  message size. A demand in bytes against a published capacity is brought to the figure's unit, where it was an error.

## 0.37.0

### Minor Changes

- 10197af: A subsystem can be drawn closed: one box that stands for everything inside it. The box takes the colour of the worst
  component inside, names the busiest one on its second line, and wears the limit when the first limit is inside, so a
  board of closed subsystems says which one to open. The reader opens one with a click on it and closes one with a click
  on its name (the frame's name is a button now, with the mark of an open folder). Language 1.5 reads `closed` in `view`
  (`view { closed: [eu, us] }`: the ones the page starts with) and in a `step` (its own; `closed: []` for every one open).
  In code: `<Loadmap closed={[…]}>`, `closed` on a story step, `setClosed(ids)` on the controller, and
  `closed` among the options of a compiled definition, which `pageOptions()` passes on. Closing changes no number: the
  dots still pass every stage inside. What closes and draws them is loaded with the first diagram that has a subsystem.

## 0.36.0

No changes in this release.

## 0.35.0

No changes in this release.

## 0.34.0

No changes in this release.

## 0.33.0

### Minor Changes

- 9065003: Dots move only along edges. Every hop a flow takes needs an edge drawn the way it goes: from its `from` node to its
  first stage, along its route, on each way of a split (and where a way rejoins the route), and from a fan-out to each
  stage it copies to. A hop without one used to draw its dots straight across the diagram; now `defineView` throws
  (`flow "signups" goes from node "gateway" to node "api" with no edge between them: add edge('gateway', 'api')`) and
  the language reports an error at the hop from `loadmap 1.1` on (a warning in a file stamped before, whose dots still
  cross straight), with quick fixes that add the edge or route the flow through the boxes the
  edges already join. The edge must point the way the flow goes: one drawn the other way round no longer carries a
  route's dots (a cache's answers still go back along the edge they came in on). An edge a flow takes that its `when` hides at the defaults, in a preset or a scenario is a warning.
  To move a file over: apply the quick fix in the editor or VS Code, or add the edge `loadmap check` names.
  `model.stagesAt()` also returns each flow's ways (`paths`).
- 91c3aad: Lost boxes: a box for what other boxes lose, counted. A unit a stage turns away (a limiter, or a pass, cache or split
  past capacity), one a queue drops as too old, or one too slow for its client used to fade where it was; with a lost box,
  its dot goes along the edge into it and fades there. In the language, `node tooMany "Turned away" { lost }` and an edge
  `limiter -> tooMany`: the edge says what goes there, and `takes: [rejected]` keeps only some losses (`rejected`,
  `dropped`, `timedOut`). In TypeScript, `lost({ from: ['limiter'], takes: ['rejected'] })`. `at.tooMany` is what is lost
  there for good, after every retry, and the box says it on its second line ("500 rejected/s"); it is drawn dashed in the
  colour of a loss (`--lm-lost-fill`, `--lm-lost-line`), and so is the edge into it. A merge loses nothing: a merged dot
  now shrinks into a ripple of its flow's colour instead of fading grey, and the legend says "merged, newest kept".
- bb279a9: New names for words that meant two things. In `expect`, `target: 7` and `full: 50` were load multiples while
  `thresholds` and `autoscale` use `target` for a utilization; they are now `underTarget: 7` and `notFull: 50`
  (`underTarget: 7×` reads well). A metric's `min` (a sample count) is `minSamples`, a workers stage's `fill` (a
  placement, not a colour) is `placement`, and a connection's `max` (a capacity) is `accepts`. The new names are from
  loadmap 1.1. In a `loadmap 1.1` file the old ones still work and warn ("target is now underTarget"), with a quick fix
  that renames them, and `loadmap fmt` rewrites them; in a `loadmap 1` file they are that version's spelling, read as
  before, with no warning. TypeScript follows: `Expectation.underTarget` and `notFull`, `ConnectionDef.accepts`,
  `workers(…, { placement })` and `PullRequest.minSamples`, with the old names kept as `@deprecated`; a resolved workers
  stage and `compile(…).measures` give `placement` and `minSamples`. A snapshot file still says `min` beside its
  `samples`. A stage without a label now takes its component's `short` when no other stage runs that component, so the
  sentences and meters say "the gateway" without a second `pass "the gateway"`.

### Patch Changes

- 189d8db: One mistake, one mark, where it is. A flow's timeout without latency is marked at its `timeout:` line, and a lost box
  on a flow's route at its name there, instead of at the first line of the file (core says which property of the flow an
  error is about). The marks a mistake caused further on are gone: an unknown function no longer also says its arguments
  must be constants; a misspelt keyword (`nod api`) no longer marks every use of `api`; a second stage in a node, a bare
  capacity, a value that does not parse and a list with a wrong word (`takes: [rejectd]`) are marked once, without "is
  declared twice", "needs capacity" or "loses nothing" after them, and a timeout the model refuses no longer also warns
  that what it times out vanishes.
- 8b8bfca: A unit is lost once. A flow with a `drop` rule and a `timeout` counted what its queue dropped again as timed out, so a
  lost box (and `at.<box>`) could show more units a second than the flow sends; with `retry` the dropped units were sent
  again too. Now a dropped unit is lost at its queue, never sent again and never too slow, as the dots already showed.
  The losses are counted way by way: a split's ways and a cache's answers no longer share one "got through" figure, a
  queue on several ways drops on each, and a pass, limit or cache that reads a dropping queue turns away only what still
  reaches it, in the dots too. Checking the lost boxes walks each flow's ways once.

## 0.32.0

### Minor Changes

- f2c3fd3: Catalog edition 2026-12: how callers connect to each component, from its documentation, as connection rules with
  their sources (`kafka/consumer-group`, `valkey/cluster-slots`, `etcd/raft-leader`, …), and the documented defaults
  of PostgreSQL's and MySQL's `max_connections` as figures taken by name only. A connection's `rule` takes a rule's
  assign and owner where it writes none and cites its source; `rule(kafka, 'kafka/consumer-group')` in TypeScript,
  `rule: "kafka/consumer-group"` in the language, with autocomplete. Edition 2026-11 stays as it was.
- c302028: Connections count what they hold open: `open` is the connections each member of the pool on the hop keeps to the
  other side, and `max` the most that side accepts. Together they make a limit named by the connection, "Connections
  to db": the members running times what each keeps open, added up over every connection into the stage, so an
  autoscaled pool that opens more as it grows runs out at a load. `open` and `max` in the language too.
- 53b93be: Connections on the board: behind an exclusive connection each unit goes to the worker that reads its partition, a
  worker is as busy as its partitions make it, one that reads none stays idle and is drawn dashed, and a partition a
  quieter worker reads waits less of the queue's lag. `ev.stages[pool].assignment` gives the worker of each partition
  and each worker's share of the work. The latency times each group of workers at its own utilization, instead of
  every unit at the busiest one's.
- 7f55166: Connections on the stage they reach: `assign: 'key'` sends each unit to the part its key hashes to, partition i of
  each flow on member i mod `members`, and the busiest member bounds the stage; `skew` puts a share of a flow on its
  hottest part, and the sim sends that share of the dots there; `assign: 'leader'` sends every unit to one member. A
  published capacity keeps its number, and the limits list says why. In the language a cluster's queue takes the
  cluster's members. A connection's spread reads the flows' rates only when several share a stage.
- 55c4e7f: Connections: `connections` in a model says how a stage reaches the next one on a route. `assign: 'exclusive'` gives each
  partition of the queue in front (or each of `parts`) one owner among the pool's workers or pods (or `members`): a Kafka
  consumer group. The component then runs out when its busiest member does: its utilization carries the spread (the
  busiest member's share of the work × the members), `ev.components[c].spread` says why, and owners left without a
  partition are named. `owner` and `capacityPer` (worker or pod) say what owns a part and what the capacity divides over;
  `flows` picks the flows it covers. An autoscaler still reads the plain utilization. `shared` (the default) changes no
  number. Each connection is listed with the assumptions.

### Patch Changes

- 9cc0ccd: Connections in the language: `connection group { hop: topic -> pool; assign: exclusive; capacityPer: pod }`, with
  `owner`, `parts`, `members` and `flows: [orders]`, as `connections` does in TypeScript. What the model refuses about a
  connection is shown on its line; autocomplete, hover, rename and the outline know connections and the flows they list.
  A flow a connection lists twice counts once.

## 0.31.0

### Minor Changes

- 11b78ee: `loadmap check --base origin/main` compares each definition with itself at a git ref, both against the same data
  (`--pull` reads the measures of both). It fails when the first limit's headroom drops by more than `--tolerance`
  (`10%` by default, or `0.5×`), when the first limit moves to another component without more headroom, or when a
  component crosses the target or 100 % from below at today's load; each is an annotation on the component's line.
  `--accept "<reason>"` turns them into warnings. `--comment <file>` writes the pull request comment (one sentence, what
  fails, each component's headroom before and after, the assumptions with their sources) behind a marker; the guide
  has a workflow that posts it and keeps it up to date, with fork pull requests checked against the committed
  snapshot. `compareDefinitions(base, head)` in `@loadmap/core` is the comparison, and the JSON result and the job
  summary carry it.
- 0ab6855: Every expectation ends pass, fail or inconclusive (`check()` gives `outcome` and `reasons`; `ok` is a pass).
  Inconclusive is an answer that rests on what is not known: it holds at the high edge of a ± but not at the low one, a
  component has no published benchmark, or measured data it reads is missing or too thin. `expect { …; severity: warn
  }` is reported and never fails a run. `loadmap check` reports an inconclusive expectation as a warning (it failed
  before when only a ± or a missing benchmark decided it); `--inconclusive fail` fails on it. `--pull` reads the
  measures first and checks against them, `--snapshot <file>` against a snapshot already written, `--dry-run` reports
  everything and exits 0, `--json <file>` (and `--format json`) writes the run's result keyed by the commit, and under
  GitHub Actions a table of the expectations goes into the job summary.
- 717b95e: `loadmap drift x.loadmap (--snapshot now.json | --pull) --history dir/` finds what moved in the measured data while
  no line of the definition did. Change points in each value across main's runs (E-divisive, kept only below a Welch
  t-test's `--p-value`, 0.001 by default, as Apache Otava), named by the latest deploy before them in `--markers`; each
  series against the last run's new points by a Mann-Whitney U test at 98 % with a 5 % dead zone (as Kayenta); and each
  measured value, fit slope (above) and the first limit's headroom (below) against the band of main's last 30 runs
  (`t_test`, `percentage` or `iqr`, as Bencher). It exits 1 on a drift and 3 when it cannot look; `--json` writes the result and `--issue` the body of an
  issue. The statistics are `@loadmap/core/drift` (`changePoints`, `compareWindows`, `mannWhitney`, `threshold`,
  `welch`), deterministic and with no dependencies. The guide has a nightly workflow that keeps the history in the
  Actions cache and one issue up to date.
- de327ef: Latency as an output: `service` on a component (the seconds a unit takes when nothing waits) makes each stage it runs
  a queue whose time grows as service ÷ (1 − utilization); a flow's time through is the sum of its stages, fitted to a
  gamma per way and mixed over its ways, and `ev.latency` gives its mean, p50, p95 and p99. An expectation holds a
  percentile under a time, `{ flow: orders; p99: 0.5; target: 8 }`, on the pessimistic edge; `loadmap check --base`
  shows each flow's p99 against its base, and the Live panel each flow's p99.
- b9b71c3: A component can count slots instead of a rate: `held` (seconds a unit holds a connection, a session, a thread) makes
  its demand the slots in use by Little's law, what reaches its stages times `held`, one time for every flow or one per
  flow; `on` names the stages for a pool beside the limit that runs them. `held: 0.02` or `held { orders: 0.02 }` in the
  language. The `slots` measurements set its capacity and its time held.
- 0097fc9: A `split` stage sends each unit on one way of several, by share: a read/write split, shards, regions, an A/B test,
  failover. In the language, one `flow -> stage -> …: share` line per way inside `split { … }` on a box; in TypeScript,
  `split({ to: [{ stages: ['primary'], share: 0.2 }, …] })`. A flow's shares add up to 1 (formulas of the parameters
  allowed) and a flow the split does not name goes straight on; a way that ends in a store, a sink or a fan-out ends
  there, any other goes on with the route after the split. The model works out each flow's ways (`ev.paths`), and what
  reaches each stage, the demand, the rejections and the retries add up over them; the dots each take one way, drawn by
  share, and a model without a split draws exactly what it drew before. The search example's index is now two shards
  behind a coordinator.
- ed5d6d2: Timeouts: `timeout` on a flow (seconds) fails the share of its units slower than it, from the latency of its way; with
  `retry` they are sent again, which loads every stage and slows it further, settled at the least fixed point. The
  retry solve now holds that share while it settles the attempts, and stops at the least fixed point where a share
  can meet the attempts twice. `ev.latency[f].timedOut`, a Live meter, and the sim fades that share of dots as timed
  out. `timeout: 2` in the language.

## 0.30.1

No changes in this release.

## 0.30.0

### Minor Changes

- 1f11726: Measured data reaches a model as a snapshot: a JSON file with each measurement's value, its points and its origin
  (the provider, the query, the window, the step, when it was read, how many samples). `@loadmap/core/measure` (and
  `@loadmap/react`) has `parseSnapshot`, which checks an opened file as untrusted input, and `fromSnapshot`, whose
  `capacity`, `value` and `fit` read it inside model functions and fall back to the definition's own value, with why,
  when a measurement is missing or has fewer samples than its `min`. A capacity read so is `measured`, its `origin` and
  source say where it came from; `defineModel({ snapshot })` lists every measurement with the assumptions, and the
  Assumptions panel shows them. `MEASURES` is the standard set of measurements per kind (flow, pass, queue, workers,
  cache, limit, store, fan-out, and the split and slots to come), each with its role, unit and what it sets;
  `summarize` turns a window into one value. `docs/dsl.md` has the table and the format.

## 0.29.0

No changes in this release.

## 0.28.0

No changes in this release.

## 0.27.0

### Minor Changes

- 6408be2: A component catalog: `published(kafka, { brokers: 3, … })` is a fourth kind of capacity, the figure published for a
  component (Apache Kafka, RabbitMQ, Valkey, etcd, CockroachDB, ClickHouse, NGINX, HAProxy, CoreDNS, Kubernetes, and
  more) under the conditions it was run with, its source linked, its version and who ran it kept as metadata. The data
  is `@loadmap/core/catalog` (or `@loadmap/react/catalog`), off every first load; editions pin the numbers. A figure is
  a best case (a `margin` only lowers it), a published limit is exact, and a configuration no run matches gets no number:
  the component is not ranked, the verdict says why, and an expectation that depends on it fails.

### Patch Changes

- 4346ee1: The `.loadmap` language takes published figures: `published brokersRef kafka { edition: "2026-11"; brokers: 3; … }`
  names a component of the catalog and the conditions of its run, and `capacity: brokersRef` uses the figure. The
  checker names a component, condition, edition or figure that does not exist (and which component covers `redis`),
  warns when the conditions written match no published run, and says when a later edition has other figures;
  autocomplete offers the components, their conditions and the values their runs used, hover the figure with its
  conditions and source. The catalog loads only for a text that names it: `loadCatalog()` (and `needsCatalog(text)`)
  from `@loadmap/dsl`; `<LoadmapSource>`, the editor, the CLI and the language server load it themselves.

## 0.26.1

No changes in this release.

## 0.26.0

No changes in this release.

## 0.25.0

No changes in this release.

## 0.24.0

No changes in this release.

## 0.23.0

No changes in this release.

## 0.22.0

No changes in this release.

## 0.21.0

No changes in this release.

## 0.20.0

No changes in this release.

## 0.19.1

No changes in this release.

## 0.19.0

No changes in this release.

## 0.18.0

No changes in this release.

## 0.17.1

No changes in this release.

## 0.17.0

No changes in this release.

## 0.16.0

No changes in this release.

## 0.15.0

No changes in this release.

## 0.14.0

No changes in this release.

## 0.13.0

No changes in this release.

## 0.12.0

### Minor Changes

- 497f671: No scenario, story step, preset or control moves a box any more. ELK lays out every box at the largest size it takes
  anywhere the model reaches, and each box is drawn at its own size in the middle of that slot: a pool that gains pods
  grows where it stands and its neighbours stay put. What it reaches: the defaults, each scenario, story step and
  declared preset, and every combination of the controls (a range at each step, or at points across a long one); past
  256 combinations, each control's options one at a time from each scenario, step and preset. Edges leave and enter a
  box at the middle of its sides, and an edge that comes or goes (`when`) keeps its room. Values nothing declared
  reaches (a combination past that bound that draws a box larger) lay out again, as before.

  `model.stagesAt(values)` gives the stages and the context they resolve in, without the crossings and the verdict: what
  a drawing needs, cheap enough to call for many values.

## 0.11.0

No changes in this release.

## 0.10.0

No changes in this release.

## 0.9.0

### Minor Changes

- 7c5d7b3: Play tells the story on the diagram: the whole diagram first, then for each step a close-up on what it changes (the box
  it points at and any box it reshapes, several framed together), the change, and the whole diagram again for the step's
  `seconds`, with a short title on the board. A step's new `title` (`StoryStepDef.title`, `title:` in `.loadmap`) names
  it there; without one the title says what changes ("Users 1× → 20×"). The camera runs on the engine's clock and moves
  the view, never the board; with reduced motion it cuts. The component that runs out first wears a ring and a tag that
  breathe while the story plays and once it is past the target.

  `ref.playStory()` plays it on the engine's clock (`step()` advances it); `recordVideo({ story: true })` and
  `loadmap record --story` record it that way, from the defaults, the same options giving the same file. The controller
  gains `lm.cue`. A render React makes of older values no longer hands the engine their numbers.

## 0.8.0

No changes in this release.

## 0.7.0

No changes in this release.

## 0.6.0

### Patch Changes

- 9fe4c1a: A flow whose rate is a constant (`rate: 20 / 86_400`, or `rate: 40` in TypeScript) compiles and runs: it stays the
  same at any load. An error raised while computing a flow now points at that flow, not at the formula that happened
  to read it first; a preset or a scenario that breaks it keeps pointing at the preset or the scenario. An error that
  only loadmap's own code can cause, such as a TypeError, says it is a bug in loadmap and how to report it, with the
  original text as the hint, instead of showing loadmap's internal names; one from a host function is that function's.

## 0.5.0

No changes in this release.

## 0.4.0

No changes in this release.

## 0.3.1

No changes in this release.

## 0.3.0

### Minor Changes

- 294378d: Light editing for readers: `<LoadmapEditor layout="reader">` shows the diagram with an inspector (a box's label,
  capacity and parameters; the model's load, growth and flows), each change a small edit of the text, and a shared link
  opens that way on the docs site. `format()` and `loadmap fmt` (`--check` for CI) lay a definition out the one way.
  `<Loadmap onNodeClick selected>`; in the editor a click on a box selects its lines, and **Format** (Shift+Alt+F).

## 0.2.0

### Minor Changes

- 2a8118b: Building blocks: a cache stage (hits answered and sent back), an autoscaled workers pool (min, max, target; a pods
  meter), a rate limiter (`limit` with a `configured` capacity) and retries that settle past capacity (`retry` with a
  budget). `at.<stage>.<flow>` reads what reaches a stage, a component without a demand takes it, and four new
  templates show each block.

## 0.1.1

### Patch Changes

- Published from GitHub Actions with npm trusted publishing: every package now carries a provenance statement that ties
  it to its commit and workflow.
