---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/cli': minor
---

Every expectation ends pass, fail or inconclusive (`check()` gives `outcome` and `reasons`; `ok` is a pass).
Inconclusive is an answer that rests on what is not known: it holds at the high edge of a ± but not at the low one, a
component has no published benchmark, or measured data it reads is missing or too thin. `expect { …; severity: warn
}` is reported and never fails a run. `loadmap check` reports an inconclusive expectation as a warning (it failed
before when only a ± or a missing benchmark decided it); `--inconclusive fail` fails on it. `--pull` reads the
measures first and checks against them, `--snapshot <file>` against a snapshot already written, `--dry-run` reports
everything and exits 0, `--json <file>` (and `--format json`) writes the run's result keyed by the commit, and under
GitHub Actions a table of the expectations goes into the job summary.
