---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/react': minor
---

A batch: `runs { every: 1d; within: 4h }` on a component (language 1.7; `runs: { every, within }` in TypeScript).
What reaches it in `every` is worked off `within`, so its demand is the rate a run needs, and it runs out where a run
misses its window, at a load multiple. Every a day or more reads each flow at its average. The limits list says how
long a run takes of its time (`ev.components.<id>.runs.takes`).

Docs: /language/building-blocks/#batches
