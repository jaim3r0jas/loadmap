---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/cli': minor
'@loadmap/react': patch
---

Latency as an output: `service` on a component (the seconds a unit takes when nothing waits) makes each stage it runs
a queue whose time grows as service ÷ (1 − utilization); a flow's time through is the sum of its stages, fitted to a
gamma per way and mixed over its ways, and `ev.latency` gives its mean, p50, p95 and p99. An expectation holds a
percentile under a time, `{ flow: orders; p99: 0.5; target: 8 }`, on the pessimistic edge; `loadmap check --base`
shows each flow's p99 against its base, and the Live panel each flow's p99.
