---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/react': minor
---

A moment's way up walks more of what a peak meets. `cold: [appCache]` on a preset starts its moment with those caches
cold, and `warms: 5min` on a cache is how long it takes from no hits to its `hit` ("8× at once: up to 62 % of reads is
lost for 3 min, while the cache warms"). A limit's `burst` is spent on the way, and filled again below the limit ("6× at
once: nothing is lost for 2.5 s, until the burst of the rate limiter is spent, then 67 % of searches as it holds"). A
queue with a size takes everything in until it is full ("nothing is lost for 50 s, until the inbox is full"). Each step
of `moment()` says each cache's warmth, each bucket's units and each queue's backlog. In TypeScript, `colds` beside
`ramps` and `warms` on `cache()`. From `loadmap 1.8`.

Docs: /language/controls/#presets
