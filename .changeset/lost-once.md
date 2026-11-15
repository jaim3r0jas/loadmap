---
'@loadmap/core': patch
'@loadmap/dsl': patch
'@loadmap/sim': patch
---

A unit is lost once. A flow with a `drop` rule and a `timeout` counted what its queue dropped again as timed out, so a
lost box (and `at.<box>`) could show more units a second than the flow sends; with `retry` the dropped units were sent
again too. Now a dropped unit is lost at its queue, never sent again and never too slow, as the dots already showed.
The losses are counted way by way: a split's ways and a cache's answers no longer share one "got through" figure, a
queue on several ways drops on each, and a pass, limit or cache that reads a dropping queue turns away only what still
reaches it, in the dots too. Checking the lost boxes walks each flow's ways once.
