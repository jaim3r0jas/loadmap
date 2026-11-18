# API

Most pages install only `@loadmap/react`: it re-exports the model and view API below. The other packages add the
language, the editor, media, measured data and the command line. Everything is ESM with TypeScript types; React is a
peer (19).

| Package              | What                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| `@loadmap/react`     | `<Loadmap>` and its pieces, plus everything from core and the view API |
| `@loadmap/core`      | the model: no dependencies, runs in Node                               |
| `@loadmap/layout`    | views and their ELK layout                                             |
| `@loadmap/sim`       | the simulation behind the dots (used by react)                         |
| `@loadmap/dsl`       | the `.loadmap` language                                                |
| `@loadmap/editor`    | `<LoadmapEditor>` and the templates                                    |
| `@loadmap/export`    | PNG, SVG, GIF, WebM, MP4 and `expose()` for the CLI                    |
| `@loadmap/providers` | measured data from Prometheus and Elasticsearch, into a snapshot       |
| `@loadmap/cli`       | `loadmap check`, `fmt`, `pull`, `drift`, `record`, `bundle` and `lsp`  |

The VS Code extension (`jaim3r0jas.loadmap`, in the Marketplace and Open VSX) is not a library: [In your editor](/in-your-editor/)
has what it does.

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
| `published(component, conditions)`                                    | A capacity from the catalog: the figure a published run gives, or none       |
| `cache`, `limit`, `split`, `lost`                                     | More stages: hits that stop, a rate limiter, a router, where the lost end    |
| `compareDefinitions(base, head, { tolerance? })`                      | What a change of the model does to its limits (`loadmap check --base`)       |

`model.evaluate(values)` returns everything the page shows: `verdict.text`, `components` (utilization, crossings and
ranges), `ranked`, `firstLimit`, `target` and `full` (as ranges), `measure` (the capacity worth measuring),
`assumptions`, `presets`.

A `defineModel` definition takes, besides the required parts: `title`, `presets`, `scenarios`, `growth`, `expect`,
`story`, `derived` (named formulas), `calibration` (fits to list), `thresholds` (`{ target: 0.5, full: 1 }`) and
`searchMax`.

`@loadmap/core` has entries of its own for what a page rarely loads:

| Entry                     | What                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `@loadmap/core/calibrate` | `fitLinear`                                                                                             |
| `@loadmap/core/format`    | the number formats                                                                                      |
| `@loadmap/core/measure`   | snapshots of measured data: see [Measured data](#measured-data-loadmap-providers)                       |
| `@loadmap/core/catalog`   | the published figures: see [The catalog](#the-catalog-loadmap-core-catalog)                             |
| `@loadmap/core/drift`     | the tests behind `loadmap drift`: `changePoints`, `compareWindows`, `threshold`, `mannWhitney`, `welch` |

## The view (`@loadmap/layout`, re-exported by react)

| Export                                             | What                                                   |
| -------------------------------------------------- | ------------------------------------------------------ |
| `defineView(model, { nodes, edges, flows })`       | Which boxes to draw, the edges, where each flow starts |
| `node({ label, sub?, stage?, shape? })`            | A box; `shape: 'cylinder'` for a store                 |
| `cluster({ label, members, stage, memberLabel? })` | Brokers holding the partitions of one or more queues   |
| `pool({ label, stage, podLabel? })`                | A workers stage drawn as pods holding workers          |
| `edge(from, to, { label?, when? })`                | An edge; its label may be computed from the values     |

Labels can be functions of the values (`({ pods }) => \`${pods} pods\``). `await layout(view, evaluation, { direction, rows })`
resolves to the scene (`rows` folds a long diagram into that many rows, or columns running down); `collisions(scene)`
lists labels that overlap, for a test.

A view also takes `tiers` (bands across the flow, in the order the flow meets them; each box names its own with
`tier`), `lanes` (`'filled'`, the default, or `'striped'`) and `layout`: `'compact'` (the default) lays out each
scenario, story step or choice on its own and moves the boxes from one to the next, `'stable'` lays out every box at
its largest anywhere the model reaches, so nothing but the load's dots moves. The load never moves a box either way.

`subsystems` draws several boxes as one: `subsystems: { eu: { label: 'EU region' }, 'eu.orders': { label: 'Orders' } }`.
What a subsystem holds is named `<id>.<name>`, as in a definition's text: the box `eu.orders.topic` stands in
`eu.orders`, which stands in `eu`. Each is a frame around its boxes with its name, a subsystem in another a frame in
that one's frame; the scene lists them as `scene.subsystems`. With tiers, a subsystem whose boxes stand in several tiers
has no frame (a frame cannot cross a lane).

A subsystem can be drawn closed, as one box that stands for everything inside: `<Loadmap closed={['us']}>` says which
the page starts with, and a story step its own (`closed: ['us']` in the step, `[]` for every one open). The reader
opens one with a click on it and closes one with a click on its name; `setClosed(ids)` on the controller
(`useLoadmap`) sets them from code.

With `zoom`, a click on a frame flies in to it, and the path to where the view is shows over the board.

## The page (`@loadmap/react`)

| Export                                                                                                                               | What                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `<Loadmap model view />`                                                                                                             | The whole piece: scenarios and load, story, diagram, verdict, headroom, limits  |
| `useLoadmap(model, view, options)`                                                                                                   | The state behind it, to build a layout of your own                              |
| `LoadmapRoot`, `Diagram`, `Verdict` (the panel; the type of `ev.verdict` is `VerdictResult`), `Limits`, `Meters`, `Controls` (`load={false}` leaves the load to the bar), `Assumptions`, `LoadBar` (the scenarios and the load over the diagram), `Scenarios`, `LoadRange`, `Story`, `HeadroomChart`, `Compare` | The pieces, each taking `lm` from `useLoadmap`                                  |
| `injectStyles()`, `LOADMAP_CSS`                                                                                                      | The styles (injected on first render), for a shadow root or server rendering    |
| `usePageTheme(theme)`                                                                                                                | The theme `theme` draws: with `'inherit'`, the page's own switch, followed      |
| `<LoadmapSource source name? functions? />` (`@loadmap/react/source`)                                                                | A `.loadmap` text drawn, or its diagnostics while it does not compile           |
| `workerElk(make)`                                                                                                                    | An ELK engine in the worker `make` starts, for `elk`                            |

`<Loadmap>` props: `model`, `view`, `theme` (`'auto'`, `'light'`, `'dark'`, `'inherit'` for the page's own switch), `title`, `assumptions` (lines added before
the generated ones), `headroom` and `compare` (show the chart and the table; default true), `initial` (values to
start from), `speed` (simulated seconds per second), `direction` (`'auto'`, the default: the way that fits the
room the diagram is given larger, and where both fit about as well the way its shape suggests, `directionOf(view)`:
right unless its widest layer has more boxes than its longest chain; `'RIGHT'` or `'DOWN'` holds it), `rows` (`'auto'`, the default: a long diagram is folded into two or three rows,
columns running down, where its titles would be hard to read in one and the fold draws it clearly larger; a number
holds it, 1 never folds; below `narrowBelow` nothing folds), `narrowBelow`
(the width under which the diagram runs down, default 640), `elk` (where ELK runs; default a shared Web Worker;
`workerElk(() => new Worker(…))` for one the page starts, see [Without a bundler](/without-a-bundler/)),
`onNodeClick` (a click or Enter on a box, by its id; every box is a button then), `selected` (the box drawn as
selected), `zoom` (the reader pans and zooms the diagram: drag, pinch, the keys + − 0 and the arrows, the wheel with
Ctrl or ⌘ held), `transition` (seconds the diagram takes to move to a new structure, default 0.8; 0 cuts, and the
load never moves it), `fullScreenMode` (what full screen opens with: the panels around the diagram, or mainly the
diagram and the story), `fill` (the root fills its container, laid out as full screen is, for a page made to be
framed: see [Embedding](/embedding/)), `fullScreen` (the panels full screen shows below the diagram, `LOADMAP_PANELS`
by name; default every one the page shows), `closed` (the subsystems the page starts with closed), and `ref`.

The `ref` is a `LoadmapHandle`: `values()`, `setValues(v)`, `setStoryStep(i)`, `storyStep()`, `ready()`, `pause()`,
`resume()`, `step(dt)`, `reset(seed)`, `board()`, `playStory()` (plays the story as Play does, and returns its length
in seconds), and `show(ids)`, which brings boxes into view on a board that zooms.
Export and recording drive the page through it.

`<LoadmapSource>` takes every `<Loadmap>` prop but `model` and `view`, and for a definition in several files its own
`path` and the other `files` by their path: it fetches nothing itself.

`@loadmap/react/catalog` is `@loadmap/core/catalog` for a page that installs only react; `useCatalog(source)` (from
`@loadmap/react/source`) loads the catalog when a text needs it, and is true while the text still waits for it.

## The language (`@loadmap/dsl`)

| Export                                             | What                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| `compile(source, options?)`                        | `{ ok, diagnostics, definition: { model, view, options }, expectations }` |
| `formatDiagnostic(d, source, file)`                | `file:line:col error: …` with the line and a caret                        |
| `problems(result, severity?)`                      | The diagnostics with failing expectations added                           |
| `format(source)`                                   | `{ ok, text, diagnostics }`: the definition laid out the one way          |
| `hover(source, offset, definition?)`               | What a word is, and its values at the defaults                            |
| `signatureHelp(source, offset)`                    | The arguments of the call the cursor is in                                |
| `quickFixes(source, diagnostics)`                  | The fixes of each diagnostic, as text changes                             |
| `definition`, `references(source, offset)`         | Where a name is declared; every place it is written                       |
| `rename(source, offset, name)`                     | The name renamed everywhere, or why not                                   |
| `encodeShare(source, values)`, `decodeShare(hash)` | Share links that carry the whole definition (both async: they deflate)    |

`compile` takes `functions` (what formulas may call beyond the built-in ones), `snapshot` (measured data for the
`measure` statements: `fromSnapshot(parseSnapshot(json))`), `catalog` (by default the one `loadCatalog()` loaded), and
for a model in several files its own `path` and the other `files`, by their path from the project root: the compiler
reads no disk and no network. The result also has `measures`: each `measure` as a query, for `pull`.

A text with a `published` statement needs the catalog, which no first load carries: `await loadCatalogFor(source)`
before `compile(source)` loads it only then (`needsCatalog(source)` says whether; `loadCatalog()` loads it anyway).
`LANGUAGE_VERSION` is the language version this build reads.

`completions(source, offset)` (what may be typed at a place, ranked) and `completionsAcross(source, offset, { path,
files })` (the same over a model's files) come from `@loadmap/dsl/completion`: an entry of its own, so an editor loads
it with the first list it asks for rather than in its first load.

## The editor (`@loadmap/editor`)

`<LoadmapEditor initial values? functions? theme? onChange? onShare? actions? templates? fileName? layout? fill? ref? />`.
`layout` is `'code'` (the default: the text beside the diagram) or `'reader'` (the diagram with an inspector, the text
hidden); `fill` makes it a page of its own, the diagram a canvas between two panels that resize and fold: the text on its left
(`split`, `onSplit`, `onLayout`) and the verdict and the rest on its right (`panel`: `'pinned'` or `'auto'`,
`onPanel`, `panelWidth`, `onPanelWidth`); `track` (and `onTrack`) turns on Track live changes, the code panel's button:
each edit brings the boxes it changed into view and marks them; off, the view stays where the reader left it; `theme` takes `'inherit'` as `<Loadmap>` does. Its `ref` has `source()`, `setSource(text)`, `loadmap()` (the preview's handle), `shareHash()` and
`format()`, and for a definition in several files `files()` and `setFiles(files)`. `TEMPLATES` (also from
`@loadmap/editor/templates`, without CodeMirror) lists the starters.

More props: `files` and `onFiles` (a definition in several files, `{ path, files }`: each file is a tab over the
text), `embedLink` (with it, Share has "Embed in a page…"), `newItems` and `exportItems` (more sections in the New and
Export menus), `start` (controls before the name: a way back, a brand), `onSave` (⌘S or Ctrl+S in the editor: every
file, for the page to save; without it the keys say what keeps the text, and the browser's Save Page never opens),
`fonts` (the fonts View offers for the code, `{ name, url }` of a woff2 each, fetched when picked; default
`CODE_FONTS`, Fira Code, JetBrains Mono and Cascadia Code from jsDelivr; `[]` for the system's alone) and `catalog`
(**Add → From the catalog** in the New menu: a component's published figure as a new box, or as the capacity of the
box selected; `false` leaves it out).

For a CodeMirror editor of your own, `loadmapLanguage(options)` is the whole language as one extension (highlighting,
errors, completion, hover, rename), and `loadmapStream` with `loadmapHighlight` the highlighting alone.

## Media (`@loadmap/export`)

| Export                                                                               | What                                                                       |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `exportPng(handle, { scale?, caption? })`                                            | The board as it is now                                                     |
| `exportSvg(handle, { caption? })`                                                    | The board as an SVG file, dots included                                    |
| `recordVideo(handle, { seconds or story, format?, script?, caption?, fps?, seed? })` | GIF, WebM or MP4 on a fixed clock                                          |
| `recordStill`, `recordPoster`                                                        | A PNG after a warm-up; a poster with the limits and the scenarios compared |
| `expose(handle, name?)`                                                              | Lets `loadmap record` drive the page                                       |
| `composeFrame(handle, options?)`                                                     | The board as one image on a canvas: the SVG with the dots painted on top   |
| `download(blob, name)`                                                               | Saves a blob through the browser                                           |

## Measured data (`@loadmap/providers`)

A model reads measured data from a **snapshot**: a JSON file with each measurement's value over a window, its points
and where they came from. Nothing in a definition or a shared link fetches anything: a pull is an explicit action, and
the address and the credentials come from the environment, never from the text. `loadmap pull` is the usual way in;
[the language guide](/language/measured-data/) has the statements, and [Live data](/live-data/) a shop to try it on.

| Export                                                   | What                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| `pull(measures, { from, to, step, fetched, providers })` | Reads every measurement and returns the snapshot                        |
| `prometheus({ url, token? })`                            | A provider: a PromQL query over a range; the query must give one series |
| `elasticsearch({ url, apiKey? })`                        | A provider: an index as a date histogram at the step (OpenSearch too)   |
| `providersFromEnv(env)`                                  | The providers `LOADMAP_PROMETHEUS_URL` and the rest configure           |
| `parseSnapshot(json)` (`@loadmap/core/measure`)          | The file checked: a snapshot, or an error that says what is wrong       |
| `fromSnapshot(snapshot)` (`@loadmap/core/measure`)       | A reader: `capacity(name, fallback)`, `value`, `fit`, `unread(name)`    |
| `MEASURES` (`@loadmap/core/measure`)                     | The standard measurements per kind of component                         |

```ts
import { fromSnapshot } from '@loadmap/core/measure'
import { compile } from '@loadmap/dsl'
import { providersFromEnv, pull } from '@loadmap/providers'

const { measures } = compile(source)
const snapshot = await pull(measures, {
  from: '2026-11-01T00:00:00Z',
  to: '2026-11-08T00:00:00Z',
  step: 300,
  fetched: new Date().toISOString(),
  providers: providersFromEnv(process.env),
})
const { definition } = compile(source, { snapshot: fromSnapshot(snapshot) })
```

A provider is one adapter, `{ id, read({ query, from, to, step }) }`, that answers with the points or with why not:
an error is data, so one failing query leaves that measurement missing and the model on the definition's own value,
marked with why. Both providers take `user` and `password` in place of a token, and a `fetch` of your own (a proxy, a
test); no error repeats the address or a credential. In a TypeScript model, `fromSnapshot(snapshot)` reads inside the
model's functions: `capacity: read.capacity('gatewayCapacity', estimated(20_000, 'req/s', 'vendor benchmark'))`.

## The catalog (`@loadmap/core/catalog`)

Published benchmark figures, one entry per component (`kafka`, `postgresql`, `valkey`, `nginx` and the rest), each run
with the conditions it was measured under and a link to its source. `published(kafka, { brokers: 3, replication: 3,
acks: 'all', messageSize: '1 KB', producers: 4 })` takes the figure of the run that matches; a configuration no run
matches gets no number, is not ranked, and the verdict says so. A figure is never scaled or interpolated. `EDITIONS`
holds every released edition (a released one never changes), `CATALOG` the latest.

## The simulation (`@loadmap/sim`)

The fluid queue simulation behind the dots: `createSim(model, evaluation, options?)` and `rng(seed)`, its only source
of randomness, so
a recording is the same every time. It has no capacity numbers of its own: a stage drains what its flows carry at the
load where its component is full. `<Loadmap>` runs it; a page rarely needs it directly.

## The command line (`@loadmap/cli`)

| Command                 | What                                                                           |
| ----------------------- | ------------------------------------------------------------------------------ |
| `loadmap check <file>…` | Tests each definition's `expect` lines; `--pull`, `--snapshot`, `--base <ref>` |
| `loadmap fmt <file>…`   | Lays each definition out the one way; `--check` for CI                         |
| `loadmap pull <file>`   | Reads the measures from their providers and writes `x.snapshot.json`           |
| `loadmap drift <file>`  | Finds what moved in the measured data that no change of the definition shows   |
| `loadmap record <src>`  | GIF, WebM, MP4, PNG or SVG of a page or a `.loadmap`, on a fixed clock         |
| `loadmap bundle <file>` | A model in several files written as one                                        |
| `loadmap lsp`           | The language server, for any editor that speaks the protocol                   |

[The command line](/recording/) has each command's options; `loadmap --help` prints them.
