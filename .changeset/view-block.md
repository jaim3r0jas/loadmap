---
'@loadmap/dsl': minor
'@loadmap/editor': patch
---

A `view { … }` block, from `loadmap 1.2`, holds what only changes how the page looks and plays: `speed`, `transition`,
`fullScreen`, `fullScreenMode`, `lanes` and `grid`. They stood at the top beside what the model computes from. In a 1.2
file a setting at the top still works and warns (`deprecated`, with a quick fix), and `loadmap fmt` moves it into the
block, a comment above it too; a file stamped before 1.2 keeps them at the top, silently. The editor's View menu
writes into the block.
