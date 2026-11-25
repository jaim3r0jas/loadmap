# @loadmap/sim

## 0.47.0

### Minor Changes

- 1604406: A breaker with retries: a flow may have a `breaker` and its client's `retry` together, where it took one of them.
  Each attempt goes through the breaker, and a call it fails fast is a failed attempt, sent again like any other. The
  rate the breaker admits is the one at which the failures behind it reach `opens`, whatever is sent, so the retries
  still settle at their least point, as many units fail for good as without the breaker, and the stages behind it see
  what it admits, not the storm. `ev.breakers.<flow>.failedFast` counts attempts, and what is lost for good is shared
  between the stages and the calls failed fast. On the board a retry goes through the breaker as the first attempt did.
  A retry `at` a hop still takes no breaker. This lifts an error, so a file of any version reads it.

  Docs: /language/building-blocks/#lost-units
- 253c67e: Failures that are not about capacity: `fails: 2%` on a component is the share of the units its stages work on that
  fail there whatever the load, a bug, a dependency that errors or a bad deploy. A failed unit is a new loss, `failed`:
  a lost box takes it (`lost { takes: [failed] }`, and a box without `takes` takes it too), its dot goes there, the
  flow's retries send it again, it counts toward the share that opens a breaker, a fallback serves it, and
  `expect { lost }` holds it. The stages after the one that failed it are reached by the rest, in `at` too. It reads
  the load and the parameters, so a scenario can be the bad deploy. A component that fails with no lost box for it warns
  (`unseen-loss`), with the quick fix that adds the box. In TypeScript: `fails: 0.02` on the component;
  `ev.stages.<id>.fails` is the share at the values. From `loadmap 1.8`.

  Docs: /language/building-blocks/#lost-units
- 8b007aa: A fan-out branch that goes on: `orders -> mailQueue -> mailers -> smtp: 1` copies each order into a queue, to the
  workers that read it and on to what they call, where a branch was one stage. The copies reach every stage of the
  branch (`at.mailers.orders`), each stage runs its component and is ranked like any other, a queue on the branch fills
  when its reader is full, the dots go the whole way, and an edge joins each pair of boxes along it. A branch goes
  through queues, pools and `pass`, `cache`, `limit`, `store` and `sink` stages; it takes no split and no second
  fan-out, and it never comes back to the route. This is how the asynchronous side of a system is written: email, search
  indexing, a replica that follows a log. In TypeScript a branch is `{ stages: ['mailQueue', 'mailers', 'smtp'], share:
  1 }`, and a resolved branch carries its `stages`. From `loadmap 1.8`.

  Docs: /language/building-blocks/#fan-out-and-sinks
- 7dca4d6: A hedge on a gather: `hedge: 95%` sends a second call for each one not answered by the p95 of its own time, and the
  first of the two answers counts. What is called sees the second calls (5 % more at 95 %), and the unit's wait for the
  calls it needs is shorter in the tail: a read that waits for 8 calls of 10 ms has its p99 fall from 64 ms to 51 ms. The wait is
  summed over the survival of a hedged call, since the slowest of several has no closed form then. The second call
  takes the edge's delay too. A call that fails is not sent again by a hedge. In TypeScript, `gather({ to, needs,
  hedge: 0.95 })`. From `loadmap 1.8`.

  Docs: /language/building-blocks/#gathers
- 65f637c: A gather: one unit makes several calls at once and goes on when enough of them have answered. `gather { reads ->
  shards: 8; needs: 6 }` is a read from every shard, a quorum write, a page built from many services. The stage it calls
  sees every call (8 a read) and is ranked on that; the unit waits for the slowest call it needs, which is in its
  latency (the 6th of 8 answers, from the calls' mean time); and it fails when too few answer, a loss at the gather
  that a lost box takes and `expect { lost }` holds (a stage failing 1 % of its calls fails 7.7 % of the units that need
  all 8). A call is a copy on a branch, so the line takes what a fan-out's does, a branch that goes on included. Unlike
  a fan-out it does not end the route. In TypeScript, `gather({ to: [{ stage: 'shards', share: 8 }], needs: 6 })`. From
  `loadmap 1.8`.

  Docs: /language/building-blocks/#gathers
- 1aac4d6: A queue with a size: `holds: 10_000` on a queue makes it a bounded queue, a buffer, a mailbox. Once its reader is past
  full the queue fills, and what the reader cannot take is turned away: `rejected` at the queue, so a retry sends it
  again, a lost box counts it and `expect { lost }` sees it. `full: block` turns the unit away at the stage before the
  queue instead. With a drop rule the queue takes in `holds` ÷ `olderThan` a second: what arrives above that finds it
  full, and what it took in and its reader cannot take gets too old. A queue with a size and no lost box for what it turns away has a warning.
  For a moment that `lasts`, the verdict says when the queue is full, and the board keeps no more waiting than it holds.
  In TypeScript, `queue({ partitions, holds, whenFull })`, and `backlog()` gives `full: { holds, after }`. From
  `loadmap 1.8`.

  Docs: /language/building-blocks/#queues
- 4f3a2e4: A region goes out: `domain region "Region" { parts: [eu, us] }` names a domain's parts, a box or a subsystem is `in`
  one (`in: eu`), and the Outage control takes each part out by its id (`down: eu`). With a part down its boxes are
  switched off and every split deals again: a way through the part gets nothing and the ways left take its share by
  their own, evenly when theirs are all 0. A flow with no way left is turned away at the split, and what reaches a box
  of the part with no split in front is turned away there. The N−1 line answers for each part ("With the EU out, the
  50 % target holds up to 2×"), `down: region` in an expect holds the worst of the parts, and a formula reads
  `down.eu` and `down.region`. In TypeScript, `parts` on a domain and `in: { domain, part }` on a component. From
  `loadmap 1.8`.

  Docs: /language/building-blocks/#failure-domains
- c0ac379: Retries at a hop: `retry { at: payments; times: 2 }` is the caller of payments calling again. What fails at that stage
  or after it is sent again from there, so only the stages from it on see those attempts. A flow takes one rule without
  `at` (its client's, as before) and one for each stage, and retries inside retries multiply: the attempts a stage sees
  are the product of every rule around it, and an attempt fails only when every attempt inside it does. The rules are
  solved together, the hops inside the client's. `ev.retry.<flow>.hops` gives each hop's attempts a unit, its failing
  share and what fails every attempt there; the Live panel shows the attempts at each hop; a dot sent again at a hop
  starts there. In TypeScript `retry` takes a list: `[{ times: 1 }, { at: 'payments', times: 2 }]`. A timeout stays the
  client's. From `loadmap 1.8`.

  Docs: /language/building-blocks/#retries

### Patch Changes

- Updated dependencies [3c5c29f]
- Updated dependencies [1604406]
- Updated dependencies [253c67e]
- Updated dependencies [4613370]
- Updated dependencies [3b4c2d3]
- Updated dependencies [0d5900f]
- Updated dependencies [8b007aa]
- Updated dependencies [7dca4d6]
- Updated dependencies [65f637c]
- Updated dependencies [7068652]
- Updated dependencies [59e9179]
- Updated dependencies [47d5230]
- Updated dependencies [3d5a64f]
- Updated dependencies [a1b9a99]
- Updated dependencies [9c0e192]
- Updated dependencies [732644f]
- Updated dependencies [1aac4d6]
- Updated dependencies [4f3a2e4]
- Updated dependencies [c0ac379]
  - @loadmap/core@0.47.0

## 0.46.0

### Minor Changes

- 37f77bd: A circuit breaker: `breaker { opens: 50% }` on a flow (language 1.7; `breaker: { opens }` in TypeScript). Past that
  share of its attempts failing, its callers fail calls fast. In steady state it admits the share α at which the
  failures among what it admits are `opens`, p(α·rate) = opens, found by a bracketed root search; below that it
  stays closed. What it fails fast reaches no stage: it goes to the flow's fallback, if any, and on the board fades at
  the source (`ev.breakers.<flow>`: `admitted`, `failedFast`). A flow that retries takes no breaker.

  Docs: /language/building-blocks/#lost-units
- c5a8b15: The dots keep running across an edit that leaves every flow, stage and route as it was (a figure, a name, a box's
  look): the backlog, the busy workers and every dot stay, and the new figures apply as new values do. `Sim` has
  `adopt(model, ev)` for it, false for a model that is another structure; such a model still starts its sim over.

  Docs: /api/react/#useloadmap-and-the-controller
- 00a1e85: A fallback: `fallback { after: api; route: staleQuotes }` on a flow (language 1.7; `fallback: { after, route }` in
  TypeScript). What the flow fails for good, turned away or too slow after every retry, goes back to `after` and is
  served along `route`: each fallback stage sees that rate (`ev.fallbacks.<flow>.rate`) and may run out like any other.
  A lost box on the route counts none of it; one behind a fallback stage counts what that stage turns away. On the board
  a failed dot fades where it failed and a dot sets out from `after` along its edge to the fallback, which needs that
  edge (`missing-edge`). The budgets go to 74, 230 and 140 kB.

  Docs: /language/building-blocks/#lost-units
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

### Patch Changes

- Updated dependencies [b547540]
- Updated dependencies [37f77bd]
- Updated dependencies [00a1e85]
- Updated dependencies [f89851d]
- Updated dependencies [a993b1b]
- Updated dependencies [9222ee2]
- Updated dependencies [66323a1]
- Updated dependencies [56e90eb]
- Updated dependencies [a4b725f]
- Updated dependencies [0aef603]
- Updated dependencies [3f8470d]
  - @loadmap/core@0.46.0

## 0.45.0

### Patch Changes

- @loadmap/core@0.45.0

## 0.44.0

### Patch Changes

- @loadmap/core@0.44.0

## 0.43.0

### Patch Changes

- @loadmap/core@0.43.0

## 0.42.1

### Patch Changes

- @loadmap/core@0.42.1

## 0.42.0

### Patch Changes

- @loadmap/core@0.42.0

## 0.41.0

### Patch Changes

- @loadmap/core@0.41.0

## 0.40.0

### Patch Changes

- @loadmap/core@0.40.0

## 0.39.0

### Patch Changes

- @loadmap/core@0.39.0

## 0.38.1

### Patch Changes

- @loadmap/core@0.38.1

## 0.38.0

### Patch Changes

- Updated dependencies [7bd53ff]
  - @loadmap/core@0.38.0

## 0.37.0

### Patch Changes

- Updated dependencies [10197af]
  - @loadmap/core@0.37.0

## 0.36.0

### Patch Changes

- @loadmap/core@0.36.0

## 0.35.0

### Patch Changes

- @loadmap/core@0.35.0

## 0.34.0

### Patch Changes

- @loadmap/core@0.34.0

## 0.33.0

### Minor Changes

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

- 8b8bfca: A unit is lost once. A flow with a `drop` rule and a `timeout` counted what its queue dropped again as timed out, so a
  lost box (and `at.<box>`) could show more units a second than the flow sends; with `retry` the dropped units were sent
  again too. Now a dropped unit is lost at its queue, never sent again and never too slow, as the dots already showed.
  The losses are counted way by way: a split's ways and a cache's answers no longer share one "got through" figure, a
  queue on several ways drops on each, and a pass, limit or cache that reads a dropping queue turns away only what still
  reaches it, in the dots too. Checking the lost boxes walks each flow's ways once.
- Updated dependencies [189d8db]
- Updated dependencies [9065003]
- Updated dependencies [91c3aad]
- Updated dependencies [8b8bfca]
- Updated dependencies [bb279a9]
  - @loadmap/core@0.33.0

## 0.32.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [f2c3fd3]
- Updated dependencies [c302028]
- Updated dependencies [9cc0ccd]
- Updated dependencies [53b93be]
- Updated dependencies [7f55166]
- Updated dependencies [55c4e7f]
  - @loadmap/core@0.32.0

## 0.31.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [11b78ee]
- Updated dependencies [0ab6855]
- Updated dependencies [717b95e]
- Updated dependencies [de327ef]
- Updated dependencies [b9b71c3]
- Updated dependencies [0097fc9]
- Updated dependencies [ed5d6d2]
  - @loadmap/core@0.31.0

## 0.30.1

### Patch Changes

- @loadmap/core@0.30.1

## 0.30.0

### Patch Changes

- Updated dependencies [1f11726]
  - @loadmap/core@0.30.0

## 0.29.0

### Patch Changes

- @loadmap/core@0.29.0

## 0.28.0

### Patch Changes

- @loadmap/core@0.28.0

## 0.27.0

### Patch Changes

- Updated dependencies [6408be2]
- Updated dependencies [4346ee1]
  - @loadmap/core@0.27.0

## 0.26.1

### Patch Changes

- @loadmap/core@0.26.1

## 0.26.0

### Patch Changes

- @loadmap/core@0.26.0

## 0.25.0

### Patch Changes

- @loadmap/core@0.25.0

## 0.24.0

### Patch Changes

- @loadmap/core@0.24.0

## 0.23.0

### Patch Changes

- @loadmap/core@0.23.0

## 0.22.0

### Patch Changes

- @loadmap/core@0.22.0

## 0.21.0

### Patch Changes

- @loadmap/core@0.21.0

## 0.20.0

### Patch Changes

- @loadmap/core@0.20.0

## 0.19.1

### Patch Changes

- @loadmap/core@0.19.1

## 0.19.0

### Patch Changes

- @loadmap/core@0.19.0

## 0.18.0

### Patch Changes

- @loadmap/core@0.18.0

## 0.17.1

### Patch Changes

- @loadmap/core@0.17.1

## 0.17.0

### Patch Changes

- @loadmap/core@0.17.0

## 0.16.0

### Patch Changes

- @loadmap/core@0.16.0

## 0.15.0

### Patch Changes

- @loadmap/core@0.15.0

## 0.14.0

### Patch Changes

- @loadmap/core@0.14.0

## 0.13.0

### Patch Changes

- @loadmap/core@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [497f671]
  - @loadmap/core@0.12.0

## 0.11.0

### Patch Changes

- @loadmap/core@0.11.0

## 0.10.0

### Patch Changes

- @loadmap/core@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [7c5d7b3]
  - @loadmap/core@0.9.0

## 0.8.0

### Patch Changes

- @loadmap/core@0.8.0

## 0.7.0

### Patch Changes

- @loadmap/core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [9fe4c1a]
  - @loadmap/core@0.6.0

## 0.5.0

### Patch Changes

- @loadmap/core@0.5.0

## 0.4.0

### Patch Changes

- @loadmap/core@0.4.0

## 0.3.1

### Patch Changes

- @loadmap/core@0.3.1

## 0.3.0

### Minor Changes

- 294378d: Light editing for readers: `<LoadmapEditor layout="reader">` shows the diagram with an inspector (a box's label,
  capacity and parameters; the model's load, growth and flows), each change a small edit of the text, and a shared link
  opens that way on the docs site. `format()` and `loadmap fmt` (`--check` for CI) lay a definition out the one way.
  `<Loadmap onNodeClick selected>`; in the editor a click on a box selects its lines, and **Format** (Shift+Alt+F).

### Patch Changes

- Updated dependencies [294378d]
  - @loadmap/core@0.3.0

## 0.2.0

### Minor Changes

- 2a8118b: Building blocks: a cache stage (hits answered and sent back), an autoscaled workers pool (min, max, target; a pods
  meter), a rate limiter (`limit` with a `configured` capacity) and retries that settle past capacity (`retry` with a
  budget). `at.<stage>.<flow>` reads what reaches a stage, a component without a demand takes it, and four new
  templates show each block.

### Patch Changes

- Updated dependencies [2a8118b]
  - @loadmap/core@0.2.0

## 0.1.1

### Patch Changes

- Published from GitHub Actions with npm trusted publishing: every package now carries a provenance statement that ties
  it to its commit and workflow.
- Updated dependencies
  - @loadmap/core@0.1.1
