---
'@loadmap/core': minor
'@loadmap/dsl': minor
---

A delay on an edge: `users -> lb: "HTTPS" { delay: 80ms }` is the time a hop takes whatever the load, a network round
trip or a call to another region. It adds to the latency of every flow that goes from the one box straight to the
other (on the edge from a flow's `from` box, of the flows that start there), so it counts toward their timeout. No
unit is done before the delays of its way: the queues' times are fitted past them, so one queue behind a delay has
the exact percentiles of a shifted exponential. The edge says it after its label ("HTTPS · 80 ms"), and a delay no
flow goes along warns (`unused-delay`). It may read the load and the parameters. In TypeScript:
`delays: [{ from: 'api', to: 'payments', delay: 0.002 }]`. From `loadmap 1.8`.

Docs: /language/building-blocks/#latency-and-timeouts
