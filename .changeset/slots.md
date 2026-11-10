---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/react': patch
---

A component can count slots instead of a rate: `held` (seconds a unit holds a connection, a session, a thread) makes
its demand the slots in use by Little's law, what reaches its stages times `held`, one time for every flow or one per
flow; `on` names the stages for a pool beside the limit that runs them. `held: 0.02` or `held { orders: 0.02 }` in the
language. The `slots` measurements set its capacity and its time held.
