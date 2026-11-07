---
'@loadmap/editor': minor
---

The code is a panel on the editor's left, built like the side panel on its right: the same header, frame and rail,
each resized by its inner edge and folded onto a rail, the diagram's canvas in the room between them (Fit frames it
there). The side panel resizes too (`panelWidth`, `onPanelWidth`), folds with › and unfolds from its rail with a
click; only where it cannot pin does its rail open it over the canvas, on a hover as before. A folded code panel's
rail counts the text's problems. Over the canvas, the scenarios and load, the story, the legend and the zoom share
one surface; the load sits beside its label and the story beside its buttons in a narrow canvas. In the side panel
each part drops its own box and heading for the section's, and the code's gutter takes the panel's surface.
