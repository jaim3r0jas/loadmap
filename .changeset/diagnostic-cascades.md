---
'@loadmap/dsl': patch
'@loadmap/core': patch
---

One mistake, one mark, where it is. A flow's timeout without latency is marked at its `timeout:` line, and a lost box
on a flow's route at its name there, instead of at the first line of the file (core says which property of the flow an
error is about). The marks a mistake caused further on are gone: an unknown function no longer also says its arguments
must be constants; a misspelt keyword (`nod api`) no longer marks every use of `api`; a second stage in a node, a bare
capacity, a value that does not parse and a list with a wrong word (`takes: [rejectd]`) are marked once, without "is
declared twice", "needs capacity" or "loses nothing" after them. A warning where an error starts goes.
