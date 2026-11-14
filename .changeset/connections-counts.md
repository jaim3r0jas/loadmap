---
'@loadmap/core': minor
'@loadmap/dsl': minor
---

Connections count what they hold open: `open` is the connections each member of the pool on the hop keeps to the
other side, and `max` the most that side accepts. Together they make a limit named by the connection, "Connections
to db": the members running times what each keeps open, added up over every connection into the stage, so an
autoscaled pool that opens more as it grows runs out at a load. `open` and `max` in the language too.
