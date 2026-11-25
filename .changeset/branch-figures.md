---
'@loadmap/core': minor
'@loadmap/dsl': minor
---

A fan-out branch has figures of its own. `expect { flow: orders; to: smtp; lost: 1%; underTarget: 2× }` and
`expect { flow: orders; to: smtp; p99: 1s }` hold the branch through `smtp`, not the flow: what its copies lose (what
the fan-out turns away, and along the branch what a pass, a limit or a cache turns away, what a component fails and
what a queue drops, as a share of the copies asked for) and the time they take from the fan-out through that stage.
None of it is in the flow's own losses or latency: an order is not lost when its mail is. `to` may be any stage of
the branch. In code, `model.branch(flow, to, values?, bound?)` gives the branch's `stages`, `lost` and `latency`. A
`delay` on an edge along a branch now counts in the branch's time (it warned as unused). From `loadmap 1.8`.

Docs: /language/building-blocks/#fan-out-and-sinks
