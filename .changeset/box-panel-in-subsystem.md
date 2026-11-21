---
'@loadmap/editor': patch
'@loadmap/dsl': patch
---

The editor's Box panel shows a box that is written inside a subsystem. It said "That box is no longer in the
definition": a box in a subsystem is one statement, perhaps in a library, for a box in every subsystem like it, and
none is written under the id the diagram gives it (`eu.api`). The panel now finds the statement by its place, says
which other boxes it also draws ("Written once for 2 boxes: a change here also changes us.api."), reads the parameters
and components of the subsystems around it, and tells what the box takes from the box it is like.
