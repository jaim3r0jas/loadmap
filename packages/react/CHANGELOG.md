# @loadmap/react

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
