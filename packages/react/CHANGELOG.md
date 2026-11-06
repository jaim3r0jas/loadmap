# @loadmap/react

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
