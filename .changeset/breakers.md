---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/sim': minor
---

A circuit breaker: `breaker { opens: 50% }` on a flow (language 1.7; `breaker: { opens }` in TypeScript). Past that
share of its attempts failing, its callers fail calls fast. In steady state it admits the share α at which the
failures among what it admits are `opens`, p(α·rate) = opens, found by bisection; below that it stays closed. What it
fails fast reaches no stage: it goes to the flow's fallback, if any, and on the board fades at the source
(`ev.breakers.<flow>`: `admitted`, `failedFast`). A flow that retries takes no breaker.

Docs: /language/building-blocks/#lost-units
