---
'@loadmap/editor': minor
'@loadmap/dsl': minor
---

The editor's Ask panel (`assist`): a conversation about the diagram with a model the reader picks and their own key,
kept in the page's memory or the tab only. Its changes come as proposals the compiler has checked, drawn in the canvas
with a diff per file and the capacities they write; Accept puts one in the text as an undo step per file and, with
`history`, a version that keeps the request and the operations. `diffLines` in `@loadmap/dsl/assist` is the line diff
the panel and `loadmap ask` show. The docs' editor offers it, and its policy allows the providers it lists.

Docs: /api/editor/#ask
