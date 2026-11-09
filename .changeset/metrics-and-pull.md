---
'@loadmap/dsl': minor
'@loadmap/cli': minor
'@loadmap/providers': minor
'@loadmap/vscode': patch
---

The language maps a model onto measured data, and `loadmap pull` reads it. A `metric` is a query written once
(`prometheus { query: '…{{ args.job }}…' }`, with a `stat` and a `min` of samples); a `measure` is one use of it,
with its arguments and a `fallback`, and its id is a capacity or a number as its fallback is (`capacity: apiCapacity`,
`rate: orderRate * load`). A `fit` with `x` and `y` naming two measures is fitted from their series. `compile(source,
{ snapshot: fromSnapshot(parseSnapshot(text)) })` reads a snapshot; without one every measure is its fallback, and
`compile(…).measures` lists each query with its arguments filled in. The checker names an unknown metric, an argument
a query needs or never uses, a fallback that is neither a capacity nor a number; completion, hover, rename and the VS
Code grammar know the new statements. The new `@loadmap/providers` reads Prometheus (`/api/v1/query_range`, one
series per query, errors as data) and writes the snapshot (`pull`); `loadmap pull x.loadmap [--window 7d] [--step
5m] [--to …]` writes `x.snapshot.json` next to the definition, with the address and the credentials from
`LOADMAP_PROMETHEUS_URL` and `LOADMAP_PROMETHEUS_TOKEN` (or a user and password), never from the text.
