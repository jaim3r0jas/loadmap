# Media, simulation and layout

What a page rarely loads but a tool, a test or a recording needs: pictures and videos of a board (`@loadmap/export`),
the simulation behind the dots (`@loadmap/sim`), the layout on its own (`@loadmap/layout`), the entries of
`@loadmap/core` that stay out of every first load (number formats, fits, snapshots, drift tests, the catalog), the
providers that read measured data (`@loadmap/providers`) and the command line (`@loadmap/cli`). Each is ESM with
TypeScript types; none of it is in a `<Loadmap>` page's first load.

## Media (`@loadmap/export`)

Every function takes the `ref` of a `<Loadmap>`, a `LoadmapHandle` ([React and the page](/api/react/)), and runs in
the browser. Recordings are made frame by frame on a fixed clock: the live animation is paused, the simulation is
seeded and advances exactly 1/fps per frame, so the same options give the same file, byte for byte, however fast
the machine is. The values a recording changed are put back afterwards.

| Export                                  | What                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `exportPng(handle, options?)`           | `Promise<Blob>`: a PNG of the board as it is now                             |
| `exportSvg(handle, { caption? }?)`      | `Promise<string>`: the board as SVG text, dots included                      |
| `recordVideo(handle, options)`          | `Promise<Blob>`: WebM, MP4 or GIF on a fixed clock                           |
| `recordStill(handle, options?)`         | `Promise<Blob>`: a PNG after a warm-up on a fixed clock                      |
| `recordPoster(handle, options?)`        | `Promise<Blob>`: one PNG with the verdict, the limits and the scenarios      |
| `composeFrame(handle, options?, into?)` | `Promise<HTMLCanvasElement>`: the board on a canvas, the dots painted on top |
| `expose(handle, name?)`                 | Lets `loadmap record` drive the page; returns a function that takes it off   |
| `download(blob, name)`                  | Saves a blob through the browser's download                                  |

```tsx
import { download, recordVideo } from '@loadmap/export'
import { Loadmap, type LoadmapHandle } from '@loadmap/react'
import { useRef } from 'react'
import { model, view } from './shop'

function Page() {
  const ref = useRef<LoadmapHandle>(null)
  const record = async () => {
    const gif = await recordVideo(ref.current!, {
      format: 'gif',
      seconds: 6,
      caption: true,
      // the load rises 2 s in: the GIF shows what runs out first
      script: [{ at: 2, set: { load: 30 } }],
    })
    download(gif, 'shop.gif')
  }
  return (
    <>
      <Loadmap ref={ref} model={model} view={view} />
      <button type="button" onClick={record}>
        Record
      </button>
    </>
  )
}
```

`exportSvg` gives text, not a blob: `new Blob([svg], { type: 'image/svg+xml' })` saves it. Its labels go in as text
nodes, never as markup, so a label cannot break the file.

## Recording options

A PNG, a still and a video take the frame options (`exportSvg` takes only `caption`):

| Option    | What                                                                                      |
| --------- | ----------------------------------------------------------------------------------------- |
| `scale`   | Pixels per scene unit. Default 2 for a still, 1 for a video                               |
| `size`    | `{ width, height }`: a fixed frame size, the board scaled to fit and centred              |
| `caption` | `true` or a `Caption`: the title, scenario and load above the board, the verdict below it |

A `Caption` is `{ title?, text?, step? }`: `title` replaces the model's title, `text` is said below the board instead
of the verdict, and `step` goes before the scenario and the load (`'2 of 3'`).

`recordVideo(handle, options)` adds:

| Option    | What                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| `seconds` | The length. Required without `story`                                                                         |
| `story`   | `true` plays the model's story from its defaults, as Play does; it takes the place of `script` and `seconds` |
| `format`  | `'webm'` (the default), `'mp4'` or `'gif'`                                                                   |
| `fps`     | Default 30, or 15 for a GIF; a GIF takes at most 50 (its frame delays are whole hundredths)                  |
| `script`  | `ScriptStep[]`: value changes during the recording                                                           |
| `seed`    | The simulation starts over with this seed, so two recordings match frame for frame. Default 1                |
| `warmup`  | Seconds of simulation before the first frame, so queues and dots already flow. Default 2                     |
| `onFrame` | `(index, canvas) => void \| Promise<void>`: called with every frame, e.g. to hash it                         |

A `ScriptStep` is `{ at, scenario?, set?, step? }`: `at` is seconds into the recording; `scenario` takes a scenario's
values by its label and `set` goes on top of them (the load stays unless `set` names it); `step` shows a story step by
index (its values and the box it points at) instead. An unknown scenario is an error that names the known ones.

A played story starts from the model's defaults whatever the page shows: the whole diagram, then for each step a
close-up on what it changes, the change, and the whole diagram for its seconds, its title on the board and, with a
caption, its text below. MP4 and WebM use the first codec the browser can encode (`avc`, `vp9` or `av1` for MP4;
`vp9`, `vp8` or `av1` for WebM), and a browser that has none says so. A GIF is encoded in JavaScript with a palette
per frame, so its bytes are the same on every machine.

`recordStill(handle, options?)` and `recordPoster(handle, options?)` take the frame options and:

| Option     | What                                                |
| ---------- | --------------------------------------------------- |
| `scenario` | A scenario's values, by its label                   |
| `set`      | Values on top of the scenario                       |
| `seed`     | The simulation's seed. Default 1                    |
| `warmup`   | Seconds of simulation before the picture. Default 4 |

A poster takes neither `size` nor `caption` (it has its own layout), and its `scale` is pixels per CSS pixel,
default 2. A recording or a still stops a story the reader is playing first, cut to the whole diagram.

## Recording from the command line (`expose`)

`loadmap record http://localhost:5173/` opens a page in headless Chromium and records the loadmap the page exposed:

```tsx
import { expose } from '@loadmap/export'

useEffect(() => expose(ref.current!), [])
```

`expose(handle, name = 'default')` puts a `PageRecorder` on `globalThis.__loadmap[name]` and returns the function that
takes it off, a ready cleanup for an effect. A page with several loadmaps exposes each by its own name, and
`--name` picks one. A `PageRecorder` has `record(options)`, `still(options)` and `poster(options)`, which resolve to
the file base64-encoded, and `svg(options)`, which resolves to the SVG's text. The options are the ones above.
[The command line](/recording/#record) has `loadmap record` and its options.

## The simulation (`@loadmap/sim`)

The fluid queue simulation behind the dots. It has no capacity numbers of its own: each queue is drained by the next
stage on each flow's route at what its flows carry at the load where its component is full, so a queue grows exactly
when the load passes the multiple the bars show. Flows share that capacity by priority, and the backlog is kept as
arrival cohorts, so the lag is the real age of the oldest unit. `<Loadmap>` runs it; a page rarely needs it directly.

```ts
import { createSim } from '@loadmap/sim'

const sim = createSim(model, model.evaluate({ load: 20 }), { seed: 7 })
// 30 s of real time at the default speed: 300 simulated seconds, no dots
for (let i = 0; i < 900; i++) sim.step(1 / 30, { particles: false })
sim.queue('orders', 'checkout').lag // seconds the oldest waiting order has waited
```

`createSim(model, evaluation, options?)` returns a `Sim`. Its options, `SimOptions`:

| Option         | What                                                                          | Default |
| -------------- | ----------------------------------------------------------------------------- | ------- |
| `seed`         | The seed of its randomness                                                    | 1       |
| `speed`        | Simulated seconds per real second                                             | 10      |
| `dotTarget`    | About how many dots a second all flows together spawn: it sets the dot scale  | 28      |
| `minDots`      | Dots a second every flow with any rate spawns at least, so a small flow shows | 1       |
| `maxDots`      | Dots a second a flow spawns at most                                           | 40      |
| `legSeconds`   | Real seconds a dot takes from one stage to the next                           | 0.45    |
| `maxParticles` | Dots alive at once, at most                                                   | 800     |

Its members (`step`, `update`, `queue`, `busy` and the dots) are what the board draws from; they may change
between versions, so a page reads the board through `<Loadmap>` and its handle.

`rng(seed)` is its only source of randomness, a small seeded generator (mulberry32) that returns a function giving
numbers from 0 to below 1: the same seed plays the same way every time, which recordings depend on.

## The layout (`@loadmap/layout`)

The view API (`defineView`, `node`, `cluster`, `pool`, `edge`) is on [The model in TypeScript](/api/model/#the-view),
re-exported by `@loadmap/react`. The layout itself is for tests and tools: `<Loadmap>` runs it for you.

```ts
import { collisions, layout } from '@loadmap/layout'

const scene = await layout(view, model.evaluate({ load: 1 }), { direction: 'RIGHT' })
expect(collisions(scene)).toEqual([]) // the layout's promise: nothing overlaps
```

`layout(view, evaluation, options?)` resolves to the `Scene`: `width` and `height`, `nodes` (each box with its `x`,
`y`, `w`, `h`, its stages, members, partition cells and worker slots), `edges` (their points and the box reserved for
their label), `tiers`, `subsystems`, `stageNode`, `flowFrom`, `direction` and a `key` that changes only when the
structure does. Results are cached by the structure, so a call after a change of load returns the same scene.

| Option      | What                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `direction` | `'RIGHT'` or `'DOWN'`. Default: from the view's shape, `directionOf(view)`                           |
| `rows`      | Folds a long diagram into this many rows (columns side by side, running down). Default 1: one row    |
| `elk`       | Where ELK runs: an `ElkEngine`, `{ layout(graph) }`. Default: this thread, ELK imported on first use |
| `measure`   | `(text, size, weight?) => width` in px. Default `estimateText`, a generous sans-serif estimate       |

`<Loadmap>`'s `rows` and `direction` take `'auto'` and work out the number for the room; `layout` takes the number.
In a browser `<Loadmap>` runs ELK in a Web Worker (`workerElk`, [React and the page](/api/react/)); in Node the
default runs it on the same thread.

`collisions(scene, slack?)` lists every label, box or frame that overlaps another, `{ a, b }[]`: empty is the
layout's promise, for a test. `directionOf(view)` is `'RIGHT'` unless the view's widest layer has more boxes than
its longest chain. The other exports draw the board and may change between versions.

## Number formats (`@loadmap/core/format`)

The formats the verdict uses, for labels of your own. `fmt`, `compact`, `multiple`, `pct` and `secs` are also
exported by `@loadmap/react`.

| Export                                         | What                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `fmt(n)`                                       | `1,234`, `12.3`, `0.4`; `∞` and `—` for what is not finite                  |
| `compact(n)`                                   | `980`, `1.2k`, `34k`, `1.5M`                                                |
| `multiple(u, searchMax?)`                      | A load multiple rounded down, so it never promises more: `2.6×`, `53×`      |
| `multiples({ low, high }, searchMax?, short?)` | Two edges: `7.4×`, `between 7.4× and 10×`, short `7.4×–10×`, `7.4× or more` |
| `pct(share)`                                   | A 0 to 1 share as a percentage: `50 %`                                      |
| `secs(s)`                                      | A meter's duration: `0 s`, `42 s`, `3 min`, `> 1 h`, `stalled`              |
| `duration(s)`                                  | A latency: `180 ms`, `1.2 s`, `3 min`, `unbounded`                          |
| `monthOf(date, short?)`, `around(date)`        | `March 2028` (UTC, the same in every locale), `around March 2028`           |
| `months(low, high)`                            | When two edges are reached: ` (around March 2029)`, ` (between … and …)`    |
| `niceStep(x)`                                  | The 1-2-5 step at or above `x`                                              |
| `joinAnd(items, word?)`, `capital(s)`          | `a, b and c` (or `or`); the first letter in capitals                        |

## Fits (`@loadmap/core/calibrate`)

`fitLinear(points, { x, y, source?, through? })` fits `cost = a + b × x` to measurements by least squares. It needs
two distinct `x` values at least; `through: 'origin'` fixes `a` at 0, for a cost with no idle part. It is also
exported by `@loadmap/react`.

```ts
import { fitLinear } from '@loadmap/core/calibrate'
import cpu from './worker-cpu.json' // [{ "rate": 120, "cores": 0.9 }, { "rate": 480, "cores": 2.7 }, …]

const workerCores = fitLinear(cpu, { x: 'rate', y: 'cores', source: 'CPU dashboard, peak week' })
workerCores(600) // the cores at 600 per second
```

The `LinearFit` it returns is callable (`fit(x)` is the cost at `x`) and carries `a`, `b`, `r2` (0 to 1), `n`, the
`x` and `y` names, `source` and `provenance: 'measured'`. A fit read from a snapshot also has its `origin`, or
`unread` when the snapshot gave no series and the definition's own fit stands. The same entry re-exports `measured`
and `estimated`.

## Snapshots (`@loadmap/core/measure`)

A model reads measured data from a **snapshot**: a JSON file with each measurement's value over a window, its points
and where they came from. `loadmap pull` writes one next to the definition; [Measured data](/language/measured-data/)
has the statements that read it.

```json
{
  "format": "loadmap-snapshot",
  "version": 1,
  "fetched": "2026-11-08T00:05:00Z",
  "from": "2026-11-01T00:00:00Z",
  "to": "2026-11-08T00:00:00Z",
  "measurements": {
    "checkoutRate": {
      "label": "Checkout requests",
      "unit": "req/s",
      "value": 412.5,
      "series": [
        [1793491200, 398.1],
        [1793491500, 405.7]
      ],
      "origin": {
        "provider": "prometheus",
        "query": "sum(rate(http_requests_total{route=\"/checkout\"}[5m]))",
        "metric": "requests",
        "from": "2026-11-01T00:00:00Z",
        "to": "2026-11-08T00:00:00Z",
        "step": 300,
        "fetched": "2026-11-08T00:05:00Z",
        "samples": 2016,
        "min": 100,
        "stat": "mean"
      }
    },
    "dbCapacity": {
      "unit": "queries/s",
      "missing": "no elasticsearch is configured"
    }
  }
}
```

- The top level: `format` is always `"loadmap-snapshot"`, `version` is 1, and `fetched`, `from` and `to` are ISO 8601
  instants with a time zone.
- A measurement is either read or missing. Read: `unit`, `value` (a finite number), `origin`, and optionally `label`
  and `series`. Missing: `missing` (why, in words), and optionally `label`, `unit` and `origin`.
- `series` is the points, oldest first, each `[unix seconds, value]`.
- `origin` says how it was read: `provider` and `query` (as sent, never with an address or a credential), `from`,
  `to` and `fetched` (ISO 8601), `samples` (points in the window), and optionally `metric` (the mapping that wrote the
  query), `step` (seconds), `min` (points it needs before it counts) and `stat` (`mean`, `min`, `max`, `last`, `p50`,
  `p95` or `p99`: how the window became one value).
- A file read back may carry `source`, the line a measured value shows; it is written again on every read.

| Export                    | What                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `parseSnapshot(input)`    | The text or parsed JSON checked: a `Snapshot`, or an error that says where it is wrong |
| `fromSnapshot(snapshot?)` | A `SnapshotReader`, for the model's functions or `compile(source, { snapshot })`       |
| `MEASURES`                | The standard measurements per kind (`flow`, `pass`, `queue`, `workers`, `cache`, …)    |
| `summarize(series, stat)` | A window as one value; percentiles interpolate as Prometheus's `quantile_over_time`    |
| `originText(origin)`      | The line a measured value's source shows                                               |

An opened file is untrusted input: anything that is not a snapshot is refused with where it went wrong. A value with
no samples, or fewer than its `min`, comes back missing, with why: it does not count, and the definition's own value
is used. `parseSnapshot`, `fromSnapshot`, `MEASURES`, `summarize` and `originText` are also exported by
`@loadmap/react`.

A `SnapshotReader` has `snapshot` and four reads, each falling back to the definition's own value, marked with why:

| Read                                 | What                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `capacity(name, fallback)`           | The measurement as a measured capacity with its origin; a unit that differs does not count |
| `value(name, fallback)`              | The measurement's value: a rate, a hit share, a count                                      |
| `fit(x, y, fallback, { through? }?)` | `cost = a + b × x` from two series on the same timestamps                                  |
| `unread(name)`                       | Why a measurement does not count; `null` when it does                                      |

```ts
import { estimated } from '@loadmap/core'
import { fromSnapshot, parseSnapshot } from '@loadmap/core/measure'
import json from './shop.snapshot.json'

const read = fromSnapshot(parseSnapshot(json))
// a component's capacity: the gateway's measured one, or the estimate while there is none
const gatewayCapacity = read.capacity('gatewayCapacity', estimated(20_000, 'req/s', 'vendor benchmark'))
```

`fromSnapshot(undefined)` reads nothing and marks nothing missing: a check without fresh data (a pull request from a
fork) still runs on the definition's values.

## Measured data (`@loadmap/providers`)

Nothing in a definition or a shared link fetches anything: a pull is an explicit action, and the address and the
credentials come from the environment, never from the text. `loadmap pull` is the usual way in;
[Live data](/live-data/) has a shop to try it on.

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

| Export                                                      | What                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| `pull(requests, { from, to, step, fetched, providers })`    | `Promise<Snapshot>`: every measurement read over one window     |
| `prometheus({ url, token?, user?, password?, fetch? })`     | A provider: a PromQL query over a range (`/api/v1/query_range`) |
| `elasticsearch({ url, apiKey?, user?, password?, fetch? })` | A provider: an index as a date histogram at the step            |
| `providersFromEnv(env, { fetch?, only? }?)`                 | The providers the environment configures, by id                 |
| `PROVIDER_ENV`                                              | What each provider needs set, as a line to print                |

`pull` takes `compile(…).measures` (each a `PullRequest`: `id`, `provider`, `query`, `unit`, and optionally `metric`,
`label`, `stat` and `minSamples`). The window, `from` and `to`, is the same for every measurement; `step` is the
seconds between points and `fetched` the snapshot's date. Each value is the window by its `stat` (mean by default).
What fails is missing, with why, and so is a window with fewer samples than its `minSamples`: the model then uses the
definition's own value.

A provider is one adapter, `{ id, read({ query, from, to, step }) }`, that resolves to `{ points }` or to
`{ error }`: an error is data, never a throw, so one failing query leaves that measurement missing. Prometheus must
give one series (several are an error that says to sum them) and leaves out points written as NaN or ±Inf.
Elasticsearch (and OpenSearch) counts documents per second (`rate`) or per step (`count`), or takes the `avg`, `sum`,
`min` or `max` of a field; a window where no document matches is an error, not zeros, so a wrong query never reads as
no traffic. A user and password written in an address move into the header, and no error repeats the address or a
credential.

`providersFromEnv(env)` reads `LOADMAP_PROMETHEUS_URL` with `LOADMAP_PROMETHEUS_TOKEN` (or `_USER` and `_PASSWORD`),
and `LOADMAP_ELASTICSEARCH_URL` with `LOADMAP_ELASTICSEARCH_API_KEY` (or `_USER` and `_PASSWORD`). `only` builds just
the providers named, so an address set for another one cannot fail this pull; `fetch` goes to every provider (a
proxy, a test).

## Drift (`@loadmap/core/drift`)

The tests behind `loadmap drift` ([The command line](/recording/#drift)): where a series shifted, whether two windows
differ, and whether a value left the band its history sets. They are deterministic (no random permutations), so the
same data gives the same report.

```ts
import { changePoints, compareWindows, threshold } from '@loadmap/core/drift'

changePoints(snapshot.measurements.checkoutRate.series ?? [])
compareWindows(lastWeek, thisWeek) // { p, change, verdict: 'higher' | 'lower' | 'same' }
threshold(pastRuns, todaysHeadroom, { test: 'iqr' }) // null until there are 5 runs
```

| Export                                       | What                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| `changePoints(series, options?)`             | `ChangePoint[]`: where a series shifted                                              |
| `compareWindows(before, after, options?)`    | `WindowComparison`: a Mann-Whitney U test with a dead zone on the change of the mean |
| `threshold(history, value, test?, options?)` | `ThresholdResult` or `null`: the value against the band of the last runs             |
| `mannWhitney(a, b)`                          | The two-sided p-value of the Mann-Whitney U test                                     |
| `welch(a, b)`                                | The two-sided p-value of Welch's t-test                                              |

- `changePoints(series, { pValue?, minSize?, maxPoints? })` takes `[t, value]` points and splits them by E-divisive,
  keeping a split only when Welch's t-test between its sides is significant. A shift counts below `pValue`
  (default 0.001), with at least `minSize` points on either side (default 5); a series longer than `maxPoints`
  (default 500) is averaged into that many buckets first. Each `ChangePoint` is `{ index, t, before, after, change,
  p }`: the first point after the shift and its time, the means on each side, `(after − before) ÷ |before|` (`null`
  when the mean before is 0) and the test's p-value.
- `compareWindows(before, after, { confidence?, deadZone? })` takes two lists of values. The verdict is `higher` or
  `lower` only when the test is sure at `confidence` (default 0.98) and the mean moved more than `deadZone` (default
  0.05, 5 %); otherwise `same`. It returns `{ p, change, verdict }`.
- `threshold(history, value, test, { window?, min? })` builds the band from the last `window` runs (default 30), once
  there are `min` (default 5), and returns `{ lower, upper, samples, outside }` with `outside` `'above'`, `'below'` or
  `null`. The test is `{ test: 't_test', confidence? }` (the default, confidence 0.99), `{ test: 'iqr', k? }` (Q1 − k
  × IQR to Q3 + k × IQR, k 1.5), `{ test: 'percentage', share }` (the mean ± that share) or `{ test: 'static', lower?,
  upper? }` (fixed bounds, judged without any history).

## The catalog (`@loadmap/core/catalog`)

Published benchmark figures, one entry per component, each run with the conditions it was measured under and a link
to its source: `kafka`, `rabbitmq`, `valkey`, `etcd`, `cockroachdb`, `clickhouse`, `opensearch`, `nginx`, `haproxy`,
`coredns`, `kubernetes`, `istio`, `postgresql`, `mysql`, `mongodb` and `envoy`, each of the latest edition.
`published` (from `@loadmap/core`) takes one with a configuration and gives the figure of the run that matches:

```ts
import { published } from '@loadmap/core'
import { kafka } from '@loadmap/core/catalog'

// a capacity with its run's conditions and source, or none when no run matches
const brokers = published(kafka, { brokers: 3, replication: 3, acks: 'all', messageSize: '1 KB', producers: 4 })
```

A configuration no run matches gets no number, is not ranked, and the verdict says so; a figure is never scaled or
interpolated. Besides the conditions, the configuration takes `figure` (which one, when several match), `version`
(the version the reader runs) and `margin` (a share from 0 to below 1 that lowers a best case: the capacity then
ranges from `(1 − margin) ×` the figure up to it). `EDITIONS` holds every released edition by its `YYYY-MM` name
(a released one never changes) and `CATALOG` the latest. `@loadmap/react/catalog` is the same entry for a page that
installs only react. The catalog is in no first load: a host compiling a `.loadmap` calls `loadCatalogFor(source)`
first ([The language in code](/api/language/)). [Published figures](/language/published/) has the statement and the
rules.

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

[The command line](/recording/) has each command's options; `loadmap --help` prints them. Only `record` needs
Playwright and its Chromium, installed next to the command.

The package is a command line, not a library. Its entry exports each command as a function of its arguments that
resolves to the exit code (`check(argv, { log })`, `fmt`, `pull`, `drift`, `bundle`, and `main(argv)` for all of
them), and `lsp(input, output)`, which the VS Code extension runs. They are what the `loadmap` command runs, with the
same arguments; for a model in code, use `@loadmap/dsl`, `@loadmap/core` and `@loadmap/providers` directly.
