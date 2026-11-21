# @loadmap/sim

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
