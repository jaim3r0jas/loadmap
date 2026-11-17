---
'@loadmap/core': minor
'@loadmap/dsl': minor
---

Catalog edition 2027-01: the figures of 2026-12, with each component's `box` the one its stage lives in. RabbitMQ is a
cluster (a queue lives only in one); etcd, CockroachDB, OpenSearch, MongoDB, Kubernetes and Istio are nodes (a cluster
holds nothing but queues, and a pool is its own workers). Add → From the catalog writes that box running its kind's
stage instead of a plain node with `demand: 0`: a queue for Kafka and RabbitMQ (as many members as the run's brokers
or nodes), a cache for Valkey, a store or a pass for a database, a pass for a proxy. It can put the box on flows'
routes, with the edges each hop needs (an edge no route takes any more goes) and a connection rule such as
`kafka/consumer-group`, and writes its demand in the figure's unit: for Kafka, what reaches the queue at the run's
message size. A demand in bytes against a published capacity is brought to the figure's unit, where it was an error.
