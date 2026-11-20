---
'@loadmap/react': minor
---

`<Diagram canvas>` takes `reserve`: the part of its insets that is always there. The diagram is arranged for what
`reserve` leaves, so the rest of the insets (a panel the reader opens over the board) moves the view and never the
layout. Without it a canvas is arranged for what Fit has, as before.

Docs: /api/react/#the-pieces
