# loadmap

A TypeScript and React library for interactive capacity models: an architecture diagram whose parts are live (dots
show the flow, controls change the load and the design, a ranked list shows which component runs out first and at
what multiple of today's load). `README.md` has the picture; `docs/prior-art.md` the research behind the choices;
`docs/lessons.md` what a hand-built page taught.

## Stack

pnpm workspaces · TypeScript 7 (strict, `noUncheckedIndexedAccess`) · tsdown (build) · Vitest 5 (Node, and browser
mode on Playwright Chromium) · Biome (lint and format) · Vite 8 + React 19 (peer: `^19`, for `ref` as a prop). Node 24: `nvm use`; every script
stops first with that hint on an older Node (`scripts/node-version.mjs`). The packages are `packages/*`: each
`package.json` says what it holds and what it depends on.

`examples/checkout` (the small reference), `examples/alerts` (two topics on shared brokers, merge, fan-out) and
`examples/search` (a rate limiter, an autoscaled pool, a cache and retries, laid out stable) and `examples/regions`
(two regions as copies of one subsystem, in several files: a model, its story, two libraries and a variant) hold the
end-to-end tests,
each also written as a `.loadmap` that must draw exactly what its TypeScript draws (`definition.test.ts`,
`examples/roundtrip.ts`). `apps/docs` is the docs site (`pnpm dev`): the examples (walkthroughs and the templates as starters) and the editor
live (its rules: `apps/docs/CLAUDE.md`). `docs/dsl.md` is the language guide: the site includes it, the build writes it
with `docs/every-statement.loadmap` into `llms-full.txt`, and the dsl build copies it into its `dist/REFERENCE.md`.
`docs/every-statement.loadmap` must hold every statement of the schema (`docs.test.ts`); what one file cannot hold (a
part, a library, a variant) is in `docs/multi-file/`. `examples/shop-live` is a simulated shop with Prometheus and
Grafana (compose) and a page that pulls its measures while open: the docs' Live data page, held by the `shop-live`
workflow, which runs only when it changes. `examples/checkout/split/` and `examples/alerts/split/` are those
examples in several files, held to the same `model.ts` and `view.ts` (`split.test.ts`). Recording a page or a `.loadmap` (`pnpm record`, `expose()`):
the `record` skill.

## Verification

`check` runs on CI in parallel parts, each on a runner of its own; `scripts/check.mjs` holds them and the workflow runs
`pnpm check:part <part>`:

| Part     | What it runs                                                               |
| -------- | -------------------------------------------------------------------------- |
| static   | typecheck, biome check, the changesets, build, budget                      |
| node     | the node tests, but the two that drive Chromium                            |
| chromium | the docs site and the cli tests (`scripts/chromium-node-tests.json`)       |
| browser  | the browser tests                                                          |
| vscode   | the extension as it ships in a pinned VS Code (xvfb on CI), then its .vsix |
| pack     | `pnpm verify:pack`                                                         |

Locally, run only what this branch's changes reach, split the same way, and leave every whole part to CI (the Mac runs
several sessions at once; a full run times out tests that are fine):

```bash
pnpm check:changed --dry   # the plan: the tests and parts the changes reach (against origin/main, with uncommitted and new files)
pnpm check:changed         # typecheck, biome on the changed files, then those tests part by part
```

It takes a changed test file; for a changed source file, the tests named after it (`src/compile.ts`:
`test/compile.test.ts`, also `.browser.test`) and those importing it by its path; an example's own node tests;
`docs.test.ts` for `docs/dsl.md`; zizmor for `.github/`; the budget for a package a page loads first; the VS Code e2e
for `packages/vscode` or the cli's `lsp`; `verify:pack` for a package's exports, dependencies or build, or the lockfile.
A test that reaches a file only through an index is CI's. Never run a whole package, a folder, a whole part or
`pnpm check` locally (`pnpm check:part <part>` is for CI and for a part that failed there and must be reproduced, one
test file at a time first). `pnpm check` runs every part in a row for the release.

Then push and watch CI from the session until every part has finished: a Monitor that polls
`gh pr checks <n> -R jaim3r0jas/loadmap --json name,bucket,link` every 60 s, prints each part as it finishes, and
exits once none is pending (re-armed when it expires). A red part: read its log (`gh run view <run> --log-failed`, or
`gh api --allow-escape-sequences repos/jaim3r0jas/loadmap/actions/jobs/<job>/logs` while the run is still going), fix
it, push, watch again. A session wraps up only once `check` is green on its last push.

The browser tests need Chromium once: `pnpm exec playwright install chromium`. They write screenshots to
`__screenshots__/` next to each test (ignored by git). The budget fails when a `<Loadmap>` page loads more than 70 kB
gzip of loadmap first, the editor adds more than 221 kB, an embed loads more than 130 kB first, or ELK is in a first
load. `verify:pack` packs every package, installs the tarballs with npm in a fresh Vite app outside the monorepo, runs
tsc, builds, measures the budget, and draws checkout and the react README's quick start in Chromium, built and in dev.
`pnpm --filter @loadmap/vscode package` makes the .vsix.

- Load nvm in every new shell before pnpm: `. ~/.nvm/nvm.sh && nvm use`. The default node on `PATH` can be a broken
  Homebrew build.
- "Cannot find native binding" from Vitest or tsdown: `pnpm install --force`. The lockfile has every platform, but a
  checkout installed on another Mac lacks this machine's binding.
- On a loaded machine (load 15+) the docs-site and recording tests can time out (Chromium contention): run the
  failing test alone before suspecting a hang.
- Never run a check and `git commit -a` in the background while still editing: it sweeps in files mid-edit. Commit by
  path once `pnpm check:changed` is green.
- Tests never depend on the wall clock: a busy machine (load 30+) breaks them. Time code with
  `process.threadCpuUsage()` (`process.cpuUsage()` counts every Vitest thread), and give an `expect.poll` after a new
  layout `{ timeout: 5000 }`.
- A browser test that compares two boards waits two frames after `ready()` before stepping (the board's
  ResizeObserver clears the canvas a frame later) and leaves out `.lm-meters` (they refresh on a 250 ms wall-clock
  timer).
- CodeMirror draws only the lines in view: a browser test that looks for a lint mark scrolls its edit into view first.
- A button that can become disabled or disappear while it holds the keyboard focus uses `aria-disabled` (or hands the
  focus to its container); a Playwright test then presses it with a DOM click.
- A test builds its model inline in `defineModel({ ... })`: a definition held in a variable first loses its literal
  types and fails the typecheck.
- `pnpm format` realigns a whole Markdown table when one row is wider than the rest: keep a new row within the
  table's column widths.

## Landing

Work lands on `main` only through a pull request: rulesets on GitHub require the `check`, `workflows` (zizmor) and
`dependency-review` jobs to pass on a branch up to date with main, keep the history linear and refuse force pushes and
deletion, with no bypass. Push the branch, `gh pr create`, `gh pr merge --auto --rebase`: it merges once green. Watch
the parts to the end from the session (Verification) before wrapping it up.

- Workflows: their rules are in `.github/CLAUDE.md`.
- `pnpm-workspace.yaml` refuses a dependency younger than 3 days, one whose trust dropped (lost provenance), one that
  wants an install script (`allowBuilds` after reading what it runs) and git or tarball dependencies deep in the tree.
  A fresh fix you must have now goes in `minimumReleaseAgeExclude` with its exact version.

## Conventions

- **No DOM or React in core, sim or layout.** They run in Node tests; React is only the binding.
- **Every capacity says where it came from**: `measured(...)`, `estimated(...)` or a `fitLinear(...)` result. The
  verdict and the assumptions list show it; never add a bare number as a capacity. A `within` (`± 30%` in the
  language) makes every crossing a range; the ranking, the first limit, presets, `compare()` and expectations use
  its pessimistic edge (every capacity at its low bound), and without a ± every text reads as before. An expectation
  that holds only at the high edge, or rests on measured data that is missing, is inconclusive: `loadmap check` warns
  unless `--inconclusive fail`.
- **A published figure applies only under its run's conditions** (`published(...)`, `@loadmap/core/catalog`, the
  `published` statement): one entry per component, vendors and versions as metadata (the version decides only where a
  source shows it changing the figure). Never scale, interpolate or invent one: a configuration no run matches has no
  published benchmark, is not ranked, and says so. Every number is read on its source page; a released edition never
  changes (`catalog.test.ts` snapshots it), a correction goes into the next. The catalog stays off every first load:
  hosts call `loadCatalogFor(text)` before they compile.
- **Dates only from `growth.asOf`**, never `Date.now()` or the locale: a page and its recordings say the same date
  on any day, on any machine.
- **Randomness only through `rng(seed)`** (`@loadmap/sim`). `Math.random` anywhere in sim, layout, engine or export
  breaks the identical-frames export test.
- **The sim never contradicts the bars.** A stage drains what its flows carry at the load where its component reaches
  `thresholds.full`; do not give the sim its own capacity numbers.
- **The load never moves the layout; with `layout: stable` no phase moves a box.** A phase is the values without the
  load and the range controls (a scenario, step, preset, choice of a select or switch). Labels reserve their widest
  text and boxes their largest size over the load range and every range control's points, with every edge any `when`
  draws along it, and a box is drawn at its own size in the middle of its slot. `compact` (the default) lays out each phase on its own, from its own values only (never from the phase
  before: recordings and `--story` depend on it), and `morph` moves the boxes between phases; `stable` lays out each
  box at its largest anywhere the model reaches. Only values nothing declared reaches lay out again.
  `examples/phases.ts` (`expectSteady`, `expectCompact`) and both examples' `layout.test.ts` hold these promises and
  the no-collision one.
- Model functions take one context object (`({ load, flows, at, util, demand, derived, ...params })`); `load`,
  `flows`, `at`, `demand`, `util` and `derived` are reserved parameter names.
- **`at.<stage>.<flow>` is what reaches a stage**: cache hits and a limiter's rejections are gone after them, an
  overloaded `pass` does not cut it (each limit stays "as if what is in front kept up"). The sim drains `at` and
  counts a stage's rejections against what is offered to it, as the retries do.
- **Retries are the one loop that is solved** (the least fixed point, on the excess attempts); any other loop between
  model functions stays an error that names it.
- Imports without extensions; package `exports` point at `src` for the workspace, `publishConfig.exports` at `dist`.
- **The public API is what a stranger imports**: `@loadmap/react` re-exports the model and view API (one install);
  format helpers live in `@loadmap/core/format`; what only loadmap's own packages need goes in a `./internal` entry
  (`@loadmap/dsl/internal`), which promises nothing between versions. A new export takes its final name now.
- Comments say why, not what.
- Text in the UI and the verdict: short plain sentences, numbers with units, `×` for load multiples, `%` with a space.
- The example and docs are generic: no figures, component names or links from anyone's employer.
- **Formulas in `.loadmap` never reach `eval` or `new Function`.** They are parsed and run as closures over the syntax
  tree; names resolve only to what the definition declares (`own()` for every lookup by a user-written name, so
  `constructor` finds nothing). A shared link is untrusted input.
- **The schema table (`packages/dsl/src/schema.ts`) is the one place a statement or property is added.** The checker,
  autocomplete, the inspector (`inspector: 'main'` puts a property first) and the reference in `docs/dsl.md` read it;
  `UPDATE_DOCS=1 pnpm test:node` rewrites that reference. What only an editor needs (completion, hover, the help across
  files, `flatten`) is exported through `help.ts`, an entry of its own: in `index.ts` it would ride along in every
  embed's first load.
- **A file that compiled under its `loadmap 1.N` keeps compiling and computing the same** (docs/dsl.md, "Versions";
  `packages/dsl/test/corpus/` holds the released files, never edited; each release adds its own). A change that
  refuses such a file or changes what it computes goes through `strict(version, …)` in compile.ts: a warning that says
  "(an error from loadmap 1.N)" before that version, an error from it on, with a quick fix keyed on its code. An old
  spelling warns and `format()` rewrites it (`layout: right`). Something new to read (a statement or property:
  `since` in the schema; syntax: `SYNTAX` in versions.ts) needs its version on the first line. `LANGUAGE_VERSION`
  (versions.ts) is the open minor until the release that ships it (a `@loadmap/dsl@` tag holds the commit that
  opened it), then frozen: the next change opens the next one,
  adds its row to the table in docs/dsl.md and moves every `.loadmap` in the repository to it. A new warning needs no
  version, and neither does a fix of a figure that was wrong (its changeset says so; the corpus snapshot moves with it).
- **Files are a front end.** A model's files (parts, libraries, a variant) are linked into one list of statements
  before the compiler reads them (`link.ts`), every `like` and `subsystem` written out (`expand.ts`): core, sim,
  layout and `<Loadmap>` never learn about files, and one file reads as it always did. The compiler reads no disk and
  no network: a host gives the files (`compile(source, { path, files })`), the cli and the language server only what
  is inside the project root. All files of one compile share one run of offsets (`Reporter.append`), so a span stays
  two numbers; what leaves the compiler goes through `report.local()` and says its `file`. A library reads its inputs
  and its own names, nothing of the model: `settle()` in expand.ts is where that holds.
- **The text is the one source.** An inspector change is `edit()`: the smallest replacement, worked out again from the
  current text, refused when the result would not compile. Never keep a second copy of the model to patch.
- Every `.loadmap` in the repository (and the docs' definitions) is laid out by `format()`: `format.test.ts` fails
  otherwise. `loadmap fmt <file>` fixes it.
- A feature of the TypeScript API that the language should express gets a line in both examples' `.loadmap` or a
  `compile.test.ts` case; the round-trip tests catch a drift.

## Not yet

State in the URL for TypeScript pages (editor links carry it), search in the docs. Two live diagrams side by side,
cost per scenario, goal seek; ranges for fits, Monte Carlo. In the editor: removing boxes and adding edges in the
UI (the catalog picker adds a box), editing formulas in the inspector, edge labels, hover help, Export → TypeScript, the source in exported PNGs, a Vite
plugin for `import m from './m.loadmap'`.
