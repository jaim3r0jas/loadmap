# @loadmap/dsl

## 0.18.0

### Patch Changes

- @loadmap/core@0.18.0
  - @loadmap/layout@0.18.0

## 0.17.1

### Patch Changes

- @loadmap/core@0.17.1
  - @loadmap/layout@0.17.1

## 0.17.0

### Patch Changes

- @loadmap/core@0.17.0
  - @loadmap/layout@0.17.0

## 0.16.0

### Patch Changes

- @loadmap/core@0.16.0
  - @loadmap/layout@0.16.0

## 0.15.0

### Patch Changes

- @loadmap/core@0.15.0
  - @loadmap/layout@0.15.0

## 0.14.0

### Patch Changes

- 7886094: A diagram without `layout` (or `direction`) runs right, or down when it fans out wider than it is long: when its
  widest layer has more boxes than its longest chain. The layers are counted as ELK draws them: every edge counts,
  whatever its `when` (so the load and the phases never turn it), a loop is cut where the flow comes back, a sink or
  store that feeds nothing stands in the last layer, and a box with no edge is left out. `directionOf(view)` gives it
  (from `@loadmap/layout` and `@loadmap/react`), and `layout()` runs by it when no direction is given; narrow screens
  still run down.
- Updated dependencies [7886094]
  - @loadmap/layout@0.14.0
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

- Updated dependencies [2d8c547]
  - @loadmap/layout@0.13.0
  - @loadmap/core@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [497f671]
  - @loadmap/core@0.12.0
  - @loadmap/layout@0.12.0

## 0.11.0

### Minor Changes

- 6561c3d: A loadmap made to be framed. `<Loadmap fill>` (and `<LoadmapSource fill>`) fills its container laid out as full screen is, in `fullScreenMode`, for good: no full screen button, nothing scrolls; for a page of its own in an iframe, whose layout follows the frame as full screen follows the screen. `sharedValues(model, values)` in `@loadmap/dsl` reads a shared link's values by each parameter's kind and keeps only what still fits the model, as the editor does. `<LoadmapEditor embedLink={(hash, o) => url}>` puts "Copy embed link" beside "Share link": a menu that picks what the embed shows (`EmbedOptions`: the diagram, the default, or the panels too, the theme, the story played when it comes into view) and copies the link, or an `<iframe>` with it. The docs site has the page those links open, at `/embed/`, and a page on embedding in ClickUp and any page.

### Patch Changes

- @loadmap/core@0.11.0
  - @loadmap/layout@0.11.0

## 0.10.0

### Patch Changes

- @loadmap/core@0.10.0
  - @loadmap/layout@0.10.0

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
  - @loadmap/layout@0.9.0

## 0.8.0

### Patch Changes

- 25a0575: The README starts from `<LoadmapSource>` (`@loadmap/react/source`) for drawing a definition on a page, and says what
  `compile()` and `formatDiagnostic()` give for a page that does it itself.
- @loadmap/core@0.8.0
  - @loadmap/layout@0.8.0

## 0.7.0

### Patch Changes

- 1ad72b9: The package carries the language guide and the whole reference, `dist/REFERENCE.md`, so a person or an agent working
  from `node_modules` finds it next to the types. The README has a "Test a model" section: `expect` lines,
  `npx @loadmap/cli check`, and a script that prints the verdict and each component's utilization. The docs site
  publishes `llms.txt` and `llms-full.txt` (the reference, and one model that uses every statement).
- @loadmap/core@0.7.0
  - @loadmap/layout@0.7.0

## 0.6.0

### Patch Changes

- 1640a0e: Two slips get one error with the fix instead of a puzzle. A box whose only component lines are optional ones
  (`describe`, `name`, `short`, `plural`, `when`), with no demand, capacity or over, gets one error on that line
  instead of three "the component needs …": for a plain-text `describe`, put it on the first line, `node users "Users"
  "people on the shop"`. And `a -> b: { … }` says to drop the ":" before the block (a fan-out branch, that it takes its
  copies after ":"), then checks the block's lines as usual.
- 9fe4c1a: A flow whose rate is a constant (`rate: 20 / 86_400`, or `rate: 40` in TypeScript) compiles and runs: it stays the
  same at any load. An error raised while computing a flow now points at that flow, not at the formula that happened
  to read it first; a preset or a scenario that breaks it keeps pointing at the preset or the scenario. An error that
  only loadmap's own code can cause, such as a TypeError, says it is a bug in loadmap and how to report it, with the
  original text as the hint, instead of showing loadmap's internal names; one from a host function is that function's.
- Updated dependencies [9fe4c1a]
  - @loadmap/core@0.6.0
  - @loadmap/layout@0.6.0

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

## 0.3.1

### Patch Changes

- @loadmap/core@0.3.1
  - @loadmap/layout@0.3.1

## 0.3.0

### Minor Changes

- 294378d: Light editing for readers: `<LoadmapEditor layout="reader">` shows the diagram with an inspector (a box's label,
  capacity and parameters; the model's load, growth and flows), each change a small edit of the text, and a shared link
  opens that way on the docs site. `format()` and `loadmap fmt` (`--check` for CI) lay a definition out the one way.
  `<Loadmap onNodeClick selected>`; in the editor a click on a box selects its lines, and **Format** (Shift+Alt+F).

### Patch Changes

- Updated dependencies [294378d]
  - @loadmap/core@0.3.0
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
  - @loadmap/layout@0.2.0

## 0.1.1

### Patch Changes

- Published from GitHub Actions with npm trusted publishing: every package now carries a provenance statement that ties
  it to its commit and workflow.
- Updated dependencies
  - @loadmap/core@0.1.1
  - @loadmap/layout@0.1.1
