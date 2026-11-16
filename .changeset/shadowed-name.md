---
'@loadmap/dsl': minor
'@loadmap/editor': patch
---

A new warning, `shadowed-name`: an id that names two kinds of thing (`param pods` beside `pool pods`, where `${pods}`
reads the parameter and `focus: pods` the box), or that is also a keyword of the language (`param merge`,
`pool workers`). A box, its stage and its component still share one id. It needs no language version, and nothing
computes differently. The templates and examples have ids of their own now: `workerPool`, `readCache`, `rateLimit`, …
