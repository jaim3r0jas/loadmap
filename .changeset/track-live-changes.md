---
'@loadmap/editor': minor
'@loadmap/react': minor
---

**Track live changes** in the editor: a button in the code panel (`track`, `onTrack` for a page to keep it). On, once
an edit is drawn and the text rests half a second, the board brings the boxes it changed into view, at the same zoom
and further out only as far as it takes, and marks them with a short glow: a box whose lines the edit is in, one a
changed line names (an edge, a route), one that is new or another size, the ends of an edge that came or went. Off,
the view stays where the reader left it. `LoadmapHandle.show(ids)` brings boxes into view on a board that zooms.
