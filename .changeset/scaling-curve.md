---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/react': minor
'@loadmap/cli': minor
---

A scaling curve: `fit apiScale { curve: usl; points n rate { … } }` (language 1.7; `fitScaling` from
`@loadmap/core/calibrate`, and from `@loadmap/react`) fits the Universal Scalability Law to sizes and the capacity
measured at each: contention and coherency, so twice the pods give less than twice the capacity and past a peak less.
Call it like a fit, `measured(apiScale(pods), "req/s", …)`. The assumptions list it with its peak, in the page and in
`loadmap check`, and a parameter it reads that reaches past the peak warns (`past-peak`). It never applies to a
published figure.

Docs: /language/controls/#fitted-costs
