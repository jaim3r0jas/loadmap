---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/sim': minor
---

A breaker with retries: a flow may have a `breaker` and its client's `retry` together, where it took one of them.
Each attempt goes through the breaker, and a call it fails fast is a failed attempt, sent again like any other. The
rate the breaker admits is the one at which the failures behind it reach `opens`, whatever is sent, so the retries
still settle at their least point, as many units fail for good as without the breaker, and the stages behind it see
what it admits, not the storm. `ev.breakers.<flow>.failedFast` counts attempts, and what is lost for good is shared
between the stages and the calls failed fast. On the board a retry goes through the breaker as the first attempt did.
A retry `at` a hop still takes no breaker. This lifts an error, so a file of any version reads it.

Docs: /language/building-blocks/#lost-units
