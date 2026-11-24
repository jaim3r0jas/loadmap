---
'@loadmap/core': minor
'@loadmap/dsl': minor
---

Language 1.8 is open: 1.7 shipped in @loadmap/dsl 0.46.0, so what is new to read needs a version of its own. Its first
addition is an expectation on what is lost: `expect { flow: orders; lost: 0.1%; underTarget: 5× }` holds while the flow
loses at most that share of what it sends for good (turned away, dropped by a queue or too slow for its timeout, after
every retry and after what its fallback serves), up to that load multiple or, without one, at the scenario's values.
Without a `flow` it holds for each flow. A failure names the flow, the share and where most of it goes. In code the
same figures are `ev.lost.<flow>` (rate, share and each stage's part) and `model.lost(values, bound, flows)`. A file
stamped before 1.8 that writes `lost` in an expect gets the error that says so, with the fix that raises its first
line. Every definition in the repository says `loadmap 1.8`, and the corpus holds what 0.46.0 released.

Docs: /language/how-sure/
