# @loadmap/react

## 0.47.0

### Minor Changes

- 253c67e: Failures that are not about capacity: `fails: 2%` on a component is the share of the units its stages work on that
  fail there whatever the load, a bug, a dependency that errors or a bad deploy. A failed unit is a new loss, `failed`:
  a lost box takes it (`lost { takes: [failed] }`, and a box without `takes` takes it too), its dot goes there, the
  flow's retries send it again, it counts toward the share that opens a breaker, a fallback serves it, and
  `expect { lost }` holds it. The stages after the one that failed it are reached by the rest, in `at` too. It reads
  the load and the parameters, so a scenario can be the bad deploy. A component that fails with no lost box for it warns
  (`unseen-loss`), with the quick fix that adds the box. In TypeScript: `fails: 0.02` on the component;
  `ev.stages.<id>.fails` is the share at the values. From `loadmap 1.8`.

  Docs: /language/building-blocks/#lost-units
- 4613370: What a design costs. `cost: running * 140` on a box is what it costs a month, where `running` is the pods its pool runs
  at this load (an autoscaled pool costs what it runs), the members left across a domain, or 1; `currency: "€"` says what
  it is counted in. `ev.cost` gives the total and each component's, `compare()` puts the total in each scenario's row and
  says what the headroom costs ("…, for 2,300 € a month more"), the scenarios table has a "Cost a month" column with the
  change from the first, and `expect { cost: 5_000; underTarget: 3× }` holds a budget. In TypeScript, `currency` on the
  model and `cost: ({ running }) => running * 140` on a component. From `loadmap 1.8`.

  Docs: /language/scenarios/
- 8b007aa: A fan-out branch that goes on: `orders -> mailQueue -> mailers -> smtp: 1` copies each order into a queue, to the
  workers that read it and on to what they call, where a branch was one stage. The copies reach every stage of the
  branch (`at.mailers.orders`), each stage runs its component and is ranked like any other, a queue on the branch fills
  when its reader is full, the dots go the whole way, and an edge joins each pair of boxes along it. A branch goes
  through queues, pools and `pass`, `cache`, `limit`, `store` and `sink` stages; it takes no split and no second
  fan-out, and it never comes back to the route. This is how the asynchronous side of a system is written: email, search
  indexing, a replica that follows a log. In TypeScript a branch is `{ stages: ['mailQueue', 'mailers', 'smtp'], share:
  1 }`, and a resolved branch carries its `stages`. From `loadmap 1.8`.

  Docs: /language/building-blocks/#fan-out-and-sinks
- 65f637c: A gather: one unit makes several calls at once and goes on when enough of them have answered. `gather { reads ->
  shards: 8; needs: 6 }` is a read from every shard, a quorum write, a page built from many services. The stage it calls
  sees every call (8 a read) and is ranked on that; the unit waits for the slowest call it needs, which is in its
  latency (the 6th of 8 answers, from the calls' mean time); and it fails when too few answer, a loss at the gather
  that a lost box takes and `expect { lost }` holds (a stage failing 1 % of its calls fails 7.7 % of the units that need
  all 8). A call is a copy on a branch, so the line takes what a fan-out's does, a branch that goes on included. Unlike
  a fan-out it does not end the route. In TypeScript, `gather({ to: [{ stage: 'shards', share: 8 }], needs: 6 })`. From
  `loadmap 1.8`.

  Docs: /language/building-blocks/#gathers
- 59e9179: Uneven work, said as a share. `limit { keys: 400; skew: estimated(20%, "share", "the noisiest tenant") }` is a limit for
  each key: the capacity is one key's, it runs out when the hottest key does, and it turns away only what is above each
  key's own limit; the limits list says "400 keys, each its own limit: the hottest carries 20 % of what arrives"
  (`ev.components.<limit>.keys`). `busiest: estimated(32%, "share", "ring stats")` on a connection says how much its
  busiest member takes, whatever deals the work: the stage runs out when that member does. A ± on either share moves the
  crossings. In TypeScript, `limit(c, { keys, skew })` and `busiest` on a connection. From `loadmap 1.8`.

  Docs: /language/building-blocks/#rate-limits
- 47d5230: A rate limit's bucket and a quota per minute. `limit { burst: 500 }` lets everything through past the limit until the
  bucket is spent, its size over what arrives above the limit a second, then cuts to the limit. No steady figure
  changes; `ev.components.<limit>.burst` gives `{ size, passes, lasts }`, and the limits list says "A burst of 500 passes: at 3×
  all gets through for 2.5 s, then it is cut to 100 req/s". A quota counts a window of a minute too (`per: minute`),
  read at the peak as an hour is. In TypeScript, `limit(c, { burst: 500 })` and `limit(c, { per: 'minute' })`. From
  `loadmap 1.8`.

  Docs: /language/building-blocks/#rate-limits
- 3d5a64f: The board plays a moment's way up. Pressing a preset's mark on the load bar, for a preset with a ramp, cold caches or
  pods that take time to be ready, walks its moment at the sim's speed: the load climbs, the pods the autoscaler wants are
  drawn dashed until they are ready, a cold cache warms, then the preset holds. Any other change stops it. The walk and
  its playing load only when such a preset is pressed. Each step of `moment()` carries what it set beside the load
  (`set`), for a host that plays it its own way.

  Docs: /language/controls/#presets
- a1b9a99: A moment's way up walks more of what a peak meets. `cold: [appCache]` on a preset starts its moment with those caches
  cold, and `warms: 5min` on a cache is how long it takes from no hits to its `hit` ("8× at once: up to 62 % of reads is
  lost for 3 min, while the cache warms"). A limit's `burst` is spent on the way, and filled again below the limit ("6× at
  once: nothing is lost for 2.5 s, until the burst of the rate limiter is spent, then 67 % of searches as it holds"). A
  queue with a size takes everything in until it is full ("nothing is lost for 50 s, until the inbox is full"). Each step
  of `moment()` says each cache's warmth, each bucket's units and each queue's backlog. In TypeScript, `colds` beside
  `ramps` and `warms` on `cache()`. From `loadmap 1.8`.

  Docs: /language/controls/#presets
- 9c0e192: A moment's way up. `ramp: 30s` on a preset is how long the load takes to climb from the default to the preset's, and
  `ready: 90s` on an autoscaler is how long after a pod is wanted it takes work. No steady figure changes. While the
  preset is shown, the verdict says what is lost on the way: "8× in 30 s: up to 75 % of requests is lost for 100 s,
  until the eighth pod of the API is ready." `moment(model, values, preset)` from `@loadmap/core/moments` walks a fixed
  number of steps over the ramp and the moment's length and gives each flow's lost units, share and span; the page loads
  it only while such a preset is shown. In TypeScript, `ramps` beside `peaks` and `ready` in the `autoscale`. From
  `loadmap 1.8`.

  Docs: /language/controls/#presets
- 1aac4d6: A queue with a size: `holds: 10_000` on a queue makes it a bounded queue, a buffer, a mailbox. Once its reader is past
  full the queue fills, and what the reader cannot take is turned away: `rejected` at the queue, so a retry sends it
  again, a lost box counts it and `expect { lost }` sees it. `full: block` turns the unit away at the stage before the
  queue instead. With a drop rule the queue takes in `holds` ÷ `olderThan` a second: what arrives above that finds it
  full, and what it took in and its reader cannot take gets too old. A queue with a size and no lost box for what it turns away has a warning.
  For a moment that `lasts`, the verdict says when the queue is full, and the board keeps no more waiting than it holds.
  In TypeScript, `queue({ partitions, holds, whenFull })`, and `backlog()` gives `full: { holds, after }`. From
  `loadmap 1.8`.

  Docs: /language/building-blocks/#queues
- 785b621: The board draws a region that is out: the boxes of a named part of a domain that is down (`down: eu`) are dashed,
  their pods and members idle as members out are, and no box moves. The Two regions example is written so: each region a
  subsystem `in` its part, two flows and a router whose split deals again, in place of a switch and a second flow for
  each region.

  Docs: /language/building-blocks/#failure-domains
- c0ac379: Retries at a hop: `retry { at: payments; times: 2 }` is the caller of payments calling again. What fails at that stage
  or after it is sent again from there, so only the stages from it on see those attempts. A flow takes one rule without
  `at` (its client's, as before) and one for each stage, and retries inside retries multiply: the attempts a stage sees
  are the product of every rule around it, and an attempt fails only when every attempt inside it does. The rules are
  solved together, the hops inside the client's. `ev.retry.<flow>.hops` gives each hop's attempts a unit, its failing
  share and what fails every attempt there; the Live panel shows the attempts at each hop; a dot sent again at a hop
  starts there. In TypeScript `retry` takes a list: `[{ times: 1 }, { at: 'payments', times: 2 }]`. A timeout stays the
  client's. From `loadmap 1.8`.

  Docs: /language/building-blocks/#retries

### Patch Changes

- Updated dependencies [3c5c29f]
- Updated dependencies [1604406]
- Updated dependencies [253c67e]
- Updated dependencies [4613370]
- Updated dependencies [2c8ee75]
- Updated dependencies [3b4c2d3]
- Updated dependencies [0d5900f]
- Updated dependencies [8b007aa]
- Updated dependencies [7dca4d6]
- Updated dependencies [65f637c]
- Updated dependencies [7068652]
- Updated dependencies [59e9179]
- Updated dependencies [47d5230]
- Updated dependencies [3d5a64f]
- Updated dependencies [a1b9a99]
- Updated dependencies [9c0e192]
- Updated dependencies [732644f]
- Updated dependencies [1aac4d6]
- Updated dependencies [4f3a2e4]
- Updated dependencies [c0ac379]
  - @loadmap/core@0.47.0
  - @loadmap/dsl@0.47.0
  - @loadmap/sim@0.47.0
  - @loadmap/layout@0.47.0

## 0.46.0

### Minor Changes

- b547540: A batch: `runs { every: 1d; within: 4h }` on a component (language 1.7; `runs: { every, within }` in TypeScript).
  What reaches it in `every` is worked off `within`, so its demand is the rate a run needs, and it runs out where a run
  misses its window, at a load multiple. Every a day or more reads each flow at its average. The limits list says how
  long a run takes of its time (`ev.components.<id>.runs.takes`).

  Docs: /language/building-blocks/#batches
- f9b0d92: In the editor, a box or an edge added to the text moves its neighbours and not the whole diagram: what is drawn next
  is laid out from where the boxes are drawn, and **View → Tidy the diagram** (`tidy()` on the editor's handle) lays it
  out as a reload draws it. `layout()` and `<Loadmap>` take the drawn scene as `from` for it. A page, a reload, a
  recording and an export draw the layout from scratch, as before; so does a diagram with subsystems or folded into
  rows. A scene says the `rows` it was folded into.

  Docs: /api/react/#hold
- aaa4f91: A new version of a model keeps more of what is drawn. The story step shown stays when the text is edited (or another
  `model` is handed to `<Loadmap>`), as the new version writes it: its values, and what it closes, change as the step is
  edited, and only a story that no longer has the step leaves it; a story that is playing still stops. A version whose
  boxes and edges take the same room is not laid out again: ELK's result is kept by the frame, not by the compiled view.
  The editor's handle has `changeFiles(files)`, which changes the definition's files as an edit (one undo step per file),
  where `setFiles` starts a new definition from its defaults. In the editor, a change that reaches only a file that is
  not open (a restore, an accepted proposal, a rename) is drawn at once, not with the next key.

  Docs: /api/react/#useloadmap-and-the-controller
- f89851d: N−1 in the answers: with every part of a failure domain up, `outages(model, values)` (`@loadmap/core/outages`, an
  entry of its own) ranks again with one part out. The page says it under the verdict ("With one availability zone out, the 50 % target holds up to
  8.3×, limited by the search API, which keeps 5 of 8."), each limit gives its own figure with a part out when that
  comes sooner, and the headroom chart draws the shown line with one part out, dashed (`HeadroomLine.outage`). The
  search example expects 8× with a zone out.

  Docs: /language/building-blocks/#failure-domains
- a993b1b: A preset can say how long its moment lasts: `preset "Black Friday" { load: 12; lasts: 2h }` (language 1.7; `peaks` in
  TypeScript). While its values are shown, the verdict says what that long leaves in each queue whose reader cannot keep
  up, and how long the reader then needs to clear it at the default load: "After 2 h of Black Friday, 1.4M events wait
  in the events topic, which at 1× clears in 5 h." `backlog(model, values, seconds)` (from `@loadmap/core/backlog`) gives it, by the sim's own rules (a
  reader drains at its component's full, priority 1 first, a drop or a merge leaves less), and the sim builds the same.

  Docs: /language/controls/#presets
- 9222ee2: A quota over a window: `limit { per: day }` (or `hour`, `month`; language 1.7; `limit('plan', { per: 'day' })` in
  TypeScript). Its capacity is what the window allows, `configured(5_000_000, "requests/day", …)`, and its demand what
  reaches it in one window, at the peak for an hour and at each flow's average for a day or a month. It runs out at a
  load multiple like any rate, and past it the limits list says how far into the window it is gone. A quota whose
  capacity is written per second warns.

  Docs: /language/building-blocks/#rate-limits
- 66323a1: A scaling curve: `fit apiScale { curve: usl; points n rate { … } }` (language 1.7; `fitScaling` from
  `@loadmap/core/scaling`) fits the Universal Scalability Law to sizes and the capacity
  measured at each: contention and coherency, so twice the pods give less than twice the capacity and past a peak less.
  Call it like a fit, `measured(apiScale(pods), "req/s", …)`. The assumptions list it with its peak, in the page and in
  `loadmap check`, and a parameter it reads that reaches past the peak warns (`past-peak`). It never applies to a
  published figure.

  Docs: /language/controls/#fitted-costs
- 0aef603: Stocks: a component that fills over time, not at a load. `fills` is what it gains a second (a disk, a topic's
  retention, a database's size), read with every flow at its new `average`, its rate over a day against its peak. With
  `keeps: 7d` it holds what it gains that long and settles at fills × keeps; with `level: measured(120, "GB", …)` it
  stands there on growth's `asOf` and grows as the load does, so it is ranked at the load multiple whose day it is full,
  with that date. Without growth such a stock is not ranked, and the verdict says why. `expect { lasts: 365d }` holds a
  time through the growth. The limits list says what a stock gains a day and how long it has left at that rate
  (`ev.components.<id>.stock`), and the editor has a starter, "Disk that fills up". All new in language 1.7.

  Docs: /language/building-blocks/#stocks
- 3f8470d: Failure domains: `domain zone "Availability zone" { count: 3 }`, `across: zone` on a pool, a cluster or a node, and
  `down: zone` in a scenario, a step, a preset or an expect (language 1.7; `domains` and `across: { domain, members }`
  in TypeScript). The model gets an Outage control, `down`. With one part out, a box's members in the fullest part are
  out: its utilization is its own times members ÷ members left, a connection deals its parts over the members left,
  and the members out are drawn as idle pods are. A published figure is then left without a benchmark, never scaled
  (`ev.components.<id>.out`: `members`, `left`).

  Docs: /language/building-blocks/#failure-domains

### Patch Changes

- c5a8b15: The dots keep running across an edit that leaves every flow, stage and route as it was (a figure, a name, a box's
  look): the backlog, the busy workers and every dot stay, and the new figures apply as new values do. `Sim` has
  `adopt(model, ev)` for it, false for a model that is another structure; such a model still starts its sim over.

  Docs: /api/react/#useloadmap-and-the-controller
- Updated dependencies [b547540]
- Updated dependencies [37f77bd]
- Updated dependencies [27c2c2f]
- Updated dependencies [c5a8b15]
- Updated dependencies [00a1e85]
- Updated dependencies [f9b0d92]
- Updated dependencies [aaa4f91]
- Updated dependencies [f89851d]
- Updated dependencies [df7d710]
- Updated dependencies [a993b1b]
- Updated dependencies [9222ee2]
- Updated dependencies [66323a1]
- Updated dependencies [56e90eb]
- Updated dependencies [a4b725f]
- Updated dependencies [0aef603]
- Updated dependencies [3f8470d]
  - @loadmap/core@0.46.0
  - @loadmap/dsl@0.46.0
  - @loadmap/sim@0.46.0
  - @loadmap/layout@0.46.0

## 0.45.0

### Patch Changes

- Updated dependencies [03f7595]
  - @loadmap/dsl@0.45.0
  - @loadmap/core@0.45.0
  - @loadmap/layout@0.45.0
  - @loadmap/sim@0.45.0

## 0.44.0

### Patch Changes

- @loadmap/core@0.44.0
  - @loadmap/dsl@0.44.0
  - @loadmap/layout@0.44.0
  - @loadmap/sim@0.44.0

## 0.43.0

### Patch Changes

- Updated dependencies [7b3620b]
- Updated dependencies [82dc3ee]
- Updated dependencies [2dfac4c]
- Updated dependencies [2fb0cda]
- Updated dependencies [c50c688]
  - @loadmap/dsl@0.43.0
  - @loadmap/core@0.43.0
  - @loadmap/layout@0.43.0
  - @loadmap/sim@0.43.0

## 0.42.1

### Patch Changes

- 34d855c: A subsystem the reader opened or closed stays so when a new version of the model is drawn (the text edited, another
  `view` handed to `<Loadmap>`): only its own control closes or opens it, and a page's `closed` still says how each one
  starts. In the editor, a click on a box that another file declares opens that file and no longer draws the diagram
  anew: the subsystem stays open, no box moves, the view and the selection stay.
- @loadmap/core@0.42.1
  - @loadmap/dsl@0.42.1
  - @loadmap/layout@0.42.1
  - @loadmap/sim@0.42.1

## 0.42.0

### Patch Changes

- Updated dependencies [69133ee]
- Updated dependencies [d6c4316]
  - @loadmap/dsl@0.42.0
  - @loadmap/core@0.42.0
  - @loadmap/layout@0.42.0
  - @loadmap/sim@0.42.0

## 0.41.0

### Minor Changes

- 24b0fbe: `<Diagram canvas>` takes `reserve`: the part of its insets that is always there. The diagram is arranged for what
  `reserve` leaves, so the rest of the insets (a panel the reader opens over the board) moves the view and never the
  layout. Without it a canvas is arranged for what Fit has, as before.

  Docs: /api/react/#the-pieces
- ef6ebc7: `<Diagram canvas>` takes `scrolls: true` for a canvas that lies in a page that scrolls: the wheel zooms only with
  Ctrl or ⌘ held, one finger scrolls the page, and two fingers pan and pinch the board. Without it a canvas takes the
  wheel and one finger for itself, as before.

  Docs: /api/react/#the-pieces
- b29a957: **The editor's diagram is the canvas every loadmap is.** With `fill`, the diagram beside the code is `<Loadmap fill>`:
  the scenarios in a bar over it, the load and the verdict in one line under it, and the limits, the design, the
  headroom, the live meters and the assumptions in panels that open one at a time from their tabs (a rail, a row over
  the console, or a panel kept open from 1280 px of canvas). The editor's own side panel is gone, with its rail, its pin,
  its resize and its hover, and so is the phone's sheet with its three heights: on a phone a tab opens its panel as a
  sheet on the console. While the code is hidden the inspector is the first tab, **Inspect**: a click on a box opens it,
  once for each box, and it no longer shows before a box is picked unless the canvas keeps a panel open. The note that
  the diagram is the last version without errors lies over the canvas, under its bar.

  Removed from `<LoadmapEditor>`: `panel`, `onPanel`, `panelWidth`, `onPanelWidth` and the type `PanelMode`; a page that
  passes them no longer compiles, and has nothing to keep in their place. The classes `.lme-canvas`, `.lme-panel`,
  `.lme-sheet`, `.lme-over` and `.lme-sec` are gone: the canvas's own are `.lm-canvas` and the rest (Styling). The dot
  grid's `data-grid="off"` is on `.lme-preview`.

  `<Loadmap>` takes `children`: each `Canvas.Panel` among them is a panel of the page's own, its tab before the
  loadmap's, and anything else is drawn over the canvas. `open` and `defaultOpen` take such a panel's id.

  Docs: /using-the-editor/#the-canvas-and-the-panels
- b29a957: **`<Loadmap>` is one canvas.** Everything it draws is in one box whose height the page gives (`.lm-canvas`, by
  default `clamp(420px, 70dvh, 760px)`): the title, the scenarios and the story's button in a bar over the diagram, the
  load and the verdict in one line under it, and the limits, the design, the headroom, the live meters and the
  assumptions in panels that open one at a time from their tabs. The canvas arranges itself by its own size (tabs as a
  rail, a row or a menu; the panel beside the diagram, or a sheet under 520 px), the diagram always pans and zooms, and
  nothing the reader does lays it out again or changes the box's height. Full screen is the same canvas at the
  screen's size, with one panel kept open from 1280 px.

  What changes for a page:
  - `<Loadmap>` no longer grows with its panels: it has a fixed height. Set `.lm-canvas { height: … }`, or `fill`.
  - `panels`, `open`, `defaultOpen` and `onOpen` choose and drive the panels; `chrome="least"` opens full screen (and
    a root that fills) with the diagram, the load and the verdict alone. `fullScreen` and `fullScreenMode` still work
    and say in the console that they are `panels` and `chrome` now; `zoom` is no longer needed.
    `fullScreen` used to shape full screen only: its list now says which tabs the page offers too (`[]`: none).
    `scrolls` gives the wheel and one finger back to a page that scrolls around a root that fills its frame.
  - `LOADMAP_PANELS` is the five tabs: `limits` (with the verdict's sentence), `controls`, `headroom` (with the
    scenarios compared), `live`, `assumptions`.
  - Gone from `<Loadmap>`: the dock of compact cards and the drawer of full screen, focus mode's layout, and the
    classes of the old page (`.lm-loadbar`, `.lm-side`, `.lm-panel`, `[data-out]`, `.lm-line`, `.lm-dock`, `.lm-mini`,
    `.lm-drawer`). A page that wants every panel on the page at once composes it from the parts, as before:
    `useLoadmap`, `LoadmapRoot`, `LoadBar`, `Story`, `Diagram` and the panels.
  - New for a layout of your own: `Canvas` with `Canvas.Bar`, `Canvas.Console` and `Canvas.Panel`, `useCanvasSize`,
    `useCanvasPanels`.
  - A `.loadmap` file's `fullScreen` and `fullScreenMode` keep their meaning: the panels a page offers, and what stands
    around the diagram in full screen.
  - `loadmap record` draws the board as before: its recordings do not change. A recording made from a page that draws
    `<Loadmap>` takes the canvas's room, so its size can differ from one made before.

  Docs: /api/react/#the-canvas

### Patch Changes

- ce9f9f1: A page's plain `.lm-canvas { height: … }` sets the canvas's height wherever its stylesheet stands: the default
  height has no weight of its own. `LOADMAP_CSS` holds the canvas's styles too, so a page that puts it in its `<head>`
  for server rendering, or in a shadow root, has the canvas styled from the first paint.
- @loadmap/core@0.41.0
  - @loadmap/dsl@0.41.0
  - @loadmap/layout@0.41.0
  - @loadmap/sim@0.41.0

## 0.40.0

### Patch Changes

- Updated dependencies [3531ca3]
- Updated dependencies [2189dae]
  - @loadmap/dsl@0.40.0
  - @loadmap/core@0.40.0
  - @loadmap/layout@0.40.0
  - @loadmap/sim@0.40.0

## 0.39.0

### Patch Changes

- Updated dependencies [52c0325]
  - @loadmap/dsl@0.39.0
  - @loadmap/core@0.39.0
  - @loadmap/layout@0.39.0
  - @loadmap/sim@0.39.0

## 0.38.1

### Patch Changes

- @loadmap/core@0.38.1
  - @loadmap/dsl@0.38.1
  - @loadmap/layout@0.38.1
  - @loadmap/sim@0.38.1

## 0.38.0

### Patch Changes

- Updated dependencies [7bd53ff]
- Updated dependencies [bbf3d7a]
- Updated dependencies [ceaab31]
- Updated dependencies [a538b85]
- Updated dependencies [aca02dd]
  - @loadmap/core@0.38.0
  - @loadmap/dsl@0.38.0
  - @loadmap/layout@0.38.0
  - @loadmap/sim@0.38.0

## 0.37.0

### Minor Changes

- 10197af: A subsystem can be drawn closed: one box that stands for everything inside it. The box takes the colour of the worst
  component inside, names the busiest one on its second line, and wears the limit when the first limit is inside, so a
  board of closed subsystems says which one to open. The reader opens one with a click on it and closes one with a click
  on its name (the frame's name is a button now, with the mark of an open folder). Language 1.5 reads `closed` in `view`
  (`view { closed: [eu, us] }`: the ones the page starts with) and in a `step` (its own; `closed: []` for every one open).
  In code: `<Loadmap closed={[…]}>`, `closed` on a story step, `setClosed(ids)` on the controller, and
  `closed` among the options of a compiled definition, which `pageOptions()` passes on. Closing changes no number: the
  dots still pass every stage inside. What closes and draws them is loaded with the first diagram that has a subsystem.
- 2e0108e: A subsystem is drawn: a frame around its boxes with its name at the top, a subsystem in another as a frame in that
  one's frame, its line in the colour of the worst box inside once one is past its target. Until now a subsystem's boxes
  stood loose on the board and its name showed nowhere. A view takes `subsystems` (`{ eu: { label: 'EU region' },
  'eu.orders': { label: 'Orders' } }`) and what one holds is named `<id>.<name>`, as in a definition's text (the box
  `eu.orders.topic` stands in `eu.orders`, which stands in `eu`); the scene lists the frames as `scene.subsystems`, and `collisions()` also reports a frame that does not hold its boxes or reaches another's.
  A `.loadmap` needs nothing new: every `subsystem` gets its frame, in any language version, and the boxes inside are
  laid out together. With tiers, a subsystem whose boxes stand in several tiers has no frame (a frame cannot cross a
  lane); the subsystems in it keep theirs. `loadmap bundle` keeps a subsystem's first line (`subsystem orderLine
  "Orders"`) so the flat copy draws the same frames.
- 9105983: Reading a diagram of subsystems: on a board that zooms, a click on a frame flies in to it, and the path to where the
  view is shows over the board ("Whole diagram › EU region › Orders"), each step a button that flies back out to it; it
  follows the view however it moved. Copies of one subsystem in a `.loadmap` name their components apart: each name two
  components share takes the names of the subsystems around them that differ ("EU region › Workers", short "the workers
  in EU region"), so the verdict and the limits say which copy runs out. Only names that two components share change;
  the boxes keep their labels.

### Patch Changes

- Updated dependencies [894e762]
- Updated dependencies [10197af]
- Updated dependencies [4f43e29]
- Updated dependencies [10197af]
- Updated dependencies [2e0108e]
- Updated dependencies [9105983]
  - @loadmap/dsl@0.37.0
  - @loadmap/layout@0.37.0
  - @loadmap/core@0.37.0
  - @loadmap/sim@0.37.0

## 0.36.0

### Patch Changes

- Updated dependencies [a5811ae]
  - @loadmap/dsl@0.36.0
  - @loadmap/core@0.36.0
  - @loadmap/layout@0.36.0
  - @loadmap/sim@0.36.0

## 0.35.0

### Minor Changes

- 379e4b8: A diagram runs the way that fits its room larger: `direction` takes `'auto'`, now the default. A long chain runs right
  in a wide frame and down in a tall one (a board that fills its container or the screen, a canvas between its insets;
  on a page, the board's width by most of the window's height); where both fit about as well, the shape decides as
  before. Only the room and the structure turn it, never the load, a scenario, a step or a control, and it turns back
  only when the other way fits clearly larger, never to be drawn past full size. `'RIGHT'` or `'DOWN'` holds a direction
  as before, and below `narrowBelow` every diagram still runs down.
- 035f607: A long diagram folds to fill its room. Where its titles would be under 10 px in one row, `<Loadmap>` and
  `useLoadmap` fold it into the fewest rows, three at most, that draw it at least 15 % larger (columns side by side,
  running down), and choose the direction and the rows together. It unfolds once one row reads with ease again. Only
  the room and the structure change the arrangement, never the load or a phase. `rows` holds a count: `rows={1}` never
  folds.

### Patch Changes

- 32d5683: Language 1.4 is open: 1.3 shipped in @loadmap/dsl 0.34.0, so what is new to read needs a version of its own. Every
  definition in the repository says `loadmap 1.4`, and the corpus holds what 0.34.0 released. `rows` takes no unit
  (`rows: 200%` is refused), and a narrow screen never folds, whatever `rows` says: columns side by side would each be
  narrower still. The options of a compiled definition may now say `direction: 'auto'` and `rows`; pass them on with
  `pageOptions()`.
- Updated dependencies [4122ae6]
- Updated dependencies [379e4b8]
- Updated dependencies [035f607]
- Updated dependencies [ce37a77]
- Updated dependencies [32d5683]
  - @loadmap/dsl@0.35.0
  - @loadmap/layout@0.35.0
  - @loadmap/core@0.35.0
  - @loadmap/sim@0.35.0

## 0.34.0

### Minor Changes

- d77314a: A definition in several files, from `loadmap 1.3`, which this opens: a new definition starts with `loadmap 1.3`, and
  the templates and examples say it. A file stamped `loadmap 1`, `1.1` or `1.2` reads as it did, and one file is still
  a whole definition.
  - **Parts:** a model says `include "./shop.story.loadmap"`, the part `part of "./shop.loadmap"`. Its statements are the
    model's; it says the model's version.
  - **Libraries:** `library "…"` holds values (`let`, `fit`, `metric`, `measure`, `tier`, `published`), boxes with
    inputs and subsystems; a model takes them by name, `import "./platform.loadmap" { postgres; pool: podPool }`.
  - **Inputs:** `input pods = 3` in a library's box or subsystem, set in `with { … }` by the box that is `like:` it;
    `input flow main` takes a flow's name.
  - **Subsystems:** `subsystem orderLine "Orders" { like: pipeline; with { … } }` is several boxes as one, each named
    `orderLine.<name>`; with a `route:` of its own, a flow's route and an edge may name the subsystem.
  - **Variants:** `extends "./shop.loadmap"` is a model with other defaults and values.
  - `compile(source, { path, files })`: the host gives the files, the compiler reads none. A diagnostic and a symbol in
    another file carry `file`. New: `imports`, `gather`, `flatten`, and `definitionAcross`, `referencesAcross`,
    `renameAcross`, `hoverAcross`, `completionsAcross`.
  - A share link with more than one file is `#v2.`; one file still makes `#v1.`.
  - `loadmap check`, `pull`, `drift` and `record` read a definition with its files, inside the project root;
    `--format json` adds `file` to a diagnostic of another file. `loadmap fmt` on a model sets its parts' versions.
    New: `loadmap bundle <model.loadmap>` writes the definition as one file.
  - The language server and the VS Code extension: problems in the file they are in, definition, references and rename
    across a model's files, completion of paths, imports and inputs, a quick fix that imports a name, and the preview
    of a part (its model) and of a library (its own boxes).
  - The editor shows each file as a tab; `<LoadmapSource>` takes `files` and `path`.
  - A name with a dot (`a.b`) that is no table is now read as one name: where it names nothing, the error says so
    as before.

### Patch Changes

- Updated dependencies [4911a7c]
- Updated dependencies [ae1a0e3]
- Updated dependencies [59c1182]
- Updated dependencies [75ca614]
- Updated dependencies [00b4a76]
- Updated dependencies [d77314a]
- Updated dependencies [bc97bf4]
- Updated dependencies [8c9bc5d]
- Updated dependencies [47ab0ae]
- Updated dependencies [825b334]
- Updated dependencies [335c55d]
- Updated dependencies [c7822a5]
  - @loadmap/dsl@0.34.0
  - @loadmap/core@0.34.0
  - @loadmap/layout@0.34.0
  - @loadmap/sim@0.34.0

## 0.33.0

### Minor Changes

- 91c3aad: Lost boxes: a box for what other boxes lose, counted. A unit a stage turns away (a limiter, or a pass, cache or split
  past capacity), one a queue drops as too old, or one too slow for its client used to fade where it was; with a lost box,
  its dot goes along the edge into it and fades there. In the language, `node tooMany "Turned away" { lost }` and an edge
  `limiter -> tooMany`: the edge says what goes there, and `takes: [rejected]` keeps only some losses (`rejected`,
  `dropped`, `timedOut`). In TypeScript, `lost({ from: ['limiter'], takes: ['rejected'] })`. `at.tooMany` is what is lost
  there for good, after every retry, and the box says it on its second line ("500 rejected/s"); it is drawn dashed in the
  colour of a loss (`--lm-lost-fill`, `--lm-lost-line`), and so is the edge into it. A merge loses nothing: a merged dot
  now shrinks into a ripple of its flow's colour instead of fading grey, and the legend says "merged, newest kept".

### Patch Changes

- Updated dependencies [189d8db]
- Updated dependencies [af8d8d9]
- Updated dependencies [9065003]
- Updated dependencies [31404e8]
- Updated dependencies [91c3aad]
- Updated dependencies [8b8bfca]
- Updated dependencies [bb279a9]
- Updated dependencies [53b3f54]
- Updated dependencies [4cb38e2]
- Updated dependencies [5da4dd3]
- Updated dependencies [fcbf7ec]
  - @loadmap/dsl@0.33.0
  - @loadmap/core@0.33.0
  - @loadmap/layout@0.33.0
  - @loadmap/sim@0.33.0

## 0.32.0

### Minor Changes

- 53b93be: Connections on the board: behind an exclusive connection each unit goes to the worker that reads its partition, a
  worker is as busy as its partitions make it, one that reads none stays idle and is drawn dashed, and a partition a
  quieter worker reads waits less of the queue's lag. `ev.stages[pool].assignment` gives the worker of each partition
  and each worker's share of the work. The latency times each group of workers at its own utilization, instead of
  every unit at the busiest one's.

### Patch Changes

- 55c4e7f: Connections: `connections` in a model says how a stage reaches the next one on a route. `assign: 'exclusive'` gives each
  partition of the queue in front (or each of `parts`) one owner among the pool's workers or pods (or `members`): a Kafka
  consumer group. The component then runs out when its busiest member does: its utilization carries the spread (the
  busiest member's share of the work × the members), `ev.components[c].spread` says why, and owners left without a
  partition are named. `owner` and `capacityPer` (worker or pod) say what owns a part and what the capacity divides over;
  `flows` picks the flows it covers. An autoscaler still reads the plain utilization. `shared` (the default) changes no
  number. Each connection is listed with the assumptions.
- Updated dependencies [f2c3fd3]
- Updated dependencies [c302028]
- Updated dependencies [9cc0ccd]
- Updated dependencies [53b93be]
- Updated dependencies [7f55166]
- Updated dependencies [55c4e7f]
  - @loadmap/core@0.32.0
  - @loadmap/dsl@0.32.0
  - @loadmap/sim@0.32.0
  - @loadmap/layout@0.32.0

## 0.31.0

### Patch Changes

- de327ef: Latency as an output: `service` on a component (the seconds a unit takes when nothing waits) makes each stage it runs
  a queue whose time grows as service ÷ (1 − utilization); a flow's time through is the sum of its stages, fitted to a
  gamma per way and mixed over its ways, and `ev.latency` gives its mean, p50, p95 and p99. An expectation holds a
  percentile under a time, `{ flow: orders; p99: 0.5; target: 8 }`, on the pessimistic edge; `loadmap check --base`
  shows each flow's p99 against its base, and the Live panel each flow's p99.
- b9b71c3: A component can count slots instead of a rate: `held` (seconds a unit holds a connection, a session, a thread) makes
  its demand the slots in use by Little's law, what reaches its stages times `held`, one time for every flow or one per
  flow; `on` names the stages for a pool beside the limit that runs them. `held: 0.02` or `held { orders: 0.02 }` in the
  language. The `slots` measurements set its capacity and its time held.
- 0097fc9: A `split` stage sends each unit on one way of several, by share: a read/write split, shards, regions, an A/B test,
  failover. In the language, one `flow -> stage -> …: share` line per way inside `split { … }` on a box; in TypeScript,
  `split({ to: [{ stages: ['primary'], share: 0.2 }, …] })`. A flow's shares add up to 1 (formulas of the parameters
  allowed) and a flow the split does not name goes straight on; a way that ends in a store, a sink or a fan-out ends
  there, any other goes on with the route after the split. The model works out each flow's ways (`ev.paths`), and what
  reaches each stage, the demand, the rejections and the retries add up over them; the dots each take one way, drawn by
  share, and a model without a split draws exactly what it drew before. The search example's index is now two shards
  behind a coordinator.
- ed5d6d2: Timeouts: `timeout` on a flow (seconds) fails the share of its units slower than it, from the latency of its way; with
  `retry` they are sent again, which loads every stage and slows it further, settled at the least fixed point. The
  retry solve now holds that share while it settles the attempts, and stops at the least fixed point where a share
  can meet the attempts twice. `ev.latency[f].timedOut`, a Live meter, and the sim fades that share of dots as timed
  out. `timeout: 2` in the language.
- Updated dependencies [11b78ee]
- Updated dependencies [0ab6855]
- Updated dependencies [717b95e]
- Updated dependencies [9cf2028]
- Updated dependencies [de327ef]
- Updated dependencies [0fb5d08]
- Updated dependencies [b9b71c3]
- Updated dependencies [0097fc9]
- Updated dependencies [ed5d6d2]
  - @loadmap/core@0.31.0
  - @loadmap/dsl@0.31.0
  - @loadmap/sim@0.31.0
  - @loadmap/layout@0.31.0

## 0.30.1

### Patch Changes

- Updated dependencies [9bd542b]
  - @loadmap/dsl@0.30.1
  - @loadmap/core@0.30.1
  - @loadmap/layout@0.30.1
  - @loadmap/sim@0.30.1

## 0.30.0

### Minor Changes

- 1f11726: Measured data reaches a model as a snapshot: a JSON file with each measurement's value, its points and its origin
  (the provider, the query, the window, the step, when it was read, how many samples). `@loadmap/core/measure` (and
  `@loadmap/react`) has `parseSnapshot`, which checks an opened file as untrusted input, and `fromSnapshot`, whose
  `capacity`, `value` and `fit` read it inside model functions and fall back to the definition's own value, with why,
  when a measurement is missing or has fewer samples than its `min`. A capacity read so is `measured`, its `origin` and
  source say where it came from; `defineModel({ snapshot })` lists every measurement with the assumptions, and the
  Assumptions panel shows them. `MEASURES` is the standard set of measurements per kind (flow, pass, queue, workers,
  cache, limit, store, fan-out, and the split and slots to come), each with its role, unit and what it sets;
  `summarize` turns a window into one value. `docs/dsl.md` has the table and the format.

### Patch Changes

- Updated dependencies [1f11726]
  - @loadmap/core@0.30.0
  - @loadmap/dsl@0.30.0
  - @loadmap/layout@0.30.0
  - @loadmap/sim@0.30.0

## 0.29.0

### Minor Changes

- a71e332: Every tier lane is filled: the first, third… in the new theme token `--lm-tier-base`, the others in `--lm-tier`, with
  the lane shades and headers a step apart in both themes. `lanes: striped` (`lanes: 'striped'` in the view) brings back
  every other lane clear. A tier can have a colour of its own, `tier data "Data" { fill: "#e6f2ec"; fillDark: "#1c2b26" }`
  (`fill` and `fillDark` beside its `label` in TypeScript); without `fillDark`, dark keeps the colour's hue as dark as the
  theme's lanes, and `fillDark` alone leaves light the theme's. In a definition a colour is hex, `rgb()` or `hsl()`:
  `compile` refuses anything else, such as a `url(…)` that would fetch from a shared link, and now also what only looks
  like one (`"#12345"`, `"rgb(1)"`), for flows' colours too. Exports write a lane's own colours in rgb, as they write the
  theme's tokens.

  In the editor, **View** switches the lanes' fills and the canvas's dot grid (`grid: false`, read only by the editor),
  which now shows through the lanes; the model's tab gives each lane a light and a dark colour, and Reset takes them out.
  Each is one edit of the text: `setProperty` writes, changes or takes out a property of the definition or of a tier.

### Patch Changes

- Updated dependencies [a71e332]
  - @loadmap/layout@0.29.0
  - @loadmap/dsl@0.29.0
  - @loadmap/core@0.29.0
  - @loadmap/sim@0.29.0

## 0.28.0

### Patch Changes

- Updated dependencies [4a9b36b]
  - @loadmap/dsl@0.28.0
  - @loadmap/core@0.28.0
  - @loadmap/layout@0.28.0
  - @loadmap/sim@0.28.0

## 0.27.0

### Minor Changes

- 6408be2: A component catalog: `published(kafka, { brokers: 3, … })` is a fourth kind of capacity, the figure published for a
  component (Apache Kafka, RabbitMQ, Valkey, etcd, CockroachDB, ClickHouse, NGINX, HAProxy, CoreDNS, Kubernetes, and
  more) under the conditions it was run with, its source linked, its version and who ran it kept as metadata. The data
  is `@loadmap/core/catalog` (or `@loadmap/react/catalog`), off every first load; editions pin the numbers. A figure is
  a best case (a `margin` only lowers it), a published limit is exact, and a configuration no run matches gets no number:
  the component is not ranked, the verdict says why, and an expectation that depends on it fails.
- 4346ee1: The `.loadmap` language takes published figures: `published brokersRef kafka { edition: "2026-11"; brokers: 3; … }`
  names a component of the catalog and the conditions of its run, and `capacity: brokersRef` uses the figure. The
  checker names a component, condition, edition or figure that does not exist (and which component covers `redis`),
  warns when the conditions written match no published run, and says when a later edition has other figures;
  autocomplete offers the components, their conditions and the values their runs used, hover the figure with its
  conditions and source. The catalog loads only for a text that names it: `loadCatalog()` (and `needsCatalog(text)`)
  from `@loadmap/dsl`; `<LoadmapSource>`, the editor, the CLI and the language server load it themselves.

### Patch Changes

- Updated dependencies [6408be2]
- Updated dependencies [4346ee1]
  - @loadmap/core@0.27.0
  - @loadmap/dsl@0.27.0
  - @loadmap/layout@0.27.0
  - @loadmap/sim@0.27.0

## 0.26.1

### Patch Changes

- 108ff09: The alerts example compares a design: Today against Proposed (twice the position pods, a fourth push node), a growth
  rate that turns load into dates, the gateway's capacity as an estimate ± 30 %, and two expectations
  `loadmap check` keeps. Its docs page shows them.
- 0d5fa74: The docs site: every board pans and zooms (the examples, the live definitions, the templates), and each says in a
  line what to try on it. The landing page's board leaves its headroom chart to the checkout page, which shows the
  promises `loadmap check` keeps, included from `checkout.loadmap`.
- 8aba396: The docs site's concepts page shows a diagram that runs down by its shape, its lanes named up the left, and the
  embedding page frames a live embed of the checkout example with the HTML that does it.
- 08d4af1: The docs site's examples and templates are one Examples page: the walkthroughs (checkout, alerts) and the ten
  starters in one gallery, each card listing what its model shows, read from the model, and each walkthrough naming
  the starters it grew from. `/templates/` sends readers there; the web editor moves to The language.
- 42d7068: The docs site has a page for writing `.loadmap` in your own editor: the VS Code extension's install links, and the
  setup for `loadmap lsp` in Neovim and Helix. Each example page offers its `.loadmap` to download and says where to
  open it.
- 43a38f2: A third example, Search: a rate limiter, an autoscaled API, a cache and clients that retry, in three lanes, with a
  four-step story, two expectations and `layout: stable`, in TypeScript and as a `.loadmap`. The docs site has its page,
  its card among the examples, and the editor's New menu offers it.
- @loadmap/core@0.26.1
  - @loadmap/dsl@0.26.1
  - @loadmap/layout@0.26.1
  - @loadmap/sim@0.26.1

## 0.26.0

### Minor Changes

- e4884f9: **Track live changes** in the editor: a button in the code panel (`track`, `onTrack` for a page to keep it). On, once
  an edit is drawn and the text rests half a second, the board brings the boxes it changed into view, at the same zoom
  and further out only as far as it takes, and marks them with a short glow: a box whose lines the edit is in, one a
  changed line names (an edge, a route), one that is new or another size, the ends of an edge that came or went. Off,
  the view stays where the reader left it. `LoadmapHandle.show(ids)` brings boxes into view on a board that zooms.

### Patch Changes

- @loadmap/core@0.26.0
  - @loadmap/dsl@0.26.0
  - @loadmap/layout@0.26.0
  - @loadmap/sim@0.26.0

## 0.25.0

### Minor Changes

- 1d0cc1f: Tiers are drawn as lanes. Each tier has a header at its start, a strip across the top (running down, and on a phone, a
  column on the left, the name reading up), with its name in capitals; a line between the lanes, and every other lane
  shaded. A name wider than its lane takes two lines, and every header on that board takes two; only past two lines is it
  cut short with "…". The layout reserves the header's room, so no box or edge label sits under one: `collisions()`
  checks the whole header. Export, posters and the editor draw the same lanes.

  `SceneTier` has `head` (the header's box), `lines` (each line of the name with its spot; a line that comes or goes in
  a morph fades) and `spacing`, in place of `text` and `spot`. Four theme tokens colour the lanes: `--lm-tier` (a shaded
  lane), `--lm-tier-head`, `--lm-tier-fg` (the name) and `--lm-tier-line` (the dividers).

### Patch Changes

- 46b101d: A new model or view keeps the board: the diagram moves from what it drew to the new structure, as it does between
  scenarios, instead of starting again empty and fitted. The view the reader zoomed to stays, the box nearest its middle
  held still on the board while the rest moves around it (between phases too), and a view the reader never moved stays
  fitted. In the editor an edit keeps the zoom; a whole new text (a template, a shared link) still starts fitted.
- Updated dependencies [1d0cc1f]
  - @loadmap/layout@0.25.0
  - @loadmap/dsl@0.25.0
  - @loadmap/core@0.25.0
  - @loadmap/sim@0.25.0

## 0.24.0

### Minor Changes

- 37f2425: `<LoadmapSource>` keeps the values the board shows (the load, the scenario, the controls) when its text changes, as
  the editor does: a slider set by the reader stays where it is through an edit, and a value that no longer fits (an
  option taken away) goes back to its default. `initial` is for the first version; a `key` per file starts another file
  from its own defaults.

### Patch Changes

- @loadmap/core@0.24.0
  - @loadmap/dsl@0.24.0
  - @loadmap/layout@0.24.0
  - @loadmap/sim@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [d8fa10d]
- Updated dependencies [be481d6]
  - @loadmap/layout@0.23.0
  - @loadmap/dsl@0.23.0
  - @loadmap/core@0.23.0
  - @loadmap/sim@0.23.0

## 0.22.0

### Patch Changes

- Updated dependencies [ce0027b]
  - @loadmap/dsl@0.22.0
  - @loadmap/core@0.22.0
  - @loadmap/layout@0.22.0
  - @loadmap/sim@0.22.0

## 0.21.0

### Patch Changes

- Updated dependencies [2506c27]
  - @loadmap/dsl@0.21.0
  - @loadmap/core@0.21.0
  - @loadmap/layout@0.21.0
  - @loadmap/sim@0.21.0

## 0.20.0

### Patch Changes

- @loadmap/core@0.20.0
  - @loadmap/dsl@0.20.0
  - @loadmap/layout@0.20.0
  - @loadmap/sim@0.20.0

## 0.19.1

### Patch Changes

- @loadmap/core@0.19.1
  - @loadmap/dsl@0.19.1
  - @loadmap/layout@0.19.1
  - @loadmap/sim@0.19.1

## 0.19.0

### Patch Changes

- @loadmap/core@0.19.0
  - @loadmap/dsl@0.19.0
  - @loadmap/layout@0.19.0
  - @loadmap/sim@0.19.0

## 0.18.0

### Minor Changes

- 9fab44b: The scenarios and the load in one bar over the diagram, so the reader moves the load and watches what it does. `<Loadmap>` draws `LoadBar` where the scenarios were: it stays in view while the page scrolls (`--lm-sticky-top` on an ancestor keeps it under a page's own fixed header), and on a phone it sits under the diagram, in thumb reach. Full screen and focus put it in their head (focus shows the scenarios now, and its line keeps the verdict); on a phone, over the verdict. `LoadRange`, the slider itself, has a track coloured by what the load does (under the target, past it, past capacity, a ± range as a blend), a log scale when the load spans ten times or more, the date the growth reaches, and under it a mark for today, each preset that sets the load, the 50 % target and where it runs out, which a click takes; ← → move a step, Page Up and Page Down to the next mark. Its input now holds the place on the track, not the load: set the load with `setValues`. `Controls` takes `load={false}` to leave the load to the bar, and shows only the presets that set no load; full screen's Load card is Design, and goes when the model has nothing but the load. A `<Loadmap>` page loads 1.6 kB more; its budget is 51 kB.

### Patch Changes

- 49ca1e8: The dots are as sharp as the boxes on every board. A board that had its size before its first layout (a `<Diagram canvas>`, the editor's diagram) kept the canvas at the browser's 300 × 150 pixels and stretched it, so its dots were blurred to five or ten times their size; the canvas now follows its own size on the screen, in device pixels where the browser counts them, a canvas shown again and a screen of another density included. Screens above twice the pixel ratio get every pixel too, where the dots were drawn at two and stretched.
- @loadmap/core@0.18.0
  - @loadmap/dsl@0.18.0
  - @loadmap/layout@0.18.0
  - @loadmap/sim@0.18.0

## 0.17.1

### Patch Changes

- 82906fb: The README's quick start passes `theme="inherit"`, so its diagram follows the light and dark switch of the page it is on, and the system's while the page has none.
- @loadmap/core@0.17.1
  - @loadmap/dsl@0.17.1
  - @loadmap/layout@0.17.1
  - @loadmap/sim@0.17.1

## 0.17.0

### Minor Changes

- 4d2870e: The filling editor on a phone (below 720 px wide, or 500 px high): the text or the diagram, switched by Diagram and Code at the bottom in thumb reach; the diagram a canvas a finger pans and two pinch, fitted above a sheet of panels that rests at peek (the verdict and the load slider), half or full, dragged, tapped or stepped with the arrow keys, the inspector in it while the text is hidden; ⋯ opens every other action in a sheet from the bottom; typing, the text is 16 px, the switch steps aside and a row of keys sits on top of the keyboard (Format, Undo, an indent, braces, quotes, Done); the bars clear the notch and the home bar, and every target is 44 px. The caret is drawn in the theme's text colour, light on a dark theme, where it was black. `LoadRange`, the load slider alone, is exported from `@loadmap/react`.

### Patch Changes

- @loadmap/core@0.17.0
  - @loadmap/dsl@0.17.0
  - @loadmap/layout@0.17.0
  - @loadmap/sim@0.17.0

## 0.16.0

### Patch Changes

- @loadmap/core@0.16.0
  - @loadmap/dsl@0.16.0
  - @loadmap/layout@0.16.0
  - @loadmap/sim@0.16.0

## 0.15.0

### Minor Changes

- 1405fc9: A diagram the reader pans and zooms. `<Loadmap zoom>` (and `useLoadmap`, `<LoadmapSource>`) puts the zoom buttons on the board (− · the zoom · + · Fit): a drag pans, with a hand to hold it by, and a press that hardly moves is still a click on a box; a pinch zooms about its middle; the keys + − 0 and the arrows work while the board or a box has the focus, and a box the keyboard reaches outside the view comes into it. The wheel zooms about the pointer with Ctrl or ⌘ held (a trackpad's pinch too), so a page that scrolls keeps its wheel, and one finger scrolls the page until the reader zooms in. The zoom goes from 10 % to 400 % of one pixel a scene unit, a large diagram down to half its fit, and a diagram can never be dragged out of sight. `<Diagram canvas>` makes the board fill its container, as a canvas the wheel alone zooms, with no Full screen button; `canvas={{ left: 420, right: 340 }}` names the pixels the page floats over it, and Fit frames the whole diagram in what they leave. Play starts from the reader's view and flies out to the whole diagram; a drag while the story plays stops it where it is, and it ends fitted. With reduced motion the buttons and the keys jump. The code that pans and zooms loads with the first board that does: a page without `zoom` loads nothing more. Pictures, posters, GIFs and videos show what the camera frames, never the reader's view, as before. Full screen's compact panels and a box's detail now load when the reader first asks for them, so a `<Loadmap>` page loads less than before. The editor's diagram pans and zooms.

### Patch Changes

- @loadmap/core@0.15.0
  - @loadmap/dsl@0.15.0
  - @loadmap/layout@0.15.0
  - @loadmap/sim@0.15.0

## 0.14.0

### Minor Changes

- 7886094: A diagram without `layout` (or `direction`) runs right, or down when it fans out wider than it is long: when its
  widest layer has more boxes than its longest chain. The layers are counted as ELK draws them: every edge counts,
  whatever its `when` (so the load and the phases never turn it), a loop is cut where the flow comes back, a sink or
  store that feeds nothing stands in the last layer, and a box with no edge is left out. `directionOf(view)` gives it
  (from `@loadmap/layout` and `@loadmap/react`), and `layout()` runs by it when no direction is given; narrow screens
  still run down.

### Patch Changes

- Updated dependencies [7886094]
  - @loadmap/layout@0.14.0
  - @loadmap/dsl@0.14.0
  - @loadmap/core@0.14.0
  - @loadmap/sim@0.14.0

## 0.13.0

### Minor Changes

- 2d8c547: The boxes nothing feeds stand first along the flow, and a sink or store that feeds nothing stands last. Tiers cut the
  diagram into bands across the flow (edge, services, data): `tier edge "Edge"` declares one, in the order the flow
  meets them, and `tier: edge` puts a box in it (`tiers: { edge: { label: 'Edge' } }` in the view and `tier: 'edge'`
  on a box in TypeScript). A box without a tier stands in the tier of the boxes that feed it. Each tier is a band behind
  its boxes, every other one shaded, with its label in the margin before them: across the top running right, up the
  left side running down and on a phone. `Scene.tiers` holds the bands; `collisions()` checks their labels too.

### Patch Changes

- Updated dependencies [2d8c547]
  - @loadmap/layout@0.13.0
  - @loadmap/dsl@0.13.0
  - @loadmap/core@0.13.0
  - @loadmap/sim@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [497f671]
  - @loadmap/core@0.12.0
  - @loadmap/layout@0.12.0
  - @loadmap/dsl@0.12.0
  - @loadmap/sim@0.12.0

## 0.11.0

### Minor Changes

- 6561c3d: A loadmap made to be framed. `<Loadmap fill>` (and `<LoadmapSource fill>`) fills its container laid out as full screen is, in `fullScreenMode`, for good: no full screen button, nothing scrolls; for a page of its own in an iframe, whose layout follows the frame as full screen follows the screen. `sharedValues(model, values)` in `@loadmap/dsl` reads a shared link's values by each parameter's kind and keeps only what still fits the model, as the editor does. `<LoadmapEditor embedLink={(hash, o) => url}>` puts "Copy embed link" beside "Share link": a menu that picks what the embed shows (`EmbedOptions`: the diagram, the default, or the panels too, the theme, the story played when it comes into view) and copies the link, or an `<iframe>` with it. The docs site has the page those links open, at `/embed/`, and a page on embedding in ClickUp and any page.

### Patch Changes

- 6561c3d: When the limit passes on, the old limit's ring fades where it is: it no longer grows over its neighbours as it goes.
- Updated dependencies [6561c3d]
  - @loadmap/dsl@0.11.0
  - @loadmap/core@0.11.0
  - @loadmap/layout@0.11.0
  - @loadmap/sim@0.11.0

## 0.10.0

### Patch Changes

- 4e60946: The diagram's tag says where the limit is, not its rank: "LIMIT · 18×", the multiple at which that component reaches the target (the pessimistic edge of a ± range, the headline's number), and the next two in line wear quiet badges ("2nd · 20×", "3rd · 35×") when they reach it within the load's range. When the limit passes to another component, its old ring fades (its tag already the old box's badge) and the new one comes in, on the engine's clock: never two tags, never two rings at once. A story step that does it adds a shot to the new limit (1.8 s, counted in `playStory()`'s length) and its title says so: "API gateway fixed: the worker pool is next, at 10×", or "The push broker overtakes the position consumer: the limit is 18× now". A component drawn as several boxes is tagged once, and a box that leaves wears nothing. The headline, the scenarios table and the poster say "limited by"; the box detail says "limit", "2nd" or "3rd" as its box does, and the limits list tags its first row "limit". Reduced motion cuts the handover.
- @loadmap/core@0.10.0
  - @loadmap/dsl@0.10.0
  - @loadmap/layout@0.10.0
  - @loadmap/sim@0.10.0

## 0.9.0

### Minor Changes

- 7c5d7b3: Play tells the story on the diagram: the whole diagram first, then for each step a close-up on what it changes (the box
  it points at and any box it reshapes, several framed together), the change, and the whole diagram again for the step's
  `seconds`, with a short title on the board. A step's new `title` (`StoryStepDef.title`, `title:` in `.loadmap`) names
  it there; without one the title says what changes ("Users 1× → 20×"). The camera runs on the engine's clock and moves
  the view, never the board; with reduced motion it cuts. The component that runs out first wears a ring and a tag that
  breathe while the story plays and once it is past the target.

  `ref.playStory()` plays it on the engine's clock (`step()` advances it); `recordVideo({ story: true })` and
  `loadmap record --story` record it that way, from the defaults, the same options giving the same file. The controller
  gains `lm.cue`. A render React makes of older values no longer hands the engine their numbers.

### Patch Changes

- Updated dependencies [7c5d7b3]
  - @loadmap/core@0.9.0
  - @loadmap/dsl@0.9.0
  - @loadmap/layout@0.9.0
  - @loadmap/sim@0.9.0

## 0.8.0

### Minor Changes

- 25a0575: `<LoadmapSource source={text} name="shop.loadmap" />` from `@loadmap/react/source` draws a `.loadmap` text with the
  options it declares (the page's props win; its `assumptions` come first). It compiles again when the text's tokens
  change, so spaces and comments keep the board and its values; while the text does not compile it shows the
  diagnostics as `loadmap check` prints them, above the last version that did. It is a separate entry, the one that
  loads the compiler: a page built from code never does. `@loadmap/react` now depends on `@loadmap/dsl` for it.
- 0fb1d62: `theme="inherit"` follows the page's own light and dark switch, `data-theme="dark"` or a `dark` class on `<html>`,
  as it changes (the dots and the meters too), and the system's while the page sets none; `usePageTheme(theme)` gives
  the theme it resolves to. `<LoadmapEditor theme="inherit">` does the same. Two tokens fit the root into a card that
  has its own: `--lm-pad` (its padding, 16px) and `--lm-root-bg` (its background); full screen keeps both.

### Patch Changes

- 68bc952: The headroom chart keeps its labels inside its card: the load's label turns to the left of its line near the right
  edge, and the last tick ends at its tick. A line past the top leaves through the plot's edge, in the compact chart
  too, which now leaves room under its heading. A box's detail opens on the side with room that shows (a board that pans
  in its own box, full screen, the window), and never past the edge of what clips it.
- Updated dependencies [25a0575]
  - @loadmap/dsl@0.8.0
  - @loadmap/core@0.8.0
  - @loadmap/layout@0.8.0
  - @loadmap/sim@0.8.0

## 0.7.0

### Minor Changes

- 414f759: A page without a bundler can keep the layout in a worker. `workerElk(() => new Worker(…))` makes an ELK engine for
  `<Loadmap elk={…}>` from a worker the page starts, and `@loadmap/react/elk.worker.js` is the worker's file, for a
  bundler to inline (`?worker&inline` in Vite) or a CDN to serve. When the worker cannot start and the layout falls back
  to the main thread, the console says so once, with what to hand in. The docs have a "Without a bundler" page: a page
  from a CDN with an import map, and one self-contained HTML file, with the sizes to expect.

### Patch Changes

- @loadmap/core@0.7.0
  - @loadmap/layout@0.7.0
  - @loadmap/sim@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [9fe4c1a]
  - @loadmap/core@0.6.0
  - @loadmap/layout@0.6.0
  - @loadmap/sim@0.6.0

## 0.5.0

### Minor Changes

- c1651c6: Full screen fits the screen without scrolling. The diagram stays on top, as wide as the screen; under it the verdict in
  one line (the load, how far the target holds, the first limit, how sure its capacity is) and the panels `fullScreen`
  lists in a compact form, side by side in a box the screen sizes: Live as small meters, where it runs out a line per
  component, the controls a line each, headroom as a sparkline, compare its first table, the assumptions a count. Rows
  that do not fit are left out whole and counted; each compact panel, "Why" and the assumptions open the panel whole over
  the diagram (its button closes it, and Esc in the overlay; the browser's own full screen takes Esc for itself). A phone
  shows one panel at a time under tabs, and pans the diagram in its own box. Nothing the load changes moves the board.

  A switch beside Close, or the F key, turns full screen into focus: the diagram, the story under it, and the verdict and
  the load slider when `fullScreen` lists them. `<Loadmap fullScreenMode="focus">` and `fullScreenMode: focus` in a
  `.loadmap` open full screen there (type `FullScreenMode`, default `'panels'`); the editor, the docs and the CLI viewer
  pass it on. The story bar gets Play: each step for its `seconds`, as `loadmap record --story` plays it, until the last
  or a value of the reader's own; its text keeps the room of the longest step.

  The controller has the state: `fullScreen`, `toggleFullScreen()`, `fullScreenMode`, `setFullScreenMode()`,
  `storyPlaying`, `setStoryPlaying()`. `<Loadmap>`'s `.lm-side` is now also `.lm-drawer`; a page of its own keeps its
  `.lm-side` under the board, in a box that scrolls on its own. `.lm-corner` is gone: nothing scrolls Close away.
- 9280b78: The diagram moves to a new structure instead of swapping it: when a scenario, a story step or a control adds pods,
  brokers or partitions, the boxes that stay move and resize to their new places with their edges, what goes fades out,
  and what is new fades in, its edges drawing in last. `<Loadmap transition={0.8}>` sets how many seconds it takes (0
  cuts), and `transition: 0.8` in a `.loadmap` does the same in the editor, the docs and `loadmap record`; with reduced
  motion it always cuts, and so does a board paused with nothing stepping it. The load never moves the diagram, as
  before. The move runs on the engine's clock, so a recording shows it and stays the same file, byte for byte;
  `handle.ready()` waits for each of its frames to be drawn, `board().scene` is the frame drawn, and `reset()` ends a
  move. A `Scene`'s parts carry `fade` (and a new edge `draw`) only while it moves.

### Patch Changes

- Updated dependencies [9280b78]
  - @loadmap/layout@0.5.0
  - @loadmap/core@0.5.0
  - @loadmap/sim@0.5.0

## 0.4.0

### Minor Changes

- bca623f: Full screen shows the diagram as wide as the screen, and below it every panel of the page: the verdict, Live and
  where it runs out beside the controls, then the headroom chart, the scenarios compared and what it assumes; the whole
  view scrolls, and the diagram never moves with the load. `<Loadmap fullScreen={['verdict', 'live', 'controls']}>`
  keeps only the panels it lists (`LOADMAP_PANELS`, type `LoadmapPanel`), and `fullScreen: [verdict, live, controls]`
  in a `.loadmap` does the same in the editor, the docs and `loadmap record`. A diagram in a narrow column turns to run
  left to right in full screen. Scrolled down to the panels, Close waits in the corner. `<Loadmap>` now wraps each
  panel in a `div.lm-panel` (`data-panel` names it), and `.lm-more` is gone: CSS that selected a panel as a child of
  `.lm-side` needs `.lm-panel` in between.

### Patch Changes

- @loadmap/core@0.4.0
  - @loadmap/layout@0.4.0
  - @loadmap/sim@0.4.0

## 0.3.1

### Patch Changes

- 60b542e: Full screen fills the screen: the diagram as large as fits, the legend over it, and the verdict, the live meters and
  the controls in a panel beside it (below it on a phone). Where the browser refuses full screen (an iPhone, a frame),
  the page is covered instead; Esc or Close leaves. `<Loadmap>` now puts the verdict and the panels after the diagram
  in a `div.lm-side`: CSS that selected them as children of `.lm` needs `.lm-side` in between.
- @loadmap/core@0.3.1
  - @loadmap/layout@0.3.1
  - @loadmap/sim@0.3.1

## 0.3.0

### Minor Changes

- 294378d: Light editing for readers: `<LoadmapEditor layout="reader">` shows the diagram with an inspector (a box's label,
  capacity and parameters; the model's load, growth and flows), each change a small edit of the text, and a shared link
  opens that way on the docs site. `format()` and `loadmap fmt` (`--check` for CI) lay a definition out the one way.
  `<Loadmap onNodeClick selected>`; in the editor a click on a box selects its lines, and **Format** (Shift+Alt+F).

### Patch Changes

- Updated dependencies [294378d]
  - @loadmap/core@0.3.0
  - @loadmap/sim@0.3.0
  - @loadmap/layout@0.3.0

## 0.2.0

### Minor Changes

- 2a8118b: Building blocks: a cache stage (hits answered and sent back), an autoscaled workers pool (min, max, target; a pods
  meter), a rate limiter (`limit` with a `configured` capacity) and retries that settle past capacity (`retry` with a
  budget). `at.<stage>.<flow>` reads what reaches a stage, a component without a demand takes it, and four new
  templates show each block.

### Patch Changes

- Updated dependencies [2a8118b]
  - @loadmap/core@0.2.0
  - @loadmap/sim@0.2.0
  - @loadmap/layout@0.2.0

## 0.1.1

### Patch Changes

- Published from GitHub Actions with npm trusted publishing: every package now carries a provenance statement that ties
  it to its commit and workflow.
- Updated dependencies
  - @loadmap/core@0.1.1
  - @loadmap/sim@0.1.1
  - @loadmap/layout@0.1.1
