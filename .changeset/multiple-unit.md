---
'@loadmap/dsl': minor
---

`%` and `×` are checked where a property says which it takes. `expect "x" { underTarget: 70% }` passed as 0.7× and
`thresholds { target: 7× }` compiled; both are now `unit-mismatch`, with what to write instead: an error in a
`loadmap 1.2` file, a warning marked "(an error from loadmap 1.2)" in an older one, which computes as before. A load
multiple goes in `underTarget`, `notFull`, the load's `min`, `max` and `default`, and `load` in a preset or a step.
