---
'@loadmap/core': minor
'@loadmap/dsl': minor
---

Slots held while something slow answers: `through: api -> payments` on a held component names a stretch of the way,
and a unit holds its slot for the time it takes there (each stage's time at its utilization, and the delays between
them), on top of `held` if there is one. A thread pool or a connection pool then runs out when the dependency slows
down, before the box itself is busy. A flow's timeout bounds the time; a cache's hits leave the stretch at the cache;
a stage past full counts as a million service times. `ev.components.<id>.held` and the box's detail say the whole
time. In TypeScript: `through: ['api', 'payments']`. From `loadmap 1.8`.

Docs: /language/building-blocks/#slots-held-for-a-while
