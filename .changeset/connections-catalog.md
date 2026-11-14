---
'@loadmap/core': minor
'@loadmap/dsl': minor
---

Catalog edition 2026-12: how callers connect to each component, from its documentation, as connection rules with
their sources (`kafka/consumer-group`, `valkey/cluster-slots`, `etcd/raft-leader`, …), and the documented defaults
of PostgreSQL's and MySQL's `max_connections` as figures taken by name only. A connection's `rule` takes a rule's
assign and owner where it writes none and cites its source; `rule(kafka, 'kafka/consumer-group')` in TypeScript,
`rule: "kafka/consumer-group"` in the language, with autocomplete. Edition 2026-11 stays as it was.
