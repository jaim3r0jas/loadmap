---
'@loadmap/editor': minor
---

Two more starters in New: **Sharded store** (writes split across shards by key, so the hottest shard runs out first)
and **Slow partner API** (a partner that slows as it fills, a client timeout, and retries that add load when it is
slowest). Each compiles clean, keeps its expectations and lays out without a collision, like the ten before them.

Docs: /examples/#starters
