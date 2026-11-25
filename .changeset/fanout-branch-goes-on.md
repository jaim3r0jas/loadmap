---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/sim': minor
'@loadmap/layout': minor
'@loadmap/react': minor
---

A fan-out branch that goes on: `orders -> mailQueue -> mailers -> smtp: 1` copies each order into a queue, to the
workers that read it and on to what they call, where a branch was one stage. The copies reach every stage of the
branch (`at.mailers.orders`), each stage runs its component and is ranked like any other, a queue on the branch fills
when its reader is full, the dots go the whole way, and an edge joins each pair of boxes along it. A branch goes
through queues, pools and `pass`, `cache`, `limit`, `store` and `sink` stages; it takes no split and no second
fan-out, and it never comes back to the route. This is how the asynchronous side of a system is written: email, search
indexing, a replica that follows a log. In TypeScript a branch is `{ stages: ['mailQueue', 'mailers', 'smtp'], share:
1 }`, and a resolved branch carries its `stages`. From `loadmap 1.8`.

Docs: /language/building-blocks/#fan-out-and-sinks
