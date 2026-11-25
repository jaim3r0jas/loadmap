---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/sim': minor
---

A region goes out: `domain region "Region" { parts: [eu, us] }` names a domain's parts, a box or a subsystem is `in`
one (`in: eu`), and the Outage control takes each part out by its id (`down: eu`). With a part down its boxes are
switched off and every split deals again: a way through the part gets nothing and the ways left take its share by
their own, evenly when theirs are all 0. A flow with no way left is turned away at the split, and what reaches a box
of the part with no split in front is turned away there. The N−1 line answers for each part ("With the EU out, the
50 % target holds up to 2×"), `down: region` in an expect holds the worst of the parts, and a formula reads
`down.eu` and `down.region`. In TypeScript, `parts` on a domain and `in: { domain, part }` on a component. From
`loadmap 1.8`.

Docs: /language/building-blocks/#failure-domains
