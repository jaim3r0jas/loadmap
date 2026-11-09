---
'@loadmap/core': minor
'@loadmap/sim': minor
'@loadmap/dsl': minor
'@loadmap/react': patch
'@loadmap/vscode': patch
---

A `split` stage sends each unit on one way of several, by share: a read/write split, shards, regions, an A/B test,
failover. In the language, one `flow -> stage -> …: share` line per way inside `split { … }` on a box; in TypeScript,
`split({ to: [{ stages: ['primary'], share: 0.2 }, …] })`. A flow's shares add up to 1 (formulas of the parameters
allowed) and a flow the split does not name goes straight on; a way that ends in a store, a sink or a fan-out ends
there, any other goes on with the route after the split. The model works out each flow's ways (`ev.paths`), and what
reaches each stage, the demand, the rejections and the retries add up over them; the dots each take one way, drawn by
share, and a model without a split draws exactly what it drew before. The search example's index is now two shards
behind a coordinator.
