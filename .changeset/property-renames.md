---
'@loadmap/core': minor
'@loadmap/sim': minor
'@loadmap/dsl': minor
'@loadmap/providers': minor
'@loadmap/cli': patch
'@loadmap/editor': patch
---

New names for words that meant two things. In `expect`, `target: 7` and `full: 50` were load multiples while
`thresholds` and `autoscale` use `target` for a utilization; they are now `underTarget: 7` and `notFull: 50`
(`underTarget: 7×` reads well). A metric's `min` (a sample count) is `minSamples`, a workers stage's `fill` (a
placement, not a colour) is `placement`, and a connection's `max` (a capacity) is `accepts`. The new names are from
loadmap 1.1. In a `loadmap 1.1` file the old ones still work and warn ("target is now underTarget"), with a quick fix
that renames them, and `loadmap fmt` rewrites them; in a `loadmap 1` file they are that version's spelling, read as
before, with no warning. TypeScript follows: `Expectation.underTarget` and `notFull`, `ConnectionDef.accepts`,
`workers(…, { placement })` and `PullRequest.minSamples`, with the old names kept as `@deprecated`; a resolved workers
stage and `compile(…).measures` give `placement` and `minSamples`. A snapshot file still says `min` beside its
`samples`. A stage without a label now takes its component's `short` when no other stage runs that component, so the
sentences and meters say "the gateway" without a second `pass "the gateway"`.
