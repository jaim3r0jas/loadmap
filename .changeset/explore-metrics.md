---
'@loadmap/providers': minor
'@loadmap/cli': minor
'@loadmap/dsl': minor
---

An assistant can look in the reader's metrics before it writes a metric: `prometheusExplorer`, `explorersFromEnv` and
`runExplore` in `@loadmap/providers` answer `search`, `labels` and `try`, read only and capped. `loadmap explore`
runs one look; `loadmap ask --explore` runs the looks the model asks for and sends back what they read. The
assistant's protocol has an `explore` block, and `contextText` says which stores the page can read.

Docs: /live-data/#with-your-own-prometheus-or-grafana
