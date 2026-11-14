---
'@loadmap/core': minor
'@loadmap/sim': minor
'@loadmap/dsl': minor
---

Connections on the stage they reach: `assign: 'key'` sends each unit to the part its key hashes to, partition i of
each flow on member i mod `members`, and the busiest member bounds the stage; `skew` puts a share of a flow on its
hottest part, and the sim sends that share of the dots there; `assign: 'leader'` sends every unit to one member. A
published capacity keeps its number, and the limits list says why. In the language a cluster's queue takes the
cluster's members. A connection's spread reads the flows' rates only when several share a stage.
