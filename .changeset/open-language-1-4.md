---
'@loadmap/dsl': minor
'@loadmap/react': patch
---

Language 1.4 is open: 1.3 shipped in @loadmap/dsl 0.34.0, so what is new to read needs a version of its own. Every
definition in the repository says `loadmap 1.4`, and the corpus holds what 0.34.0 released. `rows` takes no unit
(`rows: 200%` is refused), and a narrow screen never folds, whatever `rows` says: columns side by side would each be
narrower still. The options of a compiled definition may now say `direction: 'auto'` and `rows`; pass them on with
`pageOptions()`.
