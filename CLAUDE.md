# loadmap

A TypeScript and React library for interactive capacity models: an architecture diagram whose parts are live (dots
show the flow, controls change the load and the design, a ranked list shows which component runs out first and at
what multiple of today's load). `README.md` has the picture; `docs/prior-art.md` the research behind the choices;
`docs/lessons.md` what a hand-built page taught.

## Stack

pnpm workspaces · TypeScript 7 (strict, `noUncheckedIndexedAccess`) · tsdown (build) · Vitest 5 (Node, and browser
mode on Playwright Chromium) · Biome (lint and format) · Vite 8 + React 19 (peer: `^19`, for `ref` as a prop). Node 24: `nvm use`; every script
stops first with that hint on an older Node (`scripts/node-version.mjs`).

| Package           | What                                                                                      | Depends on                      |
| ----------------- | ----------------------------------------------------------------------------------------- | ------------------------------- |
| `@loadmap/core`   | params, limits as ranges, verdict, scenarios, growth, compare, headroom, check; calibrate | nothing                         |
| `@loadmap/sim`    | fluid queues, priority, drop rules, dots, worker fill, seeded RNG                         | core                            |
| `@loadmap/layout` | view definition, grid packers, ELK layout, collisions, dot paths                          | core, elkjs                     |
| `@loadmap/react`  | `<Loadmap>`, `useLoadmap`, Diagram, panels, scenarios, headroom chart, engine, theme      | core, sim, layout; react (peer) |
| `@loadmap/export` | PNG, GIF, WebM/MP4 on a fixed clock; captions, SVG, poster; `expose()` for the CLI        | react, mediabunny               |
| `@loadmap/cli`    | `loadmap check` (expectations, CI annotations), `loadmap fmt`; `loadmap record`           | dsl (bundled); playwright peer  |
| `@loadmap/dsl`    | the `.loadmap` language: parser, checker, formulas, `compile`, `format`, share links      | core, layout                    |
| `@loadmap/editor` | `<LoadmapEditor>`: CodeMirror 6 beside a live `<Loadmap>`; a reader layout, inspector     | dsl, react, @codemirror/*       |

`examples/checkout` (the small reference) and `examples/alerts` (two topics on shared brokers, merge, fan-out) hold the
end-to-end tests, each also written as a `.loadmap` that must draw exactly what its TypeScript draws
(`definition.test.ts`, `examples/roundtrip.ts`). `apps/docs` is the docs site (`pnpm dev`): both examples, the templates and the editor
live. `docs/dsl.md` is the language guide; the site includes it.

## Verification

Run before every commit that lands:

```bash
pnpm check        # typecheck, biome check, every test (Node + browser), build
```

Pieces: `pnpm typecheck`, `pnpm lint` (`pnpm format` fixes), `pnpm test:node`, `pnpm test:browser`, `pnpm build`.
`pnpm budget` (in `check`) builds `scripts/budget/*.html` and fails when a `<Loadmap>` page loads more than 50 kB gzip of
loadmap first, the editor adds more than 150 kB, or ELK is in a first load. Before a release, and after a change to
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

`pnpm dev` serves on `[::1]` only; from another machine tunnel it: `ssh -N -L '5173:[::1]:5173' jaime@mbpro.internal`
(quoted: zsh globs the brackets).

## Landing

Work lands on `main` only through a pull request: rulesets on GitHub require the `check`, `workflows` (zizmor) and
`dependency-review` jobs to pass on a branch up to date with main, keep the history linear and refuse force pushes and
deletion, with no bypass. Push the branch, `gh pr create`, `gh pr merge --auto --rebase`: it merges once green.

- Workflows: `permissions: {}` at the top and per job only what it needs, every action pinned to a full SHA with its
  version in a comment (Dependabot bumps them), `persist-credentials: false`, `timeout-minutes`. Never
  `pull_request_target`, never `${{ … }}` from an event inside `run:` (pass it through `env:`). `uvx zizmor .github/`
  runs the `workflows` check locally.
- `pnpm-workspace.yaml` refuses a dependency younger than 3 days, one whose trust dropped (lost provenance), one that
  wants an install script (`allowBuilds` after reading what it runs) and git or tarball dependencies deep in the tree.
  A fresh fix you must have now goes in `minimumReleaseAgeExclude` with its exact version.

## Conventions

- **No DOM or React in core, sim or layout.** They run in Node tests; React is only the binding.
- **Every capacity says where it came from**: `measured(...)`, `estimated(...)` or a `fitLinear(...)` result. The
  verdict and the assumptions list show it; never add a bare number as a capacity. A `within` (`± 30%` in the
  language) makes every crossing a range; the ranking, the first limit, presets, `compare()` and expectations use
  its pessimistic edge (every capacity at its low bound), and without a ± every text reads as before.
- **Dates only from `growth.asOf`**, never `Date.now()` or the locale: a page and its recordings say the same date
  on any day, on any machine.
- **Randomness only through `rng(seed)`** (`@loadmap/sim`). `Math.random` anywhere in sim, layout, engine or export
  breaks the identical-frames export test.
- **The sim never contradicts the bars.** A stage drains what its flows carry at the load where its component reaches
  `thresholds.full`; do not give the sim its own capacity numbers.
- **The load never moves the layout.** Labels reserve their widest text across the load range; anything that changes
  the structure key re-runs ELK. `examples/checkout/layout.test.ts` holds both promises and the no-collision one.
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
- Code style is Biome's (single quotes, no semicolons, 120 columns). Comments say why, not what.
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

## Docs

`apps/docs` is the site (Vite + React, static HTML). Pages are Markdown in `apps/docs/pages`, listed in `PAGES`
(`apps/docs/pages.ts`), written into `apps/docs/site/` (the Vite root; the HTML is ignored by git) before Vite runs.
`@include(path, "from", "to")` pulls lines from a repository file (the guide and the reference come from
`docs/dsl.md`, the quick start from `packages/react/README.md`); site links are written from the root (`/language/`)
and made relative, so the build works at any base (`DOCS_BASE=/loadmap/` for GitHub Pages). Live parts are islands
under `apps/docs/site/islands`, loaded only on the pages that use them: a ` ```loadmap live` fence, or
`<div class="island" data-island="example|editor|templates|quickstart">`. `apps/docs/test/site.test.ts` builds the
site, checks every link, and draws the live pages in Chromium. The build also writes `llms.txt` (the pages) and
`llms-full.txt` (`docs/dsl.md` and `docs/every-statement.loadmap`, which must hold every statement of the schema:
`docs.test.ts`); the dsl build copies `docs/dsl.md` into its `dist/REFERENCE.md`.

## Recording

A page calls `expose(handle)` (`@loadmap/export`); then `pnpm record <url> --out demo.gif [--script s.json]
[--set load=30]` records it in headless Chromium on a fixed clock: the same options give the same GIF, byte for byte.
Each example page of the docs exposes its example: `pnpm dev`, then
`pnpm record 'http://localhost:5173/examples/alerts/' --out alerts.gif`. `--caption` adds the title, scenario, load and verdict to every frame, `--scenario <label>`
starts from a scenario, `--poster` (with `.png`) draws the board with the limits and the scenarios compared, and
`.svg` writes the board as a file. `--story` plays the model's `story` steps (each step resolved from the defaults, so
any step looks the same whichever came before). `pnpm record x.loadmap --out x.gif` compiles the definition and draws
it in the viewer built into `packages/cli/dist/viewer` (`pnpm record` builds it). `loadmap check x.loadmap` runs its `expect`
lines: exit 1 on a failure or an error, GitHub annotations under Actions.

## Not yet

State in the URL for TypeScript pages (editor links carry it), search in the docs. Two live diagrams side by side,
cost per scenario, goal seek; ranges for fits, Monte Carlo. In the editor: adding or removing boxes and edges in the
UI, editing formulas in the inspector, edge labels, hover help, Export → TypeScript, the source in exported PNGs, a Vite
plugin for `import m from './m.loadmap'`.
