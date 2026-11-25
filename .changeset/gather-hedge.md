---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/sim': minor
---

A hedge on a gather: `hedge: 95%` sends a second call for each one not answered by the p95 of its own time, and the
first of the two answers counts. What is called sees the second calls (5 % more at 95 %), and the unit's wait for the
calls it needs is shorter in the tail: a read that waits for 8 calls of 10 ms has its p99 fall from 64 ms to 51 ms. The wait is
summed over the survival of a hedged call, since the slowest of several has no closed form then. The second call
takes the edge's delay too. A call that fails is not sent again by a hedge. In TypeScript, `gather({ to, needs,
hedge: 0.95 })`. From `loadmap 1.8`.

Docs: /language/building-blocks/#gathers
