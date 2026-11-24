---
'@loadmap/layout': minor
'@loadmap/react': minor
'@loadmap/editor': minor
---

In the editor, a box or an edge added to the text moves its neighbours and not the whole diagram: a new version of the
model is laid out from where its boxes are drawn, and **View → Tidy the diagram** lays it out as a reload draws it.
`<Loadmap hold>` turns it on for a page that edits a model (`tidy()` on the handle and the controller, `held` on the
controller), and `layout()` takes the drawn scene as `from`. A page, a reload, a recording and an export draw the
layout from scratch, as before; so does a diagram with subsystems or folded into rows.

Docs: /api/react/#hold
