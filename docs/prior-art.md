# loadmap: prior art

Research date 2026-10-31. Versions and dates come from the npm and PyPI registries and the GitHub API, read on that day. Anything marked *(unverified)* comes from memory or secondary sources and was not confirmed.

---

## 1. React Flow / xyflow

**What:** a React library for node-based editors (`@xyflow/react`), plus a Svelte sibling.
**Status:** `@xyflow/react` 12.12.0 (2026-09-24), MIT, about 1.2 MB unpacked, actively maintained (repo pushed 2026-10-29, about 39k stars). Some examples are paid "Pro" content, including automatic edge routing.

**Relevant mechanics**
- Custom node and edge types come from a `nodeTypes`/`edgeTypes` registry. `EdgeLabelRenderer` portals HTML labels into a div layer above the SVG.
- Sub-flows: a child sets `parentId` and is positioned relative to its parent, and `extent: 'parent'` clamps it inside. Parents must come before their children in the array. Edges to a child render above nodes.
- State can be controlled (`nodes` with `onNodesChange`) or uncontrolled (`defaultNodes`).
- There is no layout engine. The layouting guide compares dagre, d3-hierarchy, d3-force and elkjs, and only ELK handles sub-flows and edge routing well. Dagre has an open issue (#238) with edges that cross sub-flow boundaries. For obstacle-avoiding edges the docs point to libavoid-js.
- Particles: the docs ship an "Animated SVG Edge" that uses SMIL `<animateMotion>` (or WAAPI `offsetDistance` for HTML elements).
- Performance guidance: memoize custom nodes and callbacks, don't subscribe components to the whole `nodes` array, use `onlyRenderVisibleElements`. A practical ceiling of around 1k interactive DOM nodes is folklore *(unverified)*.

**Borrow**
- The type registry for node and edge renderers.
- The measure-then-layout two-pass (`useNodesInitialized`).
- Controlled state as the default.
- Separate SVG and label layers.
- The parent-relative coordinates for groups.

**Avoid**
- Depending on it. loadmap is a *viewer with controls*, not an editor. React Flow brings pan/zoom/drag/selection, HTML-DOM nodes (which hurt faithful PNG/video export because they need DOM rasterisation) and a viewport transform you would have to mirror on the particle canvas.
- Using `<animateMotion>` for particles: one DOM element per particle, wall-clock driven, and it can't be stepped deterministically per frame without hacks.

---

## 2. D3 modules and label placement

| Package | Version / date | License | Use for loadmap |
|---|---|---|---|
| d3-force | 3.0.0 (2021-06) | ISC | `forceCollide` for local label nudging. v3 has `simulation.randomSource()`, so runs are deterministic. |
| d3-shape | 3.2.0 (2022-12) | ISC | Edge path generators (`line`, `link*`, curves such as `curveBasis`/`curveMonotoneX`). |
| d3-scale | 4.0.2 (2021-09) | ISC | `scaleSequential`/`scaleThreshold` for utilisation colour, `scaleSqrt`/`scaleLog` for rate to particle density, `scaleLinear().ticks()` for slider axes. |
| d3 (umbrella) | 7.9.0 (2024-03) | ISC | Don't import the umbrella; import the modules. |

These modules are "done" rather than abandoned: stable APIs, tiny, tree-shakeable (d3-force is about 15 KB per pkg-size).

**Labelling libraries**
- **D3-Labeler** (tinker10, 2014; npm `d3-labeler` 1.0.0, 2018, an unofficial republish). Simulated annealing over label positions, with an energy made of leader length, overlap and label-label/label-anchor collisions. Unmaintained. Borrow its *energy function*, not the code.
- **d3fc-label-layout** (now `@d3fc/d3fc-label-layout` 7.0.4, 2024-06, MIT). Strategies: `greedy`, `annealing`, `removeOverlaps`, `boundsCheck`, plus candidate positions per anchor. This is the cleanest API model: *label = anchor + candidate rects; strategy = pluggable*.
- **labella.js** (Twitter, 1.1.4, 2017, Apache-2.0). 1-D force-based placement for timeline labels. Useful pattern for stacked labels on a ranked list or axis.
- **Newer research:**
  - Luboschik, Schumann and Cords, "Particle-Based Labeling" (IEEE TVCG 14(6), 2008). It rasterises "conflict particles" over everything that must stay visible (edges, nodes and, for loadmap, particle lanes), then places labels by priority into free space, falling back to a leader line. It runs in real time.
  - GPU and RL methods: Pavlovec et al. 2022 "Rapid Labels", and "Reinforced Labels" (arXiv 2303.01388). These are overkill.
  - The most battle-tested production approach is map-engine symbol placement (Mapbox/MapLibre): greedy by priority with a grid collision index *(described from knowledge)*.

**Borrow:** a greedy, priority-ordered placer with 4- to 8-position candidates per anchor plus a uniform-grid collision index (the Luboschik/MapLibre idea). Add a one-shot annealing pass only if greedy leaves overlaps. Make every step deterministic.
**Avoid:** running a live force simulation for labels every frame, because labels jitter. Use forceCollide only as an offline, fixed-iteration, seeded relaxation if at all.

---

## 3. Netflix Vizceral

**What:** a WebGL (three.js) component for animated traffic graphs with three levels of detail: **global** (regions), **regional** (services in a region, laid out automatically) and **focused/service**. Clicking drills down a level. Nodes carry classes (normal/warning/danger) that colour the particles, plus "notices". There is also a `vizceral-react` wrapper.

**Status:** effectively dead. The last npm release is 4.9.0 (2019-07-20). The only commits since are Dependabot bumps (late 2023). It pins `three` ^0.106. Apache-2.0. The GitHub repo is *not* formally archived. Netflix never published a reason for stopping *(unverified; no official statement found)*.

**Particle rendering (read from `src/base/connectionView.js`)**
- One `THREE.Points` per connection, with a `BufferGeometry` and per-particle `position`, `customOpacity`, `size` and `customColor` attributes, drawn by a custom shader with a sprite texture.
- Particles live in a pooled buffer with a free-index stack. When the pool runs dry it grows by doubling, up to `maxParticles`.
- Rate is mapped to particles by a piecewise-linear **rateMap** that deliberately boosts the low end. Any non-zero volume emits at least one dot every 10 s, volume 1 emits one every 7 s, volume 10 one every 5 s, and above that it is linear up to 19 releases per tick at the busiest edge. The comment says a log scale was rejected: "we really just want to boost the low end".
- Particle density is *relative to the busiest connection* (`volumeGreatest`). Each class (normal/error) gets its own share of the releases.

**Borrow**
- Particles are a *visual sample* of rate, not 1:1 requests.
- A rate-to-emission mapping with a floor (so small flows stay visible) and a cap.
- Pooled typed-array particles drawn in one batch.
- Colour by outcome class (ok/dropped/lagging).
- Semantic levels of detail (cluster, then the partition grid inside it).

**Avoid**
- WebGL/three.js for this scale, since Canvas 2D handles thousands of dots.
- Density relative to the busiest edge only. It hides absolute changes when the user moves a slider, so loadmap should use an absolute scale with a legend.
- Its force-ish auto-layout.
- The webpack/url-loader build.
- The wall-clock tick: Vizceral assumes 60 fps.

---

## 4. Discrete-event and queueing simulation

| Tool | Version / date | License | Key abstractions |
|---|---|---|---|
| **SimPy** | 4.1.2 (2026-05) | MIT | `Environment`, generator `Process`, `Resource`/`PriorityResource`/`PreemptiveResource`, `Container` (level), `Store`/`FilterStore`/`PriorityStore` |
| **Salabim** | 26.0.8 (2026-06) | MIT | `Component` (process), `Queue`, `Resource`, `State`, `Store` *(unverified)*. Built-in 2D/3D animation and **video output that renders frames in simulation time**, not wall time. |
| **Ciw** | 3.2.7 (2025-12) | MIT | Open queueing *networks*: routing matrices or custom routing functions, priority classes (with pre-emption), baulking, reneging, blocking, server schedules, deadlock detection |
| **JaamSim** | active (pushed 2026-10-31) | Apache-2.0 | Java GUI DES: `EntityGenerator`, `Queue`, `Server`, `Branch`, `EntityConveyor`, `EntitySink`, and so on: a palette of stage objects with 3D animation |

**How these map onto loadmap:**

| loadmap concept | Source |
|---|---|
| source | Generator |
| queue (backlog, lag) | Queue / Store |
| worker pool | Resource with capacity c (Ciw "server" count) |
| store | Container / Sink |
| fan-out | Branch / routing matrix |
| priority between flows | PriorityResource / Ciw priority classes |
| drop | baulking or a blocking limit |
| round-robin across pods | a custom routing function (Ciw) |

**JS DES engines**

| Engine | Version / date | License | Notes |
|---|---|---|---|
| simjs | 2.0.3 (2016) | MIT | Callback-based |
| SimScript | 1.0.37 (2021-09) | ISC | TypeScript, async/await processes, has animation |
| SimTS | 1.0.4 (2021-12) | MIT | A typed fork of simjs |

All three are unmaintained. None is worth depending on.

**Recommendation:** don't use a DES for loadmap's core. There are two different needs:
1. **Numbers (verdict, ranking, crossings).** These are analytic.
   - Utilisation per component is ρ = λ·cost(λ)/capacity, with cost = a + b·λ.
   - With linear costs, the 50% and 100% crossings over the multiplier *m* often have a **closed form**. Keep bisection as the general fallback for non-linear dependencies such as cache hit ratios or controls that depend on load.
   - Little's law (L = λW) and an M/M/c/Erlang-C approximation can give lag and latency hints.
2. **Particles (visual).** Use a **fixed-step fluid model** (backlog += (in − out)·dt per stage, with priority served first, a drop above the limit, and round-robin fill), and draw particles *sampled* from those flows.
   - Use a seeded RNG and a fixed dt decoupled from rAF (the "fix your timestep" accumulator).
   - This gives determinism (needed for export), is cheap, and never disagrees with the analytic verdict.

An event-driven engine is only worth it if you later want measured p99s, the way Breakscale does it (§8).

**Borrow:**
- Ciw's vocabulary (priority classes, routing functions, baulk/renege/block) for naming queue semantics.
- SimPy's small resource taxonomy.
- Salabim's "animate in sim time, export video frame by frame".
- JaamSim's palette of stage objects.

**Avoid:**
- 1 particle = 1 request.
- Generator/coroutine processes in the render loop.
- Letting the stochastic sim decide the verdict.

---

## 5. Explorable explanations and reactive parameter models

- **Bret Victor, "Explorable Explanations" (2011) and Tangle.js.** A document whose numbers are draggable. The model is a plain object with `initialize()` and `update()`. Views (adjustable numbers, toggles) only read and write named variables, and `update()` derives everything else.
- **Nicky Case** (explorabl.es hub, Loopy, Parable of the Polygons). Sandbox-first: show the simulation, let the reader break it, and narrate with presets ("try this").
- **Observable.**
  - `@observablehq/runtime` 6.1.0 (2026-10-23, ISC) is a reactive dataflow graph: cells declare inputs, and the runtime recomputes in topological order.
  - Notebook Kit 2.9.1 (2026-10) is "Notebooks 2.0".
  - **Inputs** 0.12.0 (2024-08) are plain DOM elements that expose `.value` and dispatch `input` events, so they are model-agnostic.
  - **Plot** 0.6.17 (2025-02; the repo is still active) is a declarative grammar of marks.
- **Idyll** 6.0.0-alpha.6 (2022-04). The repo has been quiet since 2023, so it is dormant.

**Borrow**
- A **pure model**: params → derived (a DAG of computed values, recomputed topologically) → view. The view never owns state.
- Controls are typed value emitters described declaratively (`{type:'range', min, max, step, unit, dependsOn}`).
- Presets are just param snapshots.
- Serialise the params into the URL for sharing.
- Dependencies between controls ("enabled when", "max = f(other)") belong in the same DAG.
- Plot's idea that marks are declarative data → visual mappings.

**Avoid:**
- A notebook runtime or a markup language (Idyll).
- Implicit global reactivity.
- Recomputing layout when only load parameters change: layout should depend on topology, not on load.

---

## 6. Layout engines that handle labels

**ELK / elkjs.** 0.12.1 (released 2026-10-28). npm declares `EPL-2.0 OR GPL-3.0-or-later`. Bundle about 1.45 MB minified (per React Flow's pkg-size table). Actively maintained.
- The **layered** (Sugiyama) algorithm places edge labels as **dummy nodes**, so they are collision-free by construction. Options include `elk.edgeLabels.placement` (HEAD/CENTER/TAIL), `elk.edgeLabels.inline` and side selection.
- **Ports** with `portConstraints` (FIXED_SIDE/FIXED_ORDER).
- **Compound/hierarchical** graphs with `hierarchyHandling: INCLUDE_CHILDREN`, which supports edges that cross group boundaries.
- `edgeRouting` ORTHOGONAL/POLYLINE/SPLINES.
- `considerModelOrder` gives stable output.
- An async API that runs in a **Web Worker** (`elk-worker.min.js`).
- Downsides: size, a Java-transpiled API with a large option space, and no native "grid of cells" inside a group.

**dagre.** `@dagrejs/dagre` 3.1.3 (2026-10-24, MIT). It was revived: v2.0.0 (Nov 2025) modernised the build, and 3.x followed. The old `dagre` 0.8.5 (2019) is dead.
- Edge labels with width/height and `labelpos` are also placed as dummy nodes.
- Compound support has the cross-boundary bug (#238).
- No ports, and only basic edge routing.
- Small, synchronous, good enough for flat graphs.

**libavoid-js.** 0.5.0-beta.5 (2026-02), a WASM port of Adaptagrams libavoid, **LGPL-2.1**. It does orthogonal and polyline connector routing around obstacles and supports incremental re-routing. The React Flow Pro edge-routing example uses it. It is still beta and the LGPL needs care, so make it an optional plugin at most.

**WebCola.** 3.4.0 (2019-05; the repo had commits in 2026 but there has been no release since 2019), MIT. Constraint-based layout: alignment, separation, non-overlapping groups. Elegant but unreleased for 7 years, and it is a force layout with nothing like ELK's label handling.

**Labeller algorithms worth knowing:** greedy with priorities plus a collision grid (MapLibre); particle-based labelling (Luboschik 2008); simulated annealing (Christensen, Marks and Shieber 1995, the D3-Labeler lineage); and the 4/8-position and slider candidate models.

**Borrow:**
- ELK layered, run in a worker, for the *macro* layout of nodes, groups, edge routes and edge labels.
- Let loadmap compute *inner* grids itself (partitions in a broker, workers in pods) and hand each group to ELK as a fixed-size node with ports.
- A small greedy priority labeller for *dynamic* annotations (utilisation badges, lag counters) that ELK doesn't know about, with obstacles that include the particle lanes.

**Avoid:**
- Relayout on every slider move.
- dagre for compound graphs.
- WebCola.
- libavoid as a hard dependency.

---

## 7. Export: PNG, GIF and video

**In-browser options**
- **`canvas.captureStream()` + MediaRecorder.** Real-time and wall-clock based, so it drops frames under load and its codec and container depend on the browser. It records only canvas, not SVG. Not deterministic.
- **WebCodecs `VideoEncoder` + a muxer.**
  - `mp4-muxer` 5.2.2 and `webm-muxer` 5.1.4 are both **deprecated** (2025-07) and superseded by **Mediabunny** 1.65.0 (2026-10-30, MPL-2.0, very active, about 7.4k stars).
  - Mediabunny's `CanvasSource.add(timestamp, duration)` encodes whatever is on the canvas *at a timestamp you choose*. That is exactly the deterministic frame-stepping interface: MP4 (H.264/AV1) or WebM (VP9/AV1), faster or slower than real time.
- **GIF.** `gifenc` 1.0.3 (2021, MIT): fast quantise+encode, worker-friendly, small. `gif.js` 0.2.0 (2016) is older and slower. Mediabunny does not do GIF.
- **SVG → canvas.**
  - Serialise the SVG (`XMLSerializer`) into an `Image` and `drawImage` it. Styles, CSS variables and fonts must be inlined first.
  - `html-to-image` 1.11.13 (2025-02; repo active) and `modern-screenshot` 4.7.0 (2026-04) automate this for DOM, but cost tens of ms per call *(unverified figure)*.
- **PNG.** `OffscreenCanvas.convertToBlob` / `canvas.toBlob`.

**Headless options**
- **Puppeteer.** `page.screencast()` (needs ffmpeg) and `puppeteer-screen-recorder` 3.0.6 (2024-10) are both wall-clock driven.
- **Playwright `recordVideo`.** Low-quality VP8, wall-clock.
- **CDP `Page.startScreencast`.** Emits frames when the compositor produces them, unsynchronised with app time.
- **Virtual time.**
  - **timecut/timesnap** (BSD-3, last release 2022) override `requestAnimationFrame`, `Date`, `performance.now` and timers, then screenshot each virtual frame. This is the canonical technique, but the packages are stale.
  - The **Playwright Clock API** (`clock.install`, `pauseAt`, `runFor`) does the same overriding officially (it covers `Date`, timers and rAF).
  - CDP `HeadlessExperimental.beginFrame` gives compositor-exact frames, but only in `chrome-headless-shell` with BeginFrameControl *(support in new headless unverified)*.
  - `Emulation.setVirtualTimePolicy` is another CDP path *(unverified)*.
- **Remotion** (`@remotion/renderer` 4.0.539, 2026-10). Its model is "a frame is a pure function of `frame`" (`useCurrentFrame()`), rendered headless and stitched with ffmpeg. It is source-available with a company licence for teams *(licence terms unverified)*.

**Recommendation:** a deterministic, in-browser pipeline that headless Chrome merely *hosts*.
1. The scene is a pure function `draw(ctx, state, t)`. The sim advances with `step(dt)` using a fixed dt (for example 1/60 or 1/fps) and a seeded RNG. Live playback uses an accumulator; export loops `for frame in 0..N: sim.step(dt); draw(); encode(t)`.
2. The structure (the SVG layer) changes only when the model or theme changes. Rasterise it **once per state** to an `ImageBitmap` (serialise the SVG with inlined styles and embedded fonts), then per frame composite bitmap, particles and overlays onto an `OffscreenCanvas`. Better still, keep a Canvas-2D renderer for the structure that shares the same scene graph as the SVG renderer: one source of truth, two backends.
3. Encode with **Mediabunny** (MP4/WebM) and **gifenc** (GIF, at reduced fps and a quantised palette), with PNG from the same canvas. This can run in a worker.
4. For CI or batch work, Playwright simply opens the page and calls `window.loadmap.export({format, fps, seconds})`. No screencast, no CDP frame capture, no clock patching. If you need a fallback for arbitrary pages, use the Playwright Clock API plus screenshots, timesnap-style.

---

## 8. Close neighbours: "interactive capacity models"

- **Backpressure** (commercial, browser). It is the closest product to loadmap's verdict.
  - A deterministic engine stepped second by second.
  - A verdict: survived or collapsed, the bottleneck and its utilisation, and the RPS at which the design broke.
  - **Load sweeps** whose "headroom curve names the multiple the design survives to".
  - Compare mode, an MCP server and CLI, and Mermaid export.
  - Borrow: the verdict wording and the compare mode. The difference for loadmap: it is a library, declarative, with fitted cost models and measured-vs-estimated capacities.
- **Breakscale** (MIT, breakscale.tech, a VS Code extension and an MCP server). A real DES with finite server slots, gamma service times, FIFO queues with shedding, and percentiles measured from a ring buffer. Its `src/sim` has "no React, no DOM, no I/O", the separation loadmap should copy. It ships 33 components and examples modelled on real systems.
- **Crucible** (MIT). Svelte plus `@xyflow/svelte`, with the sim in Go → TinyGo → WASM (about 200 KB) inside a **Web Worker**. It adds chaos injection, a topology linter, and cost/SLO chips per node.
- **systemInPain**: a level-based game on a seeded deterministic engine.
- **Chinilla**: drag-and-wire traffic simulation in the browser.
- **SystemDesignSim**: a Go desktop game.
- **Sam Rose's "Load Balancing" (2023) and "Queueing" (Encore blog, May 2024).** The best *explorable* prior art: dots as requests, queues filling, dropped and timed-out requests, and side-by-side strategies (FIFO, LIFO, priority, AQM). Borrow the visual grammar for drops, timeouts and priority lanes, and the restraint (a few elements, clear legends).
- **Kafka sizing tools.** NetApp's Confluent sizing tool, the DevToolbox Kafka calculator, and the AxonOps and AutoMQ formulas (about 10 MB/s per partition, broker count = max(throughput, partition and HA constraints)). These are static calculators with no topology and no animation. loadmap's niche is formula + topology + motion.
- **Diagram-as-code.**
  - **Mermaid** 12.2.0 (2026-10, MIT) now uses ELK via `@mermaid-js/layout-elk`.
  - **D2** (MPL-2.0, active) uses dagre or ELK for free and **TALA**, a proprietary licensed layout engine, for better label and container handling. Its animation is board-to-board, not traffic.
  - **Structurizr**: one C4 model with many views.
  - **Ilograph**: interactive "perspectives" over one model (commercial; status not verified).
  - Borrow: one model rendered as several *views* (traffic, cost, capacity), and an import of Mermaid/D2-like topology text.
- **Animated particles along paths.**
  - React Flow's animated SVG edge (SMIL).
  - `motion` 14.9.0 (2026-10) offset-path animations.
  - Theatre.js (`@theatre/core` 0.7.2, 2024; quiet).
  - None is a particle *system*. Rolling your own (path sampled to a polyline lookup table, then typed-array particles on Canvas 2D) is about 200 lines and beats them on throughput and determinism.

---

## Synthesis for loadmap

1. **Own the SVG; don't depend on React Flow.** loadmap is a viewer with controls, not an editor. Borrow React Flow's node/edge type registry, its controlled state and its measure-then-layout pass, and maybe ship an adapter later.
2. **Use three pure layers: model → sim → render.** The model (topology, params, cost fits, capacities) and its derived DAG are pure TypeScript with no React or DOM (Breakscale's `src/sim` rule). React is only the binding.
3. **Get the verdict analytically, not from particles.**
   - Utilisation is ρ = load × cost / capacity.
   - Use the closed-form crossing for linear cost models and bisection over the multiplier for everything else.
   - Little's law and Erlang C for lag and latency hints.
   - Carry provenance (measured vs estimated, fit R²) through every number into the verdict sentence.
4. **Run the particles on a fixed-step fluid sim with a seeded RNG.**
   - Stages hold backlogs.
   - Priority is served first, drops happen above the limit, and round-robin fill is deterministic.
   - Particles are a sampled view of rates, using Vizceral's rate map with a low-end floor but on an *absolute* scale.
   - No DES dependency; the JS options are all dead.
5. **Use ELK layered in a Web Worker for the macro layout**, with edge labels as dummy nodes, ports, and `INCLUDE_CHILDREN` for groups. Lay out inner grids (partitions, workers in pods) in loadmap itself and pass them to ELK as fixed-size nodes. Lazy-load ELK (about 1.45 MB) and cache the result by topology hash. Never relayout on load changes.
6. **Add a small greedy priority labeller** (candidate positions plus a grid collision index, with particle lanes and nodes as obstacles) for dynamic badges. It is deterministic and needs no per-frame forces.
7. **Render with SVG for structure and Canvas 2D for particles**, from one scene graph with a shared transform. Use pooled typed arrays and path lookup tables. Reduced motion swaps particles for static rate-width strokes or dashes. Theme tokens feed both backends.
8. **Export deterministically in the browser.**
   - Drive the clock with fixed `step(dt)`, then `draw(t)`.
   - Rasterise the structure once per state and composite particles per frame on an OffscreenCanvas.
   - Encode with **Mediabunny** (MP4/WebM; `mp4-muxer`/`webm-muxer` are deprecated), **gifenc** (GIF) and `toBlob` (PNG).
   - Headless Chrome (Playwright) just calls `loadmap.export()`, which replaces CDP screencasting.
9. **Make controls declarative and typed**, with presets as param snapshots, dependencies in the same derived DAG, and URL-serialisable state (Tangle/Observable Inputs). Use Ciw's and SimPy's vocabulary for queue semantics (priority class, routing function, baulk/drop, capacity c).
10. **Position against the field.** Backpressure, Breakscale and Crucible are *apps* where you draw designs. loadmap's distinct value is a **library** for authored, declarative, data-fitted models (measured cost fits, a provenance badge per capacity) that embeds in docs and exports to video.

---

# Part 2: text definitions and live editors

Research date 2026-10-31, for the `.loadmap` language and the editor (`@loadmap/dsl`, `@loadmap/editor`). Same rules as above for versions and *(unverified)*.

## 9. Mermaid and mermaid.live

**What:** the most used text-to-diagram language, with one grammar per diagram type, and its live editor.
**Status:** `mermaid` 12.2.0 (2026-10-13), MIT, about 91k GitHub stars, 119 MB unpacked on npm. `@mermaid-js/parser`
2.0.1 (2026-10-02). `@mermaid-js/layout-elk` 1.0.1. mermaid-live-editor has no releases; pushed 2026-10-30. Eight
advisories in 2026 alone (infinite-loop DoS in Gantt and XY charts, prototype pollution, CSS and HTML injection).

**Relevant mechanics**
- Syntax: the first word picks the diagram type; optional YAML front matter carries config.
  ```
  ---
  config: { layout: elk }
  ---
  flowchart LR
    api[Checkout API] -->|orders| db[(Orders DB)]
  ```
- Parsers, as of 2026-10: 19 diagram types still use Jison grammars (flowchart, sequence, class, state, ER, gantt,
  C4, block, mindmap, ...). 15 use Langium grammars in `@mermaid-js/parser` (pie, info, packet, gitGraph,
  architecture, radar, treemap, treeView, wardley, railroad, ...). The move is per diagram and slow.
- Errors: Jison stops at the first error ("Parse error on line N ... Expecting X, got Y"). The Langium path collects
  every lexer and parser error with line and column (`MermaidParseError`). mermaid.live carries a function that
  guesses the "most relevant line" by fuzzy-matching the error text, because Jison line numbers can be wrong.
- No language version. Old directives (`%%{init: ...}%%`) live on beside front matter.
- Layout: dagre by default, ELK as a plug-in package. Rendering needs a DOM.
- mermaid.live (SvelteKit): Monaco on desktop, CodeMirror 6 on mobile (`MobileEditor.svelte`). The error panel
  appears only after 3 s of an error; the last good diagram stays. The hash is rewritten with `history.replaceState`,
  debounced 250 ms.
- Share URL: `#pako:` + base64url(zlib `deflate` level 9 of `JSON.stringify(state)`). The state holds the code, the
  config as a JSON string, pan, zoom, `rough`, `grid` and more. The older `#base64:` form still decodes. New state
  fields must be optional so old links keep working (a comment in `types.d.ts` says so).
- Export: SVG, PNG, links to mermaid.ink and Kroki (Kroki uses the same deflate encoding in the path).

**Borrow**
- A type prefix on the URL payload (`pako:`, `base64:`) so the encoding can change without breaking old links.
- Keep the last good render while the text is invalid; delay the error banner.
- Errors with line and column for every problem at once, as the Langium path does.

**Avoid**
- Several grammars and two parser generators for one product; error positions you have to patch afterwards.
- Packing UI state (pan, zoom, toggles) into the same blob as the source: the link then breaks on UI refactors.
- Trusting rendered labels: most Mermaid advisories come from text that reaches CSS, HTML or a loop bound.

## 10. D2 and the D2 playground

**What:** a declarative diagram language in Go with pluggable layout engines and a WASM build.
**Status:** d2 v0.9.0 (2026-09-07), MPL-2.0, about 26k stars. `@terrastruct/d2` (WASM for JS) 0.1.33 (2025-08-17),
58 MB unpacked. d2-playground pushed 2026-10-05.

**Relevant mechanics**
- Syntax: keys, `->` edges, maps in braces, `vars` with `${}` substitution.
  ```
  vars: { rps: 120 }
  api: Checkout API
  db: Orders DB { shape: cylinder }
  api -> db: ${rps} rps
  ```
- Variables are scoped to their map, can nest (`${a.b}`), spread (`...${x}`), and single quotes bypass substitution.
  `vars.d2-config` holds render settings (flags and env still win). Substitution is textual: no arithmetic.
- Imports: `x: @file` (regular), `...@file` (spread into a map), partial imports `@file.key`, relative and absolute.
- Parser: hand-written recursive descent in Go. It collects all errors, each with a range (`path:line:col`), counts
  UTF-16 columns for editors, and caps nesting depth (`maximum nesting depth of N exceeded`).
- Layout: dagre (default), ELK, TALA (Terrastruct's own, commercial). Some keywords work only in TALA (`near` an
  object, `top`/`left` locks); D2 writes shims for the others.
- Playground: Monaco with a TextMate grammar (onig.wasm). It compiles on the button or Cmd/Ctrl+S. Errors become
  Monaco markers and a red gutter.
- Share URL: `?script=` + base64url(raw DEFLATE at best compression) via `d2.encode`. Decoding stops at 16 MB.
- Export: SVG and PNG in the playground; CLI also PDF, PPTX, GIF. Boards (layers, scenarios, steps) compose views.

**Borrow**
- A hand-written parser that reports every error with a range and guards depth and size.
- A decode size limit on shared links (decompression bombs).
- Scoped variables declared in the file, not passed in from outside.

**Avoid**
- Features that only one layout engine supports; it splits the language.
- Text substitution as the only way to compute: no units, no arithmetic, no dependency tracking.
- A query parameter for the source: it is sent to the server and lands in its logs.

## 11. PlantUML

**What:** a Java renderer for many UML and non-UML diagram kinds, with a server that renders from the URL.
**Status:** v1.2026.9 (2026-10-17), GitHub reports LGPL-3.0 (other license builds exist), about 13k stars.
`plantuml-encoder` (JS) 1.4.0 (2019-08-09), unmaintained but stable.

**Relevant mechanics**
- Syntax: `@startuml ... @enduml`, one statement per line, a preprocessor with `!define`, `!include`, `$vars`,
  `!function` and loops.
  ```
  @startuml
  !$rps = 120
  component API
  database "Orders DB" as DB
  API --> DB : $rps rps
  @enduml
  ```
- Parser: hand-written, line-based command matching with regexes. Errors: the first failing line, drawn into the
  output image ("Syntax Error?").
- URL encoding: UTF-8, then DEFLATE, then a base64 variant with the alphabet `0-9A-Za-z-_`. A `~h` prefix means
  plain hex. The encoded source is also stored in the PNG metadata. The format "was not created to be public" and
  "it's too late to change it" (their docs).
- Rendering is server-side (or a local jar); Graphviz or the built-in Smetana port lays out.

**Borrow**
- The source travels inside the exported image, so a PNG can be reopened as text.

**Avoid**
- A custom base64 alphabet: every client needs a special encoder forever.
- A macro preprocessor as the expression language; errors point at expanded text, not what the user wrote.
- Server-side rendering for a live preview.

## 12. Structurizr DSL

**What:** the C4 reference tool: one model, many views, written in a block DSL.
**Status:** repositories merged into `structurizr/structurizr` (created 2025-11-30, Apache-2.0, Java), latest
v2026.10.26 (2026-10-26). The old `java`, `cli`, `lite`, `ui` repos were archived in early 2026.
playground.structurizr.com runs it in the browser.

**Relevant mechanics**
- Syntax: line-oriented; one statement per line; a block opens with `{` at the end of a line.
  ```
  workspace {
    !identifiers hierarchical
    model {
      shop = softwareSystem "Shop" {
        api = container "API"
        db = container "DB"
      }
      shop.api -> shop.db "writes orders"
    }
    views {
      container shop {
        include *
        autoLayout lr
      }
    }
  }
  ```
- Model vs views: `model` defines elements and relationships once; `views` select with `include`/`exclude` and lay out
  with `autoLayout` (Graphviz or dagre). Manual positions live in the JSON workspace, not the DSL, and generated view
  keys are "not guaranteed to be stable", so layout can be lost.
- `!identifiers flat` (default, global names) or `hierarchical` (`shop.api`). `workspace extends <file|url>` adds to
  a base workspace and sees its identifiers. `!element` reopens an element. `!include` files.
- Parser: hand-written Java, line by line. It stops at the first error and names the line *(unverified exact format)*.
- `!script` runs Groovy, Kotlin, Ruby or JavaScript inside the DSL. The DSL source is kept base64-encoded in the
  workspace property `structurizr.dsl` when it is "portable" (no includes, scripts or plug-ins).

**Borrow**
- The model/view split: views pick and arrange, they never add facts.
- Hierarchical identifiers (`shop.api`) as an opt-in for larger models.
- Storing the source inside the exported artifact.

**Avoid**
- Scripts inside the DSL; a shared file that runs code.
- Layout stored apart from the text under keys that can change.
- First-error-only parsing.

## 13. LikeC4

**What:** a C4-style architecture DSL in TypeScript, built on Langium, with React components, a VS Code extension and
a web playground. The closest relative to loadmap.
**Status:** `likec4` and `@likec4/*` 1.60.0 (2026-10-15), MIT, about 6k stars, pushed daily. `@likec4/diagram` 2.8 MB
unpacked, depends on `@xyflow/react` 12, Mantine 9, XState. Layout via `@hpcc-js/wasm-graphviz`.

**Relevant mechanics**
- Syntax: four top-level blocks; any file may hold any of them and all files merge into one model.
  ```
  specification { element system  element service }
  model {
    shop = system 'Shop' {
      api = service 'Checkout API'
      db = service 'Orders DB'
    }
    shop.api -> shop.db 'writes orders'
  }
  views { view of shop { include * } }
  ```
- `specification` declares element kinds, tags and relationship kinds; `model` holds facts; `views` are projections
  with predicates (`include`, `exclude`, `where`, wildcards), scoped views (`view of x` resolves names inside x),
  dynamic (sequence) views and deployment views. `extend` adds to elements from other files.
- Parser and tooling: a 1,357-line Langium grammar; validation via Langium `accept('error', ...)`; LSP in a web worker
  for the playground and in the VS Code extension. Errors are LSP diagnostics with ranges, many at once.
- Layout: the model is printed to DOT per view type and laid out by Graphviz WASM; sequence views have their own
  layout. Rendering is React Flow.
- Diagram edits write back to the source: changing an element's style, a view's auto-layout direction or edge
  routing becomes a text edit (`model-change/`). Dragged positions are saved as view snapshots in separate files
  (`save-view-snapshot`, `reset-manual-layout`).
- Playground: Monaco via `@codingame/monaco-vscode-api` and `monaco-languageclient`, i.e. a slice of VS Code.
  Sharing posts the workspace to a Cloudflare Worker KV under a 10-character nanoid, with expiry (1 day to months)
  and an optional PIN. Nothing is encoded in the URL.
- Generators: React components, a typed TS model, D2, Mermaid, PlantUML, draw.io; CLI exports PNG; a Vite plug-in
  serves `likec4:` virtual modules; an MCP server.

**Borrow**
- `specification / model / views` as separate blocks; views as predicates over the model.
- Write-back: a canvas action becomes a minimal text edit, so text stays the source of truth.
- A typed model object that React components take as a prop (`LikeC4ModelProvider`).

**Avoid**
- The weight: Langium plus a VS Code-grade Monaco plus Graphviz WASM is several MB for a playground.
- Server-stored shares for a library that should work from a static page.
- Positions in side files that drift from the text.

## 14. Graphviz DOT and its browser builds

**What:** the classic graph language and layout engines (dot, neato, ...), compiled to WASM for the browser.
**Status:** Graphviz 16.1.0 (2026-09-04, GitLab), EPL-1.0. `@viz-js/viz` 3.31.0 (2026-09-28), MIT, 4.9 MB unpacked
(WASM inlined). `@hpcc-js/wasm-graphviz` 1.30.0 (2026-10-21), Apache-2.0, 2.0 MB.

**Relevant mechanics**
- Syntax: `digraph G { rankdir=LR; api -> db [label="orders"]; }`. Attributes everywhere, no variables, no imports.
- Parser: Bison/yacc in C. Errors: "syntax error in line N near 'x'", one per run. viz-js 3 returns
  `{status: 'failure', errors: [{level, message}]}` instead of throwing.
- Browser editors (GraphvizOnline, edotor.net) put the DOT in the URL hash *(unverified: encoding details)*.

**Borrow**
- Structured error objects from the render call, not exceptions.

**Avoid**
- Mixing style and layout attributes into the model statements.

## 15. Excalidraw and tldraw (canvas-first)

**What:** whiteboard editors where the drawing is the source; text diagrams come in only by conversion.
**Status:** `@excalidraw/excalidraw` 0.18.1 (2026-04-20), MIT, about 135k stars, 45 MB unpacked.
`@excalidraw/mermaid-to-excalidraw` 3.1.0 (2026-10-27). `tldraw` 5.6.0 (2026-10-28), own license: production use
needs a license key.

**Relevant mechanics**
- The scene is JSON of shapes with positions. Share links encrypt the scene in the browser and keep the key in the
  URL hash, so the server never sees it.
- mermaid-to-excalidraw v3 parses and lays out with Pele (`pele` 1.13.0, MIT, Obsidian's Mermaid renderer, created
  2026-10) instead of rendering Mermaid in the DOM. Flowcharts become shapes; other types become images. One way only.
  An XSS advisory (0.18.0) came through Mermaid sequence labels rendered with KaTeX.

**Borrow**
- Key in the hash, never sent to a server, if we ever store shares server-side.
- Export to Excalidraw JSON as a one-way "hand-edit this" door.

**Avoid**
- Canvas as the source of truth: positions win over meaning, and a live capacity model cannot be diffed or reviewed.
- tldraw's license for an MIT library.

## 16. Ilograph

**What:** a commercial diagram tool where a YAML file defines resources once and "perspectives" show them.
**Status:** proprietary web and desktop app; no public versions *(unverified)*.

**Relevant mechanics**
- Syntax is YAML.
  ```
  resources:
    - { name: Shop, children: [ { name: API }, { name: Orders DB } ] }
  perspectives:
    - { name: Writes, relations: [ { from: API, to: Orders DB, label: writes } ] }
  ```
- Resources are a tree defined once; each perspective lists relations (or a sequence) and can override parents.
- Layout is automatic and per perspective; the viewer is interactive (walkthroughs, context).

**Borrow**
- Facts once, relations per perspective: the same split as Structurizr and LikeC4, with fewer keywords.

**Avoid**
- YAML for formulas: quoting, indentation errors and no expression syntax.

## 17. Eraser diagram-as-code

**What:** a commercial whiteboard with a small DSL for cloud, ER, sequence, flow and BPMN diagrams.
**Status:** proprietary SaaS (eraser.io); no public versions.

**Relevant mechanics**
- Syntax: nodes with bracketed properties, nested groups, arrow connections.
  ```
  VPC {
    API [icon: aws-ec2]
    Orders DB [icon: aws-rds, color: blue]
  }
  API > Orders DB: writes
  ```
- Node and group names must be unique; properties are `icon`, `color`, `label`. Its AI makes "freeform" diagrams
  unless the team format is set to code.

**Borrow**
- Bracketed properties after a name: short and readable for optional attributes.

**Avoid**
- Names with spaces as identifiers; renames and references get fragile.

## 18. Penrose

**What:** a research system (CMU) that splits a diagram into Domain, Substance and Style programs and lays out by
numerical optimization.
**Status:** `@penrose/core` 3.3.1 (2026-08-30), MIT, about 8k stars, active.

**Relevant mechanics**
- Domain declares types and predicates; Substance names objects and relations (`Set A, B`); Style maps them to
  shapes with constraints and objectives solved by gradient descent.
- Layout is slow and varies with a seed (a "variation" string).

**Borrow**
- A three-way split: what kinds exist (spec), what is true (model), how it looks (view). Users mostly write the
  middle one.

**Avoid**
- Optimization-based layout for a live preview.

## 19. Building blocks: CodeMirror 6 vs Monaco

**What:** the two browser code editors that diagram playgrounds use.
**Status:** `@codemirror/view` 6.43.15 (2026-10-19), `state` 6.7.6, `language` 6.13.1, `lint` 6.9.7, `autocomplete`
6.20.4, `codemirror` 6.0.2; MIT. Its GitHub repos were archived in 2026-04 and moved to code.haverbeke.berlin; npm
releases continue. `@uiw/react-codemirror` 4.25.12. `monaco-editor` 0.57.0 (2026-09-24), MIT, 99 MB unpacked;
`@monaco-editor/react` 4.7.0 (2025-02-13).

**Relevant mechanics**
- Sizes (esbuild, minified / gzip -9, measured 2026-10-31): CodeMirror `basicSetup` + lint + autocomplete 378 / 122 KB;
  a minimal set (view, state, `StreamLanguage`, lint) 280 / 90 KB. Monaco `editor.api` alone 2.6 MB / 684 KB; the full
  ESM entry 4.4 MB / 1.16 MB; plus a 300 / 92 KB editor worker that the bundler must wire up.
- CodeMirror lint: `linter(source, {delay})` calls our function after edits; diagnostics are `{from, to, severity,
  message, actions}`; `lintGutter()` and a panel (Ctrl/Cmd-Shift-M). Autocomplete: a `CompletionSource` returns
  `{from, options}`. Highlighting: `StreamLanguage` (a line tokenizer, enough for keywords and numbers) or a Lezer
  grammar (incremental tree, enables folding and syntax-aware completion).
- Monaco: markers via `setModelMarkers`, Monarch or TextMate tokenizers, LSP via `monaco-languageclient`. Not
  supported on mobile; mermaid.live switches to CodeMirror on phones.

**Borrow**
- CodeMirror with `StreamLanguage` first, our own linter source fed by our parser's diagnostics.

**Avoid**
- Monaco for an embeddable library: ten times the size, workers, no mobile.

## 20. Building blocks: parser toolkits

**What:** ways to turn the text into a model with good errors.
**Status:** sizes are esbuild minified / gzip of the runtime, measured 2026-10-31.
- Langium 4.4.0 (2026-09-09), MIT: 375 / 98 KB with Chevrotain.
- Chevrotain 13.2.0 (2026-08-01), Apache-2.0: 105 / 28 KB.
- Ohm 17.5.0 (2026-02-14), MIT: 92 / 24 KB.
- Peggy 5.1.1 (2026-10-20), MIT: generator 155 / 44 KB; the generated parser needs no runtime.
- Lezer: `@lezer/lr` 1.4.12 (2026-10-30) runtime 45 / 14 KB, `@lezer/generator` 1.8.1; MIT; GitHub repos archived
  2026-04, moved with CodeMirror. Jison 0.4.18 (2017-09-01): unmaintained.

**Relevant mechanics**
- Langium: grammar file to typed AST plus a full LSP (linking, scoping, completion, validation). Usable as a bare
  parser (Mermaid does). Recovery from Chevrotain. Heavy for a single small DSL; strong if a VS Code extension matters.
- Chevrotain: grammar written as TS code, no build step. Fault tolerant: single-token insertion and deletion,
  re-sync, many errors, partial tree.
- Ohm: PEG grammar with semantics kept apart; good "expected ..." messages; incremental; stops at the first error.
- Peggy: PEG to JS at build time; one error with location and the expected set; no recovery unless hand-built.
- Lezer: made for editors; always returns a tree with error nodes; incremental. Good for highlighting, not for
  user-facing semantic errors.
- Hand-written recursive descent with a Pratt loop for expressions: no dependency, full control of messages,
  recovery at line or block boundaries, positions exactly as the editor wants them. D2 works this way.

**Borrow**
- Hand-written for a small, line-oriented language; Chevrotain if the grammar grows; Langium only for an LSP.

**Avoid**
- Jison (Mermaid is leaving it). Two grammars for one language (one for the editor, one for the model).

## 21. Building blocks: safe expression evaluators

**What:** libraries to evaluate formulas such as `rps * ordersPerUser` from shared text.
**Status:** versions from npm, sizes esbuild min / gzip, advisories from the GitHub advisory database (2026-10-31).
- `expr-eval` 2.0.2 (2019-09-28): unmaintained; CVE-2025-12735 (high, functions passed to evaluate), CVE-2025-13204
  (high, prototype pollution), CVE-2026-12866 (critical, code execution); no patched version.
- `expr-eval-fork` 3.0.3 (2026-02-02): 26 / 8 KB; patched the 2025 CVEs; `toJSFunction` uses `new Function`.
- `filtrex` 3.1.0 (2024-10-14): 25 / 7 KB; compiles to JS with `new Function` (CSP `unsafe-eval`).
- `jsep` 1.6.0 (2026-10-11): 10 / 3 KB; parser only, plug-ins; no evaluator.
- `mathjs` 15.2.0 (2026-04-07), Apache-2.0: 368 / 107 KB (`mathjs/number`) to 645 / 185 KB; two high CVEs fixed in
  15.2.0 (2026-04), older RCEs in 2017.
- `@marcbachmann/cel-js` 8.0.0 (2026-07-07): 80 / 23 KB; Google CEL (typed, not Turing complete), parse-time limits
  (`maxAstNodes`, `maxDepth`, ...), no eval. The other `cel-js` (ChromeGG) is archived.
- `jexl` 2.3.0 (2020-09-15): 19 / 5 KB; tree-walking, but unmaintained. `expression-eval` 5.0.1: deprecated.
- `subscript` 10.8.1 (2026-09-25), ISC: 8 / 3 KB; modular parser plus evaluator, no eval.

**Relevant mechanics**
- Safe means: parse to an AST, walk it, resolve identifiers only from a declared table, no member access to objects,
  no `new Function`, limits on length and depth. Most CVEs above come from member access or caller-supplied functions.

**Borrow**
- Our own Pratt parser and tree-walker for `+ - * / ^`, comparisons, `? :`, a fixed function list (`min`, `max`,
  `ceil`, `floor`, `round`, `clamp`), units later. About 200 lines; errors in the same format as the DSL.
- If a library: jsep for parsing (3 KB) with our evaluator, or cel-js for its limits model.

**Avoid**
- expr-eval in any form, filtrex (`new Function`), mathjs (size, CVE history) for text that arrives in a URL.

## 22. Building blocks: URL compression

**What:** putting the source in a link.
**Status:** `CompressionStream` is Baseline widely available since May 2023 (`gzip`, `deflate`, `deflate-raw`; MDN now
also lists `brotli` and `zstd`, not yet baseline). `pako` 3.0.3 (2026-10-26), (MIT AND Zlib): `deflateRaw` +
`inflateRaw` 41 / 12 KB. `fflate` 0.8.3: 7 / 4 KB. `lz-string` 1.5.0 (2023-03-04): 5 / 1 KB.

**Relevant mechanics**
- Who does what: mermaid.live `#pako:` + base64url(zlib deflate of a JSON state); D2 `?script=` + base64url(raw
  deflate) with a 16 MB decode cap; PlantUML deflate with its own base64 alphabet in the path; TypeScript playground
  `#code/` + `LZString.compressToEncodedURIComponent`, compiler flags as query parameters; LikeC4 a server id.
- Measured on a 762-character loadmap-like model: plain base64url 1,016 characters; lz-string 696; deflate-raw +
  base64url 530. On the same text doubled (1,524): lz-string 1,143, deflate-raw 544. The zlib wrapper adds about 8.
- Hash vs query: the hash never reaches the server (no logs, no size limit there); a query lets a server render
  previews (mermaid.ink). Chat apps and some proxies cut long URLs; a few KB is safe. `CompressionStream` is async.

**Borrow**
- `#` + a version tag + base64url(deflate-raw(UTF-8 text)) with `CompressionStream`; no dependency.
- A decode cap and a version tag from day one.

**Avoid**
- lz-string (larger output, its own format), a custom alphabet, JSON state blobs instead of the text itself.

## 23. Formula and model tools (briefly)

**What:** tools that compute numbers from named parameters, the part of loadmap that is a spreadsheet.
**Status:** `@observablehq/runtime` 6.1.0 (2026-10-23), ISC. Guesstimate (MIT, repo active 2026-10). Squiggle
(`@quri/squiggle-lang` 0.10.0, 2024-12-07, MIT). Causal: commercial, acquired by Lucanet in 2024 *(unverified)*.

**Relevant mechanics**
- Observable: named cells form a dependency graph; a change recomputes only what depends on it.
- Guesstimate and Squiggle: values can be ranges (`5 to 10`) evaluated by Monte Carlo; Squiggle is a text language.
- Causal: formulas over named variables in plain words, with time series and scenarios.

**Borrow**
- Named parameters referenced by name, a dependency graph, and "what feeds this number" in the UI.
- Ranges as a later extension for estimates (a capacity of `estimated(800 to 1000)`).

**Avoid**
- Cell references (`A1`); a full programming language.

## Synthesis for the diagram editor

1. **Syntax family.** Line-oriented and keyword-first, with braces for nesting and `->` for flows: the shape Mermaid,
   D2, Structurizr and LikeC4 converge on. One statement per line, `#` comments. Line 1 carries a version
   (`loadmap 1`): shared links live forever and Mermaid shows what happens without one.
2. **Model/view split.** Structurizr, LikeC4, Ilograph and Penrose keep separate blocks for the model and its views,
   because one model has many views. A loadmap model has one view, so the text is box-centric instead: a box holds
   the stage it runs and the component it owns, and a click on a node maps to one block. The compiler still emits a
   separate model and view, and a view never adds a number.
3. **Parser.** Hand-written recursive descent in its own package, `@loadmap/dsl` (core stays small for TS users), with a Pratt loop for formulas: no dependency, no
   DOM, runs in Node tests. It returns a model plus all diagnostics (`from`, `to`, line, column, message, hint) and
   recovers at the next line or block. A second pass checks names, cycles, units and provenance. Langium only if a VS
   Code extension becomes a goal.
4. **Expressions.** Our own small language, parsed to an AST and walked; identifiers resolve only to declared
   names; a fixed function list; member access only on the fixed tables (`flows.`, `demand.`, `util.`, `derived.`),
   every name checked; no `eval`, no `new Function` (CSP-safe). Caps on
   text length, AST depth and node count. Not expr-eval (three CVEs, one critical, unpatched), not filtrex, not mathjs.
5. **Provenance in the grammar.** A capacity can only be written as `measured(...)`, `estimated(...)` or a fit; the
   parser rejects a bare number there, so the verdict's assumption list comes straight from the text.
6. **Editor.** CodeMirror 6 with a `StreamLanguage` highlighter, a linter fed by our diagnostics and completion from
   the model's names: about 90 to 120 KB gzip, works on phones. Not Monaco (0.7 to 1.2 MB gzip, workers, no mobile;
   mermaid.live already falls back to CodeMirror there). Parse on a short debounce (~150 ms); keep the last good
   model on screen while the text has errors; show the error list without a long delay, inline marks at once.
7. **URL format.** `#v1.` + base64url(deflate-raw(UTF-8 source)) with `CompressionStream`; the source only, no UI
   state blob. Slider and switch positions go in separate short parameters (`&load=30`), so one model can be shared at
   different settings and old links survive UI changes. Cap the decoded size. Hash, not query: the model never reaches
   a server. Deflate-raw is about a quarter shorter than lz-string on our sample and half of plain base64.
8. **Text is the single source of truth.** Positions are not stored; ELK lays out as today. Any canvas action (change
   direction, hide a flow, set a group) becomes a minimal text edit, as LikeC4 does. Excalidraw JSON can be a one-way
   export later, never an input.
9. **Shared text is untrusted.** Labels render as plain text (no HTML, Markdown or CSS from the source), loops and
   counts are bounded, imports and scripts do not exist. Most Mermaid and Excalidraw advisories came from these paths.
10. **Export.** Reuse `@loadmap/export` (PNG, GIF, WebM/MP4) and `loadmap record`; add the `.loadmap` text and the
    share link; embed the source in PNG metadata as PlantUML does, so an image can be reopened.
