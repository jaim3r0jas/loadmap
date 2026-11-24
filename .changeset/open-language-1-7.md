---
'@loadmap/dsl': minor
---

Language 1.7 is open: 1.6 shipped in @loadmap/dsl 0.39.0, so what is new to read needs a version of its own. Its first
addition is the day: `7d` is seven days in seconds, as `2h` is two hours. A file stamped before 1.7 that writes one
gets an error that says "a day (7d) is from loadmap 1.7", with the fix that raises its first line. The VS Code
extension's grammar reads `7d` as one number. Every definition in the repository says `loadmap 1.7`, and the corpus
holds what 0.45.0 released.

Docs: /language/formulas/
