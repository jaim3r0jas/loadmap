# @loadmap/core

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
