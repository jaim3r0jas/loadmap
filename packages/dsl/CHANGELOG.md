# @loadmap/dsl

## 0.26.1

### Patch Changes

- @loadmap/core@0.26.1
  - @loadmap/layout@0.26.1

## 0.26.0

### Patch Changes

- @loadmap/core@0.26.0
  - @loadmap/layout@0.26.0

## 0.25.0

### Patch Changes

- 1d0cc1f: Tiers are drawn as lanes. Each tier has a header at its start, a strip across the top (running down, and on a phone, a
  column on the left, the name reading up), with its name in capitals; a line between the lanes, and every other lane
  shaded. A name wider than its lane takes two lines, and every header on that board takes two; only past two lines is it
  cut short with "…". The layout reserves the header's room, so no box or edge label sits under one: `collisions()`
  checks the whole header. Export, posters and the editor draw the same lanes.

  `SceneTier` has `head` (the header's box), `lines` (each line of the name with its spot; a line that comes or goes in
  a morph fades) and `spacing`, in place of `text` and `spot`. Four theme tokens colour the lanes: `--lm-tier` (a shaded
  lane), `--lm-tier-head`, `--lm-tier-fg` (the name) and `--lm-tier-line` (the dividers).
- Updated dependencies [1d0cc1f]
  - @loadmap/layout@0.25.0
  - @loadmap/core@0.25.0

## 0.24.0

### Patch Changes

- @loadmap/core@0.24.0
  - @loadmap/layout@0.24.0

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
- be481d6: Snippets, quick fixes, go to definition, references and rename. A statement typed at the start of a line completes as
  a snippet built from the schema: its id and label, its required properties, and for a box a stage and a capacity.
  `quickFixes(source, diagnostics)` gives each diagnostic's fixes as text changes: the did-you-mean applied (a name, a
  property, a scenario), a missing required property added in the block's own layout, a bare number made
  `estimated(…)` or `measured(…)` in the file's unit, a stray ":" before an edge's block dropped. `definition` and
  `references(source, offset)` find where a name is declared and every place it is written, and `rename(source, offset,
  name)` renames it everywhere: a box's id with the stage and the component that take it, a scenario's label quoted
  where it must be; it refuses a name that is not one, is reserved or taken, and a result that would not compile.

  In the editor: a diagnostic's tooltip offers its fixes, F12 or a click with Cmd or Ctrl goes to the declaration, the
  other uses of the name under the cursor are marked, and F2 (or Rename over a phone's keyboard) opens a field to rename
  it. The editor's budget is 170 kB.

### Patch Changes

- Updated dependencies [d8fa10d]
  - @loadmap/layout@0.23.0
  - @loadmap/core@0.23.0

## 0.22.0

### Minor Changes

- ce0027b: Hover and signature help. `hover(source, offset, definition?)` says what a word is: a statement or a property (its
  doc from the schema), a builtin (its arguments), a name the definition declares, with its values at the defaults when
  given the compiled definition: a flow's rate and route, what of it reaches a stage, a component's utilization, demand
  against capacity, how sure the capacity is and where it reaches the target and runs out, a `let`'s value, a
  parameter's choices, a tier's boxes, what a scenario sets. The values come from the compiled model's own evaluation,
  never from evaluating text. `signatureHelp(source, offset)` names the arguments of the builtin or fit the cursor is
  in, and which one it is writing.

  The editor shows both: a hover over a word (while the text has an error, with the values of the last version without
  one, and a line that says so), and over the cursor inside a call its arguments, the one being written marked, on a
  phone too. Completion, hover and signature help are one entry of the packed dsl, so a page that only reads a
  definition never loads them.

### Patch Changes

- @loadmap/core@0.22.0
  - @loadmap/layout@0.22.0

## 0.21.0

### Minor Changes

- 2506c27: Completion knows where the cursor is. A capacity offers `measured`, `estimated` and `configured` first, as snippets
  that fill in value, unit and source field by field; after its value comes `± 30%`; its unit offers the units the file
  already uses. A box's `demand` offers the flows that reach it first, `at.<stage>.` only the flows that pass that stage,
  a route the stages next along an edge first, a `when` the switches. Nothing that reads itself is offered (a `let`'s own
  name, a component's own `util`), nor a property the block already sets, nor anything inside a comment or a plain text;
  a template's `${…}` completes by where the template is. A scenario, preset or step offers a parameter's options, and so does the parameter's own `default`; `tier:` offers the
  tiers, wherever they are declared.
  Builtins come with their arguments and a line of help. Completion reads the parse alone, never runs the model, so it
  costs a small part of a compile on every keystroke: `completions(source, offset)` no longer takes a compile result.

  A block left open while typing (`flow q {` without its `}`) ends at the next top-level line instead of taking the rest
  of the file, so the diagnostics and completions below it stay right; a file whose braces balance reads as before.

  The editor closes brackets and quotes as they are typed, and opens the list after `(`, `,`, an operator or a quote. Tab
  moves through a snippet's fields and then out of the call; on a phone the ⇥ key over the keyboard does the same. Where
  there is no room beside the list (a phone), its help goes under the list instead of over the options after the one
  selected.

### Patch Changes

- @loadmap/core@0.21.0
  - @loadmap/layout@0.21.0

## 0.20.0

### Patch Changes

- @loadmap/core@0.20.0
  - @loadmap/layout@0.20.0

## 0.19.1

### Patch Changes

- @loadmap/core@0.19.1
  - @loadmap/layout@0.19.1

## 0.19.0

### Patch Changes

- @loadmap/core@0.19.0
  - @loadmap/layout@0.19.0

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
