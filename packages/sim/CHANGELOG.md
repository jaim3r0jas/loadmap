# @loadmap/sim

## 0.29.0

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

### Patch Changes

- @loadmap/core@0.25.0

## 0.24.0

### Patch Changes

- @loadmap/core@0.24.0

## 0.23.0

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

### Patch Changes

- @loadmap/core@0.14.0

## 0.13.0

### Patch Changes

- @loadmap/core@0.13.0

## 0.12.0

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
