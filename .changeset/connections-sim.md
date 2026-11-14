---
'@loadmap/core': minor
'@loadmap/sim': minor
'@loadmap/react': minor
---

Connections on the board: behind an exclusive connection each unit goes to the worker that reads its partition, a
worker is as busy as its partitions make it, one that reads none stays idle and is drawn dashed, and a partition a
quieter worker reads waits less of the queue's lag. `ev.stages[pool].assignment` gives the worker of each partition
and each worker's share of the work. The latency times each group of workers at its own utilization, instead of
every unit at the busiest one's.
