---
'@loadmap/layout': minor
'@loadmap/react': minor
'@loadmap/dsl': minor
---

A subsystem is drawn: a frame around its boxes with its name at the top, a subsystem in another as a frame in that
one's frame, its line in the colour of the worst box inside once one is past its target. Until now a subsystem's boxes
stood loose on the board and its name showed nowhere. A view takes `subsystems` (`{ eu: { label: 'EU region' },
'eu.orders': { label: 'Orders' } }`) and what one holds is named `<id>.<name>`, as in a definition's text (the box
`eu.orders.topic` stands in `eu.orders`, which stands in `eu`); the scene lists the frames as `scene.subsystems`, and `collisions()` also reports a frame that does not hold its boxes or reaches another's.
A `.loadmap` needs nothing new: every `subsystem` gets its frame, in any language version, and the boxes inside are
laid out together. With tiers, a subsystem whose boxes stand in several tiers has no frame (a frame cannot cross a
lane); the subsystems in it keep theirs. `loadmap bundle` keeps a subsystem's first line (`subsystem orderLine
"Orders"`) so the flat copy draws the same frames.
