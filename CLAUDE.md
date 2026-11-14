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
`examples/search` (a rate limiter, an autoscaled pool, a cache and retries, laid out stable) hold the end-to-end tests,
each also written as a `.loadmap` that must draw exactly what its TypeScript draws (`definition.test.ts`,
`examples/roundtrip.ts`). `apps/docs` is the docs site (`pnpm dev`): the examples (walkthroughs and the templates as starters) and the editor
live (its rules: `apps/docs/CLAUDE.md`). `docs/dsl.md` is the language guide: the site includes it, the build writes it
with `docs/every-statement.loadmap` into `llms-full.txt`, and the dsl build copies it into its `dist/REFERENCE.md`.
`docs/every-statement.loadmap` must hold every statement of the schema (`docs.test.ts`). Recording a page or a
`.loadmap` (`pnpm record`, `expose()`): the `record` skill.

## Verification

Run before every commit that lands:

```bash
pnpm check        # typecheck, biome check, every test (Node + browser), build
```

After a change to `packages/vscode` (or what it bundles: the cli's `lsp`, `<LoadmapSource>`): `pnpm --filter
@loadmap/vscode test:e2e` runs the extension as it ships in a pinned VS Code (downloaded once into `.vscode-test`; CI
runs it under xvfb in `check`), and `pnpm --filter @loadmap/vscode package` makes the .vsix.
`pnpm budget` (in `check`) builds `scripts/budget/*.html` and fails when a `<Loadmap>` page loads more than 61 kB gzip of
loadmap first, the editor adds more than 182 kB, or ELK is in a first load. Before a release, and after a change to
exports, dependencies or the build: `pnpm verify:pack` (packs every package, installs the tarballs with npm in a fresh
Vite app outside the monorepo, runs tsc, builds, measures the budget, draws checkout and the react README's quick
start in Chromium, built and in dev). The browser tests need Chromium once: `pnpm exec playwright install chromium`. They write screenshots to
`__screenshots__/` next to each test (ignored by git). Commit only with `pnpm check && git commit`.

- Load nvm in every new shell before pnpm: `. ~/.nvm/nvm.sh && nvm use`. The default node on `PATH` can be a broken
  Homebrew build.
- "Cannot find native binding" from Vitest or tsdown: `pnpm install --force`. The lockfile has every platform, but a
  checkout installed on another Mac lacks this machine's binding.
- On a loaded machine (load 15+) `pnpm check` can time out the docs-site and recording tests (Chromium contention):
  run the failing test alone before suspecting a hang.
- Never run `pnpm check && git commit -a` in the background while still editing: it sweeps in files mid-edit. Commit
  by path once the check is green.
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
deletion, with no bypass. Push the branch, `gh pr create`, `gh pr merge --auto --rebase`: it merges once green.

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
  `UPDATE_DOCS=1 pnpm test:node` rewrites that reference.
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
