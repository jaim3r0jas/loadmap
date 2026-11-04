# @loadmap/react

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
