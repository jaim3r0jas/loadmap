---
'@loadmap/core': minor
'@loadmap/react': patch
'@loadmap/cli': patch
---

Connections: `connections` in a model says how a stage reaches the next one on a route. `assign: 'exclusive'` gives each
partition of the queue in front (or each of `parts`) one owner among the pool's workers or pods (or `members`): a Kafka
consumer group. The component then runs out when its busiest member does: its utilization carries the spread (the
busiest member's share of the work × the members), `ev.components[c].spread` says why, and owners left without a
partition are named. `owner` and `capacityPer` (worker or pod) say what owns a part and what the capacity divides over;
`flows` picks the flows it covers. An autoscaler still reads the plain utilization. `shared` (the default) changes no
number. Each connection is listed with the assumptions.
