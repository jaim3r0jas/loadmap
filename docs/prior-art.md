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
