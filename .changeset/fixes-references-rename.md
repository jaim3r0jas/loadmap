---
'@loadmap/dsl': minor
'@loadmap/editor': minor
---

Snippets, quick fixes, go to definition, references and rename. A statement typed at the start of a line completes as
a snippet built from the schema: its id and label, its required properties, and for a box a stage and a capacity.
`quickFixes(source, diagnostics)` gives each diagnostic's fixes as text changes: the did-you-mean applied (a name, a
property, a scenario), a missing required property added in the block's own layout, a bare number made
`estimated(…)` or `measured(…)` in the file's unit, a stray ":" before an edge's block dropped. `definition` and
`references(source, offset)` find where a name is declared and every place it is written, and `rename(source, offset,
name)` renames it everywhere: a box's id with the stage and the component that take it, a scenario's label quoted
where it must be; it refuses a name that is not one, is reserved or taken, and a result that would not compile.

In the editor: a diagnostic's tooltip offers its fixes, F12 or a click with Cmd or Ctrl goes to the declaration, the
other uses of the name under the cursor are marked, and F2 (or Rename over a phone's keyboard) opens a field to rename
it. The editor's budget is 170 kB.
