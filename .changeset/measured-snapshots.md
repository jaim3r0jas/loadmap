---
'@loadmap/core': minor
'@loadmap/react': minor
---

Measured data reaches a model as a snapshot: a JSON file with each measurement's value, its points and its origin
(the provider, the query, the window, the step, when it was read, how many samples). `@loadmap/core/measure` (and
`@loadmap/react`) has `parseSnapshot`, which checks an opened file as untrusted input, and `fromSnapshot`, whose
`capacity`, `value` and `fit` read it inside model functions and fall back to the definition's own value, with why,
when a measurement is missing or has fewer samples than its `min`. A capacity read so is `measured`, its `origin` and
source say where it came from; `defineModel({ snapshot })` lists every measurement with the assumptions, and the
Assumptions panel shows them. `MEASURES` is the standard set of measurements per kind (flow, pass, queue, workers,
cache, limit, store, fan-out, and the split and slots to come), each with its role, unit and what it sets;
`summarize` turns a window into one value. `docs/dsl.md` has the table and the format.
