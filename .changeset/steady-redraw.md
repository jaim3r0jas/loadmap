---
'@loadmap/react': patch
'@loadmap/editor': patch
---

A subsystem the reader opened or closed stays so when a new version of the model is drawn (the text edited, another
`view` handed to `<Loadmap>`): only its own control closes or opens it, and a page's `closed` still says how each one
starts. In the editor, a click on a box that another file declares opens that file and no longer draws the diagram
anew: the subsystem stays open, no box moves, the view and the selection stay.
