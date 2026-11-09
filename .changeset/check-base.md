---
'@loadmap/core': minor
'@loadmap/cli': minor
---

`loadmap check --base origin/main` compares each definition with itself at a git ref, both against the same data
(`--pull` reads the measures of both). It fails when the first limit's headroom drops by more than `--tolerance`
(`10%` by default, or `0.5×`), when the first limit moves to another component without more headroom, or when a
component crosses the target or 100 % from below at today's load; each is an annotation on the component's line.
`--accept "<reason>"` turns them into warnings. `--comment <file>` writes the pull request comment (one sentence, what
fails, each component's headroom before and after, the assumptions with their sources) behind a marker; the guide
has a workflow that posts it and keeps it up to date, with fork pull requests checked against the committed
snapshot. `compareDefinitions(base, head)` in `@loadmap/core` is the comparison, and the JSON result and the job
summary carry it.
