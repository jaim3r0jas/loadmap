---
'@loadmap/layout': minor
'@loadmap/react': minor
'@loadmap/dsl': patch
---

A diagram without `layout` (or `direction`) runs right, or down when it fans out wider than it is long: when its
widest layer has more boxes than its longest chain. The layers are counted as ELK draws them: every edge counts,
whatever its `when` (so the load and the phases never turn it), a loop is cut where the flow comes back, a sink or
store that feeds nothing stands in the last layer, and a box with no edge is left out. `directionOf(view)` gives it
(from `@loadmap/layout` and `@loadmap/react`), and `layout()` runs by it when no direction is given; narrow screens
still run down.
