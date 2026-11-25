# @loadmap/layout

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

### Patch Changes

- Updated dependencies [3c5c29f]
- Updated dependencies [1604406]
- Updated dependencies [253c67e]
- Updated dependencies [4613370]
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

## 0.46.0

### Minor Changes

- 00a1e85: A fallback: `fallback { after: api; route: staleQuotes }` on a flow (language 1.7; `fallback: { after, route }` in
  TypeScript). What the flow fails for good, turned away or too slow after every retry, goes back to `after` and is
  served along `route`: each fallback stage sees that rate (`ev.fallbacks.<flow>.rate`) and may run out like any other.
  A lost box on the route counts none of it; one behind a fallback stage counts what that stage turns away. On the board
  a failed dot fades where it failed and a dot sets out from `after` along its edge to the fallback, which needs that
  edge (`missing-edge`). The budgets go to 74, 230 and 140 kB.

  Docs: /language/building-blocks/#lost-units
- f9b0d92: In the editor, a box or an edge added to the text moves its neighbours and not the whole diagram: what is drawn next
  is laid out from where the boxes are drawn, and **View → Tidy the diagram** (`tidy()` on the editor's handle) lays it
  out as a reload draws it. `layout()` and `<Loadmap>` take the drawn scene as `from` for it. A page, a reload, a
  recording and an export draw the layout from scratch, as before; so does a diagram with subsystems or folded into
  rows. A scene says the `rows` it was folded into.

  Docs: /api/react/#hold
- 56e90eb: Skew drawn on a sharded store: a store or a pass that a key connection shards over `members` and `parts` is drawn as
  its members, each holding the parts it keeps (part i on member i mod members), and its dots land on their parts, the
  hot key's share on part 0, as on a queue. The resolved stage says so (`ResolvedStage.shards`: `members`, `parts`,
  `skew`). The `<Loadmap>` page's budget goes to 76 kB.

  Docs: /language/building-blocks/#connections

### Patch Changes

- aaa4f91: A new version of a model keeps more of what is drawn. The story step shown stays when the text is edited (or another
  `model` is handed to `<Loadmap>`), as the new version writes it: its values, and what it closes, change as the step is
  edited, and only a story that no longer has the step leaves it; a story that is playing still stops. A version whose
  boxes and edges take the same room is not laid out again: ELK's result is kept by the frame, not by the compiled view.
  The editor's handle has `changeFiles(files)`, which changes the definition's files as an edit (one undo step per file),
  where `setFiles` starts a new definition from its defaults. In the editor, a change that reaches only a file that is
  not open (a restore, an accepted proposal, a rename) is drawn at once, not with the next key.

  Docs: /api/react/#useloadmap-and-the-controller
- Updated dependencies [b547540]
- Updated dependencies [37f77bd]
- Updated dependencies [00a1e85]
- Updated dependencies [f89851d]
- Updated dependencies [a993b1b]
- Updated dependencies [9222ee2]
- Updated dependencies [66323a1]
- Updated dependencies [56e90eb]
- Updated dependencies [a4b725f]
- Updated dependencies [0aef603]
- Updated dependencies [3f8470d]
  - @loadmap/core@0.46.0

## 0.45.0

### Patch Changes

- @loadmap/core@0.45.0

## 0.44.0

### Patch Changes

- @loadmap/core@0.44.0

## 0.43.0

### Patch Changes

- @loadmap/core@0.43.0

## 0.42.1

### Patch Changes

- @loadmap/core@0.42.1

## 0.42.0

### Patch Changes

- @loadmap/core@0.42.0

## 0.41.0

### Patch Changes

- @loadmap/core@0.41.0

## 0.40.0

### Patch Changes

- @loadmap/core@0.40.0

## 0.39.0

### Patch Changes

- @loadmap/core@0.39.0

## 0.38.1

### Patch Changes

- @loadmap/core@0.38.1

## 0.38.0

### Patch Changes

- Updated dependencies [7bd53ff]
  - @loadmap/core@0.38.0

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

### Patch Changes

- 4f43e29: A closed subsystem's box names its busiest component without its own name before it: "Workers 15 %" in the box that
  is the EU region, where the verdict says "EU region › Workers". A closed box nothing reaches says "no traffic". The docs have a new walkthrough, Two regions: each
  region a copy of one subsystem from a library, in several files, opened with both regions closed.
- Updated dependencies [10197af]
  - @loadmap/core@0.37.0

## 0.36.0

### Patch Changes

- @loadmap/core@0.36.0

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
- ce37a77: `layout()` takes `rows`: a long diagram folded into that many rows one under the other (columns side by side, running
  down). The cuts fall between layers, between two tiers rather than inside one where the rows stay about as long; an
  edge to the next row goes round the end of its row on a track of its own, and each row has its own lanes. The load
  never moves a folded diagram either, and a stable layout keeps every box in place. The fold loads with the first
  diagram that asks for one.

### Patch Changes

- @loadmap/core@0.35.0

## 0.34.0

### Patch Changes

- @loadmap/core@0.34.0

## 0.33.0

### Minor Changes

- 9065003: Dots move only along edges. Every hop a flow takes needs an edge drawn the way it goes: from its `from` node to its
  first stage, along its route, on each way of a split (and where a way rejoins the route), and from a fan-out to each
  stage it copies to. A hop without one used to draw its dots straight across the diagram; now `defineView` throws
  (`flow "signups" goes from node "gateway" to node "api" with no edge between them: add edge('gateway', 'api')`) and
  the language reports an error at the hop from `loadmap 1.1` on (a warning in a file stamped before, whose dots still
  cross straight), with quick fixes that add the edge or route the flow through the boxes the
  edges already join. The edge must point the way the flow goes: one drawn the other way round no longer carries a
  route's dots (a cache's answers still go back along the edge they came in on). An edge a flow takes that its `when` hides at the defaults, in a preset or a scenario is a warning.
  To move a file over: apply the quick fix in the editor or VS Code, or add the edge `loadmap check` names.
  `model.stagesAt()` also returns each flow's ways (`paths`).
- 91c3aad: Lost boxes: a box for what other boxes lose, counted. A unit a stage turns away (a limiter, or a pass, cache or split
  past capacity), one a queue drops as too old, or one too slow for its client used to fade where it was; with a lost box,
  its dot goes along the edge into it and fades there. In the language, `node tooMany "Turned away" { lost }` and an edge
  `limiter -> tooMany`: the edge says what goes there, and `takes: [rejected]` keeps only some losses (`rejected`,
  `dropped`, `timedOut`). In TypeScript, `lost({ from: ['limiter'], takes: ['rejected'] })`. `at.tooMany` is what is lost
  there for good, after every retry, and the box says it on its second line ("500 rejected/s"); it is drawn dashed in the
  colour of a loss (`--lm-lost-fill`, `--lm-lost-line`), and so is the edge into it. A merge loses nothing: a merged dot
  now shrinks into a ripple of its flow's colour instead of fading grey, and the legend says "merged, newest kept".

### Patch Changes

- 31404e8: Language versions with a minor: `loadmap 1.1`. `loadmap 1` reads as 1.0, the language of @loadmap/dsl 0.32, and a
  file keeps compiling as it did under the version it names: a check a later version makes strict is a warning before it
  ("… (an error from loadmap 1.1)") and an error from it on, so a hop without its edge in a `loadmap 1` file warns and
  its dots cross straight, as they did. Something a version added (`lost` boxes, numbers with units, `as` after a
  demand: 1.1) needs that version on the first line, an error with a quick fix that writes it, so a loadmap too old for
  it says "update @loadmap/dsl" instead of "unknown statement" (one from before this release reads `loadmap 1.1` that
  way already). `loadmap fmt` raises the first line to the lowest version that has everything the file uses, and never
  lowers it; `1.10` comes after `1.9`. The reference says which version added a statement, and docs/dsl.md has the rule
  and a table of versions. `LANGUAGE_VERSION` is now a string, `'1.1'`. The templates, examples and docs' definitions
  say `loadmap 1.1`.
- Updated dependencies [189d8db]
- Updated dependencies [9065003]
- Updated dependencies [91c3aad]
- Updated dependencies [8b8bfca]
- Updated dependencies [bb279a9]
  - @loadmap/core@0.33.0

## 0.32.0

### Patch Changes

- Updated dependencies [f2c3fd3]
- Updated dependencies [c302028]
- Updated dependencies [9cc0ccd]
- Updated dependencies [53b93be]
- Updated dependencies [7f55166]
- Updated dependencies [55c4e7f]
  - @loadmap/core@0.32.0

## 0.31.0

### Patch Changes

- Updated dependencies [11b78ee]
- Updated dependencies [0ab6855]
- Updated dependencies [717b95e]
- Updated dependencies [de327ef]
- Updated dependencies [b9b71c3]
- Updated dependencies [0097fc9]
- Updated dependencies [ed5d6d2]
  - @loadmap/core@0.31.0

## 0.30.1

### Patch Changes

- @loadmap/core@0.30.1

## 0.30.0

### Patch Changes

- Updated dependencies [1f11726]
  - @loadmap/core@0.30.0

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

- @loadmap/core@0.29.0

## 0.28.0

### Patch Changes

- @loadmap/core@0.28.0

## 0.27.0

### Patch Changes

- Updated dependencies [6408be2]
- Updated dependencies [4346ee1]
  - @loadmap/core@0.27.0

## 0.26.1

### Patch Changes

- @loadmap/core@0.26.1

## 0.26.0

### Patch Changes

- @loadmap/core@0.26.0

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

- @loadmap/core@0.25.0

## 0.24.0

### Patch Changes

- @loadmap/core@0.24.0

## 0.23.0

### Minor Changes

- d8fa10d: Each scenario, story step, preset and choice of a select or switch is laid out on its own by default (`layout:
  'compact'` on the view, `layout: compact` in a `.loadmap`), over every load and every value of the range controls, and
  the boxes move from one to the next: a long story no longer pays for its largest step in every step. Dragging the load
  or a range control still never moves a box, and a step looks the same whichever came before. `layout: stable` keeps
  the old promise that no phase moves a box. In a stable layout, an edge whose `when` turns on partway up the load range
  no longer moves the boxes when the load reaches it.

  In the language the direction is now `direction: right | down`; `layout: right` and `layout: down` still work, with a
  warning, and `loadmap fmt` rewrites them. A `<Loadmap>` page loads 0.4 kB more; its budget is 51.5 kB.

### Patch Changes

- @loadmap/core@0.23.0

## 0.22.0

### Patch Changes

- @loadmap/core@0.22.0

## 0.21.0

### Patch Changes

- @loadmap/core@0.21.0

## 0.20.0

### Patch Changes

- @loadmap/core@0.20.0

## 0.19.1

### Patch Changes

- @loadmap/core@0.19.1

## 0.19.0

### Patch Changes

- @loadmap/core@0.19.0

## 0.18.0

### Patch Changes

- @loadmap/core@0.18.0

## 0.17.1

### Patch Changes

- @loadmap/core@0.17.1

## 0.17.0

### Patch Changes

- @loadmap/core@0.17.0

## 0.16.0

### Patch Changes

- @loadmap/core@0.16.0

## 0.15.0

### Patch Changes

- @loadmap/core@0.15.0

## 0.14.0

### Minor Changes

- 7886094: A diagram without `layout` (or `direction`) runs right, or down when it fans out wider than it is long: when its
  widest layer has more boxes than its longest chain. The layers are counted as ELK draws them: every edge counts,
  whatever its `when` (so the load and the phases never turn it), a loop is cut where the flow comes back, a sink or
  store that feeds nothing stands in the last layer, and a box with no edge is left out. `directionOf(view)` gives it
  (from `@loadmap/layout` and `@loadmap/react`), and `layout()` runs by it when no direction is given; narrow screens
  still run down.

### Patch Changes

- @loadmap/core@0.14.0

## 0.13.0

### Minor Changes

- 2d8c547: The boxes nothing feeds stand first along the flow, and a sink or store that feeds nothing stands last. Tiers cut the
  diagram into bands across the flow (edge, services, data): `tier edge "Edge"` declares one, in the order the flow
  meets them, and `tier: edge` puts a box in it (`tiers: { edge: { label: 'Edge' } }` in the view and `tier: 'edge'`
  on a box in TypeScript). A box without a tier stands in the tier of the boxes that feed it. Each tier is a band behind
  its boxes, every other one shaded, with its label in the margin before them: across the top running right, up the
  left side running down and on a phone. `Scene.tiers` holds the bands; `collisions()` checks their labels too.

### Patch Changes

- @loadmap/core@0.13.0

## 0.12.0

### Minor Changes

- 497f671: No scenario, story step, preset or control moves a box any more. ELK lays out every box at the largest size it takes
  anywhere the model reaches, and each box is drawn at its own size in the middle of that slot: a pool that gains pods
  grows where it stands and its neighbours stay put. What it reaches: the defaults, each scenario, story step and
  declared preset, and every combination of the controls (a range at each step, or at points across a long one); past
  256 combinations, each control's options one at a time from each scenario, step and preset. Edges leave and enter a
  box at the middle of its sides, and an edge that comes or goes (`when`) keeps its room. Values nothing declared
  reaches (a combination past that bound that draws a box larger) lay out again, as before.

  `model.stagesAt(values)` gives the stages and the context they resolve in, without the crossings and the verdict: what
  a drawing needs, cheap enough to call for many values.

### Patch Changes

- Updated dependencies [497f671]
  - @loadmap/core@0.12.0

## 0.11.0

### Patch Changes

- @loadmap/core@0.11.0

## 0.10.0

### Patch Changes

- @loadmap/core@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [7c5d7b3]
  - @loadmap/core@0.9.0

## 0.8.0

### Patch Changes

- @loadmap/core@0.8.0

## 0.7.0

### Patch Changes

- @loadmap/core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [9fe4c1a]
  - @loadmap/core@0.6.0

## 0.5.0

### Minor Changes

- 9280b78: The diagram moves to a new structure instead of swapping it: when a scenario, a story step or a control adds pods,
  brokers or partitions, the boxes that stay move and resize to their new places with their edges, what goes fades out,
  and what is new fades in, its edges drawing in last. `<Loadmap transition={0.8}>` sets how many seconds it takes (0
  cuts), and `transition: 0.8` in a `.loadmap` does the same in the editor, the docs and `loadmap record`; with reduced
  motion it always cuts, and so does a board paused with nothing stepping it. The load never moves the diagram, as
  before. The move runs on the engine's clock, so a recording shows it and stays the same file, byte for byte;
  `handle.ready()` waits for each of its frames to be drawn, `board().scene` is the frame drawn, and `reset()` ends a
  move. A `Scene`'s parts carry `fade` (and a new edge `draw`) only while it moves.

### Patch Changes

- @loadmap/core@0.5.0

## 0.4.0

### Patch Changes

- @loadmap/core@0.4.0

## 0.3.1

### Patch Changes

- @loadmap/core@0.3.1

## 0.3.0

### Minor Changes

- 294378d: Light editing for readers: `<LoadmapEditor layout="reader">` shows the diagram with an inspector (a box's label,
  capacity and parameters; the model's load, growth and flows), each change a small edit of the text, and a shared link
  opens that way on the docs site. `format()` and `loadmap fmt` (`--check` for CI) lay a definition out the one way.
  `<Loadmap onNodeClick selected>`; in the editor a click on a box selects its lines, and **Format** (Shift+Alt+F).

### Patch Changes

- Updated dependencies [294378d]
  - @loadmap/core@0.3.0

## 0.2.0

### Minor Changes

- 2a8118b: Building blocks: a cache stage (hits answered and sent back), an autoscaled workers pool (min, max, target; a pods
  meter), a rate limiter (`limit` with a `configured` capacity) and retries that settle past capacity (`retry` with a
  budget). `at.<stage>.<flow>` reads what reaches a stage, a component without a demand takes it, and four new
  templates show each block.

### Patch Changes

- Updated dependencies [2a8118b]
  - @loadmap/core@0.2.0

## 0.1.1

### Patch Changes

- Published from GitHub Actions with npm trusted publishing: every package now carries a provenance statement that ties
  it to its commit and workflow.
- Updated dependencies
  - @loadmap/core@0.1.1
