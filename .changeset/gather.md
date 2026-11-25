---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/sim': minor
'@loadmap/layout': minor
'@loadmap/react': minor
---

A gather: one unit makes several calls at once and goes on when enough of them have answered. `gather { reads ->
shards: 8; needs: 6 }` is a read from every shard, a quorum write, a page built from many services. The stage it calls
sees every call (8 a read) and is ranked on that; the unit waits for the slowest call it needs, which is in its
latency (the 6th of 8 answers, from the calls' mean time); and it fails when too few answer, a loss at the gather
that a lost box takes and `expect { lost }` holds (a stage failing 1 % of its calls fails 7.7 % of the units that need
all 8). A call is a copy on a branch, so the line takes what a fan-out's does, a branch that goes on included. Unlike
a fan-out it does not end the route. In TypeScript, `gather({ to: [{ stage: 'shards', share: 8 }], needs: 6 })`. From
`loadmap 1.8`.

Docs: /language/building-blocks/#gathers
