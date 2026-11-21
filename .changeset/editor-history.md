---
'@loadmap/editor': minor
---

The editor keeps a history of the files with `history`: each version the reader keeps, each save and each definition
loaded is a commit, as git writes one. The Timeline panel lists them: Back and Forward draw an older version in the
canvas, Restore makes it the files again as a new version, "Branch from here" tries another design. `history={{ key }}`
keeps it in the tab's storage; the handle's `history()` gives it as data. The docs' editor keeps one for its tab.

Docs: /api/editor/#history
