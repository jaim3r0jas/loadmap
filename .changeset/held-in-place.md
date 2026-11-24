---
'@loadmap/layout': minor
'@loadmap/react': minor
'@loadmap/editor': minor
---

In the editor, a box or an edge added to the text moves its neighbours and not the whole diagram: what is drawn next
is laid out from where the boxes are drawn, and **View → Tidy the diagram** (`tidy()` on the editor's handle) lays it
out as a reload draws it. `layout()` and `<Loadmap>` take the drawn scene as `from` for it. A page, a reload, a
recording and an export draw the layout from scratch, as before; so does a diagram with subsystems or folded into
rows. A scene says the `rows` it was folded into.

Docs: /api/react/#hold
