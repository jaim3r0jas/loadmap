---
'@loadmap/dsl': minor
---

Language 1.5: one spelling each, and nothing it could do before is lost. `direction`, `rows` and `layout` live in
`view { … }` with the other view settings. A pool is its workers: `pods`, `perPod`, `placement`, `autoscale { … }` and
`stageLabel` are lines of the pool, and the `workers { … }` block goes. A `%` after a number is always a share
(`30%+1` is 1.3); the remainder is `mod(a, b)`. From 1.5 these are errors, each with a quick fix: the `workers` block,
`sub:` on a box (the second text on the first line), `label:` in an edge's block (`a -> b: "x" { when: … }`), `tag` on a
param, `grid` in the view, `%` between two values, the old names (`target` and `full` in `expect`, `min` on a metric,
`fill`, a connection's `max`, `layout: right`) and the view settings at the top. `===`, `!==` and `derived.x` warn as
old spellings of `==`, `!=` and `x`. A file stamped before 1.5 compiles and computes as it did, with a warning that says
"(an error from loadmap 1.5)"; `loadmap fmt` writes the new forms in a file stamped 1.5. The VS Code extension's
grammar reads a `%` after a number as part of it.
