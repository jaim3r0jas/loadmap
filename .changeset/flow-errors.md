---
"@loadmap/core": patch
"@loadmap/dsl": patch
---

A flow whose rate is a constant (`rate: 20 / 86_400`, or `rate: 40` in TypeScript) compiles and runs: it stays the
same at any load. An error raised while computing a flow now points at that flow, not at the formula that happened
to read it first; a preset or a scenario that breaks it keeps pointing at the preset or the scenario. An error that
only loadmap's own code can cause, such as a TypeError, says it is a bug in loadmap and how to report it, with the
original text as the hint, instead of showing loadmap's internal names; one from a host function is that function's.
