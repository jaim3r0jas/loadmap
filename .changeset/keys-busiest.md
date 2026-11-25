---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/react': minor
---

Uneven work, said as a share. `limit { keys: 400; skew: estimated(20%, "share", "the noisiest tenant") }` is a limit for
each key: the capacity is one key's, it runs out when the hottest key does, and it turns away only what is above each
key's own limit; the limits list says "400 keys, each its own limit: the hottest carries 20 % of what arrives"
(`ev.components.<limit>.keys`). `busiest: estimated(32%, "share", "ring stats")` on a connection says how much its
busiest member takes, whatever deals the work: the stage runs out when that member does. A ± on either share moves the
crossings. In TypeScript, `limit(c, { keys, skew })` and `busiest` on a connection. From `loadmap 1.8`.

Docs: /language/building-blocks/#rate-limits
