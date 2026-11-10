# @loadmap/cli

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
- 9cf2028: A metric can read from Elasticsearch or OpenSearch: `elasticsearch { index: "auth-*"; query: '{"term": {"service":
  "{{ args.service }}"}}'; agg: rate }` reads an index as a date histogram at the step, documents per second (`rate`,
  the default) or per step (`count`), or the `avg`, `sum`, `min` or `max` of a `field`; `time` names the time field.
  A measure's argument goes into the query JSON escaped. The checker refuses a field aggregation without a field, a
  count with one, a query that is not JSON and an index that is not a name or a pattern. `elasticsearch()` in
  `@loadmap/providers` sends the search; a window where nothing matches is missing, not zero. `loadmap pull` takes
  `LOADMAP_ELASTICSEARCH_URL` with `LOADMAP_ELASTICSEARCH_API_KEY` (or a user and password). Both providers move a user
  and password written in the address into the header.
- de327ef: Latency as an output: `service` on a component (the seconds a unit takes when nothing waits) makes each stage it runs
  a queue whose time grows as service ÷ (1 − utilization); a flow's time through is the sum of its stages, fitted to a
  gamma per way and mixed over its ways, and `ev.latency` gives its mean, p50, p95 and p99. An expectation holds a
  percentile under a time, `{ flow: orders; p99: 0.5; target: 8 }`, on the pessimistic edge; `loadmap check --base`
  shows each flow's p99 against its base, and the Live panel each flow's p99.
- 0fb5d08: The language maps a model onto measured data, and `loadmap pull` reads it. A `metric` is a query written once
  (`prometheus { query: '…{{ args.job }}…' }`, with a `stat` and a `min` of samples); a `measure` is one use of it,
  with its arguments and a `fallback`, and its id is a capacity or a number as its fallback is (`capacity: apiCapacity`,
  `rate: orderRate * load`). A `fit` with `x` and `y` naming two measures is fitted from their series. `compile(source,
  { snapshot: fromSnapshot(parseSnapshot(text)) })` reads a snapshot; without one every measure is its fallback, and
  `compile(…).measures` lists each query with its arguments filled in. The checker names an unknown metric, an argument
  a query needs or never uses, a fallback that is neither a capacity nor a number; completion, hover, rename and the VS
  Code grammar know the new statements. The new `@loadmap/providers` reads Prometheus (`/api/v1/query_range`, one
  series per query, errors as data) and writes the snapshot (`pull`); `loadmap pull x.loadmap [--window 7d] [--step
  5m] [--to …]` writes `x.snapshot.json` next to the definition, with the address and the credentials from
  `LOADMAP_PROMETHEUS_URL` and `LOADMAP_PROMETHEUS_TOKEN` (or a user and password), never from the text.

## 0.30.1

No changes in this release.

## 0.30.0

No changes in this release.

## 0.29.0

No changes in this release.

## 0.28.0

No changes in this release.

## 0.27.0

### Minor Changes

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

### Minor Changes

- b765c94: `loadmap lsp`: the language server protocol over standard input and output, so Neovim, Helix and any editor that
  speaks it get the docs' editor's help for `.loadmap` files: errors and failing `expect` lines as you type (after a
  pause), completion with snippets, hover with the values at the defaults (the last version without errors while the
  text has one), the arguments of a call, formatting, quick fixes as code actions, go to definition, references,
  highlights, rename (refused with the reason) and an outline of what the definition declares. One file at a time, the
  whole text on each change; nothing but Node, and no Playwright. The language guide shows the setup for Neovim and
  Helix.

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

No changes in this release.

## 0.11.0

No changes in this release.

## 0.10.0

No changes in this release.

## 0.9.0

### Patch Changes

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

### Minor Changes

- 56bdf56: `loadmap check`, `loadmap fmt` and `loadmap --help` run without Playwright: it is an optional peer dependency now
  (any version from 1.40), loaded only by `loadmap record`, so a CI step that only checks a model does not download a
  browser driver. A project that records installs it next to the command, `npm i -D @loadmap/cli playwright`, then
  `npx playwright install chromium`; `npx @loadmap/cli record` alone no longer finds it, since npx never installs an
  optional peer. Without it, `record` says so before doing any work.

## 0.5.0

### Patch Changes

- c1651c6: Full screen fits the screen without scrolling. The diagram stays on top, as wide as the screen; under it the verdict in
  one line (the load, how far the target holds, the first limit, how sure its capacity is) and the panels `fullScreen`
  lists in a compact form, side by side in a box the screen sizes: Live as small meters, where it runs out a line per
  component, the controls a line each, headroom as a sparkline, compare its first table, the assumptions a count. Rows
  that do not fit are left out whole and counted; each compact panel, "Why" and the assumptions open the panel whole over
  the diagram (its button closes it, and Esc in the overlay; the browser's own full screen takes Esc for itself). A phone
  shows one panel at a time under tabs, and pans the diagram in its own box. Nothing the load changes moves the board.

  A switch beside Close, or the F key, turns full screen into focus: the diagram, the story under it, and the verdict and
  the load slider when `fullScreen` lists them. `<Loadmap fullScreenMode="focus">` and `fullScreenMode: focus` in a
  `.loadmap` open full screen there (type `FullScreenMode`, default `'panels'`); the editor, the docs and the CLI viewer
  pass it on. The story bar gets Play: each step for its `seconds`, as `loadmap record --story` plays it, until the last
  or a value of the reader's own; its text keeps the room of the longest step.

  The controller has the state: `fullScreen`, `toggleFullScreen()`, `fullScreenMode`, `setFullScreenMode()`,
  `storyPlaying`, `setStoryPlaying()`. `<Loadmap>`'s `.lm-side` is now also `.lm-drawer`; a page of its own keeps its
  `.lm-side` under the board, in a box that scrolls on its own. `.lm-corner` is gone: nothing scrolls Close away.

## 0.4.0

### Patch Changes

- bca623f: Full screen shows the diagram as wide as the screen, and below it every panel of the page: the verdict, Live and
  where it runs out beside the controls, then the headroom chart, the scenarios compared and what it assumes; the whole
  view scrolls, and the diagram never moves with the load. `<Loadmap fullScreen={['verdict', 'live', 'controls']}>`
  keeps only the panels it lists (`LOADMAP_PANELS`, type `LoadmapPanel`), and `fullScreen: [verdict, live, controls]`
  in a `.loadmap` does the same in the editor, the docs and `loadmap record`. A diagram in a narrow column turns to run
  left to right in full screen. Scrolled down to the panels, Close waits in the corner. `<Loadmap>` now wraps each
  panel in a `div.lm-panel` (`data-panel` names it), and `.lm-more` is gone: CSS that selected a panel as a child of
  `.lm-side` needs `.lm-panel` in between.

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
