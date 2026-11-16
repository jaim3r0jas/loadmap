---
'@loadmap/layout': minor
'@loadmap/react': minor
---

A long diagram folds to fill its room. Where its titles would be under 10 px in one row, `<Loadmap>` and
`useLoadmap` fold it into the fewest rows, three at most, that draw it at least 15 % larger (columns side by side,
running down), and choose the direction and the rows together. It unfolds once one row reads with ease again. Only
the room and the structure change the arrangement, never the load or a phase. `rows` holds a count: `rows={1}` never
folds.
