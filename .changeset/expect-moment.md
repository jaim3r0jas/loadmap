---
'@loadmap/core': minor
'@loadmap/dsl': minor
---

An expect holds a moment: `expect { preset: "Sale day"; queue: topic; lag: 5min; clears: 1h }` says that when the
preset's moment ends (its `lasts`), the oldest unit waiting in the queue has waited at most 5 minutes, and that the
reader then empties it within an hour at the default load. Without `queue` it holds every queue. It is held on the
pessimistic edge, and is inconclusive when it holds only at the high edge of a ±. `backlog()` gives each queue's
`lag` and takes a `bound`. In TypeScript, `expect: [{ preset: 'Sale day', queue: 'topic', lag: 300, clears: 3600 }]`.
From `loadmap 1.8`.

Docs: /language/controls/
