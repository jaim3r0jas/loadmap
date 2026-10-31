# loadmap

A TypeScript and React library for interactive capacity models: an architecture diagram whose parts are live (dots
show the flow, controls change the load and the design, a ranked list shows which component runs out first and at
what multiple of today's load). `README.md` has the picture; `docs/prior-art.md` the research behind the choices;
`docs/lessons.md` what a hand-built page taught.

## Stack

pnpm workspaces · TypeScript 7 (strict, `noUncheckedIndexedAccess`) · tsdown (build) · Vitest 5 (Node, and browser
mode on Playwright Chromium) · Biome (lint and format) · Vite 8 + React 19 (peer: `^19`, for `ref` as a prop). Node 24: `nvm use`; every script
stops first with that hint on an older Node (`scripts/node-version.mjs`).

| Package           | What                                                                                        | Depends on                      |
| ----------------- | ------------------------------------------------------------------------------------------- | ------------------------------- |
| `@loadmap/core`   | params, lazy model context, components, limits, verdict, presets, stages; `core/calibrate`  | nothing                         |
| `@loadmap/sim`    | fluid queues, priority, drop rules, dots, worker fill, seeded RNG                           | core                            |
| `@loadmap/layout` | view definition, grid packers, ELK layout, collisions, dot paths                            | core, elkjs                     |
| `@loadmap/react`  | `<Loadmap>`, `useLoadmap`, Diagram, panels, engine, theme                                   | core, sim, layout; react (peer) |
| `@loadmap/export` | PNG, GIF and WebM/MP4 on a fixed clock; `expose()` for the CLI                              | react, mediabunny               |
| `@loadmap/cli`    | `loadmap record`: Playwright records a page that calls `expose()`, as GIF, WebM, MP4 or PNG | playwright                      |
| `@loadmap/dsl`    | the `.loadmap` language: parser, checker, formulas, `compile`, completions, share links     | core, layout                    |
| `@loadmap/editor` | `<LoadmapEditor>`: CodeMirror 6 next to a live `<Loadmap>`, inline errors, share, download  | dsl, react, @codemirror/*       |

`examples/checkout` (the small reference) and `examples/alerts` (two topics on shared brokers, merge, fan-out) hold the
end-to-end tests, each also written as a `.loadmap` that must draw exactly what its TypeScript draws
(`definition.test.ts`, `examples/roundtrip.ts`). `apps/playground` shows both and the editor (`pnpm dev`,
`?example=alerts`, `?example=editor`). `docs/dsl.md` is the language guide.

## Verification

Run before every commit that lands:

```bash
pnpm check        # typecheck, biome check, every test (Node + browser), build
```

Pieces: `pnpm typecheck`, `pnpm lint` (`pnpm format` fixes), `pnpm test:node`, `pnpm test:browser`, `pnpm build`.
The browser tests need Chromium once: `pnpm exec playwright install chromium`. They write screenshots to
`__screenshots__/` next to each test (ignored by git). Commit only with `pnpm check && git commit`.

`pnpm dev` serves on `[::1]` only; from another machine tunnel it: `ssh -N -L '5173:[::1]:5173' jaime@mbpro.internal`
(quoted: zsh globs the brackets).

## Conventions

- **No DOM or React in core, sim or layout.** They run in Node tests; React is only the binding.
- **Every capacity says where it came from**: `measured(...)`, `estimated(...)` or a `fitLinear(...)` result. The
  verdict and the assumptions list show it; never add a bare number as a capacity.
- **Randomness only through `rng(seed)`** (`@loadmap/sim`). `Math.random` anywhere in sim, layout, engine or export
  breaks the identical-frames export test.
- **The sim never contradicts the bars.** A stage drains what its flows carry at the load where its component reaches
  `thresholds.full`; do not give the sim its own capacity numbers.
- **The load never moves the layout.** Labels reserve their widest text across the load range; anything that changes
  the structure key re-runs ELK. `examples/checkout/layout.test.ts` holds both promises and the no-collision one.
- Model functions take one context object (`({ load, flows, util, demand, derived, ...params })`); `load`, `flows`,
  `demand`, `util` and `derived` are reserved parameter names.
- Imports without extensions; package `exports` point at `src` for the workspace, `publishConfig.exports` at `dist`.
- Code style is Biome's (single quotes, no semicolons, 120 columns). Comments say why, not what.
- Text in the UI and the verdict: short plain sentences, numbers with units, `×` for load multiples, `%` with a space.
- The example and docs are generic: no figures, component names or links from anyone's employer.
- **Formulas in `.loadmap` never reach `eval` or `new Function`.** They are parsed and run as closures over the syntax
  tree; names resolve only to what the definition declares (`own()` for every lookup by a user-written name, so
  `constructor` finds nothing). A shared link is untrusted input.
- **The schema table (`packages/dsl/src/schema.ts`) is the one place a statement or property is added.** The checker,
  autocomplete and the reference in `docs/dsl.md` read it; `UPDATE_DOCS=1 pnpm test:node` rewrites that reference.
- A feature of the TypeScript API that the language should express gets a line in both examples' `.loadmap` or a
  `compile.test.ts` case; the round-trip tests catch a drift.

## Recording

A page calls `expose(handle)` (`@loadmap/export`); then `pnpm record <url> --out demo.gif [--script s.json]
[--set load=30]` records it in headless Chromium on a fixed clock: the same options give the same GIF, byte for byte.
The playground exposes the shown example: `pnpm dev`, then `pnpm record 'http://localhost:5173/?example=alerts'
--out alerts.gif`.

## Not yet

ELK in a Web Worker (it is ~1.5 MB of the playground bundle, and live editing relayouts on the main thread), state in
the URL for TypeScript pages (editor links carry it), hover detail on nodes, a docs site, publishing. In the editor:
editing in the UI (an inspector that writes text edits, a click on a node that jumps to its source), hover help, a
formatter, Export → TypeScript, the source in exported PNGs, `loadmap record x.loadmap`, a Vite plugin for
`import m from './m.loadmap'`.
