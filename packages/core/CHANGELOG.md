# @loadmap/core

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
