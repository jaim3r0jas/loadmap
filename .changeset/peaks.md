---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/react': minor
---

A preset can say how long its moment lasts: `preset "Black Friday" { load: 12; lasts: 2h }` (language 1.7; `peaks` in
TypeScript). While its values are shown, the verdict says what that long leaves in each queue whose reader cannot keep
up, and how long the reader then needs to clear it at the default load: "After 2 h of Black Friday, 1.4M events wait
in the events topic, which at 1× clears in 5 h." `backlog(model, values, seconds)` gives it, by the sim's own rules (a
reader drains at its component's full, priority 1 first, a drop or a merge leaves less), and the sim builds the same.

Docs: /language/controls/#presets
