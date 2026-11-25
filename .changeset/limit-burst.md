---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/react': minor
---

A rate limit's bucket and a quota per minute. `limit { burst: 500 }` lets everything through past the limit until the
bucket is spent, its size over what arrives above the limit a second, then cuts to the limit. No steady figure
changes; `ev.components.<limit>.burst` gives `{ size, passes, lasts }`, and the limits list says "A burst of 500 passes: at 3×
all gets through for 2.5 s, then it is cut to 100 req/s". A quota counts a window of a minute too (`per: minute`),
read at the peak as an hour is. In TypeScript, `limit(c, { burst: 500 })` and `limit(c, { per: 'minute' })`. From
`loadmap 1.8`.

Docs: /language/building-blocks/#rate-limits
