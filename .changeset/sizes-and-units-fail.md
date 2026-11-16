---
'@loadmap/dsl': minor
'@loadmap/cli': minor
'@loadmap/vscode': patch
---

Sizes, from `loadmap 1.2`: `KB`, `MB`, `GB` and `TB` after a number count in bytes, and a demand written with one is
brought to the size its capacity counts in. `demand: flows.alerts * 1.5KB` against `estimated(20, "MB/s", …)` is
megabytes a second, with no `/ 1000` to forget; a size against a capacity that names none is an error.
`loadmap check --units fail` fails the run on a unit that disagrees (`unit-mismatch`), as `--inconclusive fail` does
for an expectation that is not sure.
