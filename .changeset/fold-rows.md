---
'@loadmap/layout': minor
---

`layout()` takes `rows`: a long diagram folded into that many rows one under the other (columns side by side, running
down). The cuts fall between layers, between two tiers rather than inside one where the rows stay about as long; an
edge to the next row goes round the end of its row on a track of its own, and each row has its own lanes. The load
never moves a folded diagram either, and a stable layout keeps every box in place. The fold loads with the first
diagram that asks for one.
