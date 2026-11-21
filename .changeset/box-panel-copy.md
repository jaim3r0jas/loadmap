---
'@loadmap/editor': minor
'@loadmap/dsl': patch
---

The editor's Box panel changes a box of one copy of a subsystem in that copy's `with`: **This copy** shows the inputs
that reach the box, as the copy sets them or as their default, and a change writes the copy's line (or a new one, or a
`with` block). The definition every copy shares is read-only until **Change the definition every copy shares** is
ticked.

Docs: /using-the-editor/#sharing-and-the-inspector
