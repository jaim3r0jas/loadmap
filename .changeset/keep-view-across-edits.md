---
'@loadmap/react': patch
'@loadmap/editor': patch
---

A new model or view keeps the board: the diagram moves from what it drew to the new structure, as it does between
scenarios, instead of starting again empty and fitted. The view the reader zoomed to stays, the box nearest its middle
held still on the board while the rest moves around it (between phases too), and a view the reader never moved stays
fitted. In the editor an edit keeps the zoom; a whole new text (a template, a shared link) still starts fitted.
