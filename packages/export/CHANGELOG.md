# @loadmap/export

## 0.19.0

### Patch Changes

- @loadmap/core@0.19.0
  - @loadmap/react@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [49ca1e8]
- Updated dependencies [9fab44b]
  - @loadmap/react@0.18.0
  - @loadmap/core@0.18.0

## 0.17.1

### Patch Changes

- Updated dependencies [82906fb]
  - @loadmap/react@0.17.1
  - @loadmap/core@0.17.1

## 0.17.0

### Patch Changes

- Updated dependencies [4d2870e]
  - @loadmap/react@0.17.0
  - @loadmap/core@0.17.0

## 0.16.0

### Patch Changes

- @loadmap/core@0.16.0
  - @loadmap/react@0.16.0

## 0.15.0

### Patch Changes

- 1405fc9: A diagram the reader pans and zooms. `<Loadmap zoom>` (and `useLoadmap`, `<LoadmapSource>`) puts the zoom buttons on the board (− · the zoom · + · Fit): a drag pans, with a hand to hold it by, and a press that hardly moves is still a click on a box; a pinch zooms about its middle; the keys + − 0 and the arrows work while the board or a box has the focus, and a box the keyboard reaches outside the view comes into it. The wheel zooms about the pointer with Ctrl or ⌘ held (a trackpad's pinch too), so a page that scrolls keeps its wheel, and one finger scrolls the page until the reader zooms in. The zoom goes from 10 % to 400 % of one pixel a scene unit, a large diagram down to half its fit, and a diagram can never be dragged out of sight. `<Diagram canvas>` makes the board fill its container, as a canvas the wheel alone zooms, with no Full screen button; `canvas={{ left: 420, right: 340 }}` names the pixels the page floats over it, and Fit frames the whole diagram in what they leave. Play starts from the reader's view and flies out to the whole diagram; a drag while the story plays stops it where it is, and it ends fitted. With reduced motion the buttons and the keys jump. The code that pans and zooms loads with the first board that does: a page without `zoom` loads nothing more. Pictures, posters, GIFs and videos show what the camera frames, never the reader's view, as before. Full screen's compact panels and a box's detail now load when the reader first asks for them, so a `<Loadmap>` page loads less than before. The editor's diagram pans and zooms.
- Updated dependencies [1405fc9]
  - @loadmap/react@0.15.0
  - @loadmap/core@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [7886094]
  - @loadmap/react@0.14.0
  - @loadmap/core@0.14.0

## 0.13.0

### Patch Changes

- 348cd39: A recording drew the same frame two ways on Linux Chromium once in a while: hinted text at a fractional scale (the
  camera flying in) came out heavier or lighter depending on what the browser had drawn before. The board's copy now
  draws its text unhinted (`text-rendering="geometricPrecision"`), so the same options give the same file again.
- Updated dependencies [2d8c547]
  - @loadmap/react@0.13.0
  - @loadmap/core@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [497f671]
  - @loadmap/core@0.12.0
  - @loadmap/react@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [6561c3d]
- Updated dependencies [6561c3d]
  - @loadmap/react@0.11.0
  - @loadmap/core@0.11.0

## 0.10.0

### Patch Changes

- 4e60946: The diagram's tag says where the limit is, not its rank: "LIMIT · 18×", the multiple at which that component reaches the target (the pessimistic edge of a ± range, the headline's number), and the next two in line wear quiet badges ("2nd · 20×", "3rd · 35×") when they reach it within the load's range. When the limit passes to another component, its old ring fades (its tag already the old box's badge) and the new one comes in, on the engine's clock: never two tags, never two rings at once. A story step that does it adds a shot to the new limit (1.8 s, counted in `playStory()`'s length) and its title says so: "API gateway fixed: the worker pool is next, at 10×", or "The push broker overtakes the position consumer: the limit is 18× now". A component drawn as several boxes is tagged once, and a box that leaves wears nothing. The headline, the scenarios table and the poster say "limited by"; the box detail says "limit", "2nd" or "3rd" as its box does, and the limits list tags its first row "limit". Reduced motion cuts the handover.
- Updated dependencies [4e60946]
  - @loadmap/react@0.10.0
  - @loadmap/core@0.10.0

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
  - @loadmap/react@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [25a0575]
- Updated dependencies [68bc952]
- Updated dependencies [0fb1d62]
  - @loadmap/react@0.8.0
  - @loadmap/core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [414f759]
  - @loadmap/react@0.7.0
  - @loadmap/core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [9fe4c1a]
  - @loadmap/core@0.6.0
  - @loadmap/react@0.6.0

## 0.5.0

### Patch Changes

- 9280b78: The diagram moves to a new structure instead of swapping it: when a scenario, a story step or a control adds pods,
  brokers or partitions, the boxes that stay move and resize to their new places with their edges, what goes fades out,
  and what is new fades in, its edges drawing in last. `<Loadmap transition={0.8}>` sets how many seconds it takes (0
  cuts), and `transition: 0.8` in a `.loadmap` does the same in the editor, the docs and `loadmap record`; with reduced
  motion it always cuts, and so does a board paused with nothing stepping it. The load never moves the diagram, as
  before. The move runs on the engine's clock, so a recording shows it and stays the same file, byte for byte;
  `handle.ready()` waits for each of its frames to be drawn, `board().scene` is the frame drawn, and `reset()` ends a
  move. A `Scene`'s parts carry `fade` (and a new edge `draw`) only while it moves.
- Updated dependencies [c1651c6]
- Updated dependencies [9280b78]
  - @loadmap/react@0.5.0
  - @loadmap/core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [bca623f]
  - @loadmap/react@0.4.0
  - @loadmap/core@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [60b542e]
  - @loadmap/react@0.3.1
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
  - @loadmap/react@0.3.0

## 0.2.0

### Minor Changes

- 2a8118b: Building blocks: a cache stage (hits answered and sent back), an autoscaled workers pool (min, max, target; a pods
  meter), a rate limiter (`limit` with a `configured` capacity) and retries that settle past capacity (`retry` with a
  budget). `at.<stage>.<flow>` reads what reaches a stage, a component without a demand takes it, and four new
  templates show each block.

### Patch Changes

- Updated dependencies [2a8118b]
  - @loadmap/core@0.2.0
  - @loadmap/react@0.2.0

## 0.1.1

### Patch Changes

- Published from GitHub Actions with npm trusted publishing: every package now carries a provenance statement that ties
  it to its commit and workflow.
- Updated dependencies
  - @loadmap/core@0.1.1
  - @loadmap/react@0.1.1
