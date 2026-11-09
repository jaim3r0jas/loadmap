---
'@loadmap/core': minor
'@loadmap/react': minor
'@loadmap/export': patch
---

A component catalog: `published(kafka, { brokers: 3, … })` is a fourth kind of capacity, the figure published for a
component (Apache Kafka, RabbitMQ, Valkey, etcd, CockroachDB, ClickHouse, NGINX, HAProxy, CoreDNS, Kubernetes, and
more) under the conditions it was run with, its source linked, its version and who ran it kept as metadata. The data
is `@loadmap/core/catalog` (or `@loadmap/react/catalog`), off every first load; editions pin the numbers. A figure is
a best case (a `margin` only lowers it), a published limit is exact, and a configuration no run matches gets no number:
the component is not ranked, the verdict says why, and an expectation that depends on it fails.
