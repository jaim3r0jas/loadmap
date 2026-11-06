# API

Most pages install only `@loadmap/react`: it re-exports the model and view API below. The other packages add the
language, the editor, media and the command line. Everything is ESM with TypeScript types; React is a peer (19).

| Package           | What                                                                   |
| ----------------- | ---------------------------------------------------------------------- |
| `@loadmap/react`  | `<Loadmap>` and its pieces, plus everything from core and the view API |
| `@loadmap/core`   | the model: no dependencies, runs in Node                               |
| `@loadmap/layout` | views and their ELK layout                                             |
| `@loadmap/sim`    | the simulation behind the dots (used by react)                         |
| `@loadmap/dsl`    | the `.loadmap` language                                                |
| `@loadmap/editor` | `<LoadmapEditor>` and the templates                                    |
| `@loadmap/export` | PNG, SVG, GIF, WebM, MP4 and `expose()` for the CLI                    |
| `@loadmap/cli`    | `loadmap check` and `loadmap record`                                   |

## The model (`@loadmap/core`)

| Export                                                                | What                                                                         |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `defineModel({ load, params, flows, components, stages, routes, … })` | A model: `evaluate(values)`, `defaults()`, `scenarios`, `story`, `dateAt(x)` |
| `p.load`, `p.select`, `p.switch`, `p.range`                           | The load and the parameters a reader can change                              |
| `measured(value, unit, source)`                                       | A capacity you measured                                                      |
| `estimated(value, unit, { source, within })`                          | A capacity you believe, within a share (`within: 0.3` is ± 30 %)             |
| `pass`, `queue`, `workers`, `store`, `sink`, `fanout`                 | Stages: what the dots do on a route                                          |
| `compare(model, load?)`                                               | The scenarios side by side: which buys more headroom, per component          |
| `headroom(model, values?)`                                            | Utilization over the load multiple, per scenario, with its crossings         |
| `check(model)`, `assertHolds(model)`                                  | Test the model's `expect` lines on the pessimistic edge                      |
| `fitLinear(points, { x, y, source })` (`/calibrate`)                  | `cost = a + b × x` from measurements, with r²                                |
| `fmt`, `compact`, `pct`, `secs`, `multiple` (`/format`)               | The number formats the verdict uses, for labels of your own                  |

`model.evaluate(values)` returns everything the page shows: `verdict.text`, `components` (utilization, crossings and
ranges), `ranked`, `firstLimit`, `target` and `full` (as ranges), `measure` (the capacity worth measuring),
`assumptions`, `presets`.

A `defineModel` definition takes, besides the required parts: `title`, `presets`, `scenarios`, `growth`, `expect`,
`story`, `derived` (named formulas), `calibration` (fits to list), `thresholds` (`{ target: 0.5, full: 1 }`) and
`searchMax`.

## The view (`@loadmap/layout`, re-exported by react)

| Export                                             | What                                                   |
| -------------------------------------------------- | ------------------------------------------------------ |
| `defineView(model, { nodes, edges, flows })`       | Which boxes to draw, the edges, where each flow starts |
| `node({ label, sub?, stage?, shape? })`            | A box; `shape: 'cylinder'` for a store                 |
| `cluster({ label, members, stage, memberLabel? })` | Brokers holding the partitions of one or more queues   |
| `pool({ label, stage, podLabel? })`                | A workers stage drawn as pods holding workers          |
| `edge(from, to, { label?, when? })`                | An edge; its label may be computed from the values     |

Labels can be functions of the values (`({ pods }) => \`${pods} pods\``). `layout(view, evaluation, { direction })`returns the scene;`collisions(scene)` lists labels that overlap, for a test.

## The page (`@loadmap/react`)

| Export                                                                                                                               | What                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `<Loadmap model view />`                                                                                                             | The whole piece: scenarios, story, diagram, verdict, headroom, limits, controls |
| `useLoadmap(model, view, options)`                                                                                                   | The state behind it, to build a layout of your own                              |
| `LoadmapRoot`, `Diagram`, `Verdict` (the panel; the type of `ev.verdict` is `VerdictResult`), `Limits`, `Meters`, `Controls`, `Assumptions`, `Scenarios`, `Story`, `HeadroomChart`, `Compare` | The pieces, each taking `lm` from `useLoadmap`                                  |
| `injectStyles()`, `LOADMAP_CSS`                                                                                                      | The styles (injected on first render), for a shadow root or server rendering    |
| `usePageTheme(theme)`                                                                                                                | The theme `theme` draws: with `'inherit'`, the page's own switch, followed      |
| `workerElk(make)`                                                                                                                    | An ELK engine in the worker `make` starts, for `elk`                            |

`<Loadmap>` props: `model`, `view`, `theme` (`'auto'`, `'light'`, `'dark'`, `'inherit'` for the page's own switch), `title`, `assumptions` (lines added before
the generated ones), `headroom` and `compare` (show the chart and the table; default true), `initial` (values to
start from), `speed` (simulated seconds per second), `direction` (`'RIGHT'` or `'DOWN'`), `narrowBelow` (the width
under which the diagram runs down, default 640), `elk` (where ELK runs; default a shared Web Worker;
`workerElk(() => new Worker(…))` for one the page starts, see [Without a bundler](/without-a-bundler/)),
`onNodeClick` (a click or Enter on a box, by its id; every box is a button then), `selected` (the box drawn as
selected), and `ref`.

The `ref` is a `LoadmapHandle`: `values()`, `setValues(v)`, `setStoryStep(i)`, `storyStep()`, `ready()`, `pause()`,
`resume()`, `step(dt)`, `reset(seed)`, `board()`. Export and recording drive the page through it.

## The language (`@loadmap/dsl`)

| Export                                             | What                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| `compile(source, { functions? })`                  | `{ ok, diagnostics, definition: { model, view, options }, expectations }` |
| `formatDiagnostic(d, source, file)`                | `file:line:col error: …` with the line and a caret                        |
| `problems(result, severity?)`                      | The diagnostics with failing expectations added                           |
| `format(source)`                                   | `{ ok, text, diagnostics }`: the definition laid out the one way          |
| `completions(source, offset)`                      | What may be typed at a place                                              |
| `encodeShare(source, values)`, `decodeShare(hash)` | Share links that carry the whole definition                               |

## The editor (`@loadmap/editor`)

`<LoadmapEditor initial values? functions? theme? onChange? onShare? actions? templates? fileName? layout? ref? />`.
`layout` is `'code'` (the default: the text beside the diagram) or `'reader'` (the diagram with an inspector, the text
hidden); `theme` takes `'inherit'` as `<Loadmap>` does. Its `ref` has `source()`, `setSource(text)`, `loadmap()` (the preview's handle), `shareHash()` and
`format()`. `TEMPLATES` (also from
`@loadmap/editor/templates`, without CodeMirror) lists the starters.

## Media (`@loadmap/export`)

| Export                                                                             | What                                                                       |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `exportPng(handle, { scale?, caption? })`                                          | The board as it is now                                                     |
| `exportSvg(handle, { caption? })`                                                  | The board as an SVG file, dots included                                    |
| `recordVideo(handle, { format, seconds, script?, story?, caption?, fps?, seed? })` | GIF, WebM or MP4 on a fixed clock                                          |
| `recordStill`, `recordPoster`                                                      | A PNG after a warm-up; a poster with the limits and the scenarios compared |
| `expose(handle, name?)`                                                            | Lets `loadmap record` drive the page                                       |
| `download(blob, name)`                                                             | Saves a blob through the browser                                           |
