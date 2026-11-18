---
'@loadmap/dsl': minor
'@loadmap/cli': patch
'@loadmap/editor': patch
---

**`completions()` and `completionsAcross()` move to `@loadmap/dsl/completion`**: `import { completions } from
'@loadmap/dsl/completion'`. The main entry no longer exports them (their types `Completion` and `Completions` stay):
while it did, every bundler kept completion in the first load of a page that imports anything from `@loadmap/dsl`, and
the editor, which now loads it with its first list, starts about 7 kB lighter.
