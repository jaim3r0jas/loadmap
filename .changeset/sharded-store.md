---
'@loadmap/core': minor
'@loadmap/layout': minor
'@loadmap/sim': minor
---

Skew drawn on a sharded store: a store or a pass that a key connection shards over `members` and `parts` is drawn as
its members, each holding the parts it keeps (part i on member i mod members), and its dots land on their parts, the
hot key's share on part 0, as on a queue. The resolved stage says so (`ResolvedStage.shards`: `members`, `parts`,
`skew`). The `<Loadmap>` page's budget goes to 76 kB.

Docs: /language/building-blocks/#connections
