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

`examples/checkout` (the small reference) and `examples/alerts` (two topics on shared brokers, merge, fan-out) hold the
end-to-end tests; `apps/playground` shows both (`pnpm dev`, `?example=alerts`).

## Verification

Run before every commit that lands:

```bash
pnpm check        # typecheck, biome check, every test (Node + browser), build
```

Pieces: `pnpm typecheck`, `pnpm lint` (`pnpm format` fixes), `pnpm test:node`, `pnpm test:browser`, `pnpm build`.
The browser tests need Chromium once: `pnpm exec playwright install chromium`. They write screenshots to
`examples/checkout/__screenshots__/` (ignored by git).

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

## Recording

A page calls `expose(handle)` (`@loadmap/export`); then `pnpm record <url> --out demo.gif [--script s.json]
[--set load=30]` records it in headless Chromium on a fixed clock: the same options give the same GIF, byte for byte.
The playground exposes the shown example: `pnpm dev`, then `pnpm record 'http://localhost:5173/?example=alerts'
--out alerts.gif`.

## Not yet

ELK in a Web Worker (it is ~1.5 MB of the playground bundle), state in the URL, hover detail on nodes, a docs site,
publishing.
