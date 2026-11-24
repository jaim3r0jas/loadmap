---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/sim': minor
---

Shedding by priority: `pass { shed: priority }` (language 1.7; `pass('gw', { shed: 'priority' })` in TypeScript). Past
capacity the pass lets through as much as ever, but the flow with the smaller `priority` number first, so priority 1
keeps going while there is room for it. Each flow's share is on the stage (`shedBy`), and the dots, the lost boxes and
the retries follow it.

Docs: /language/building-blocks/#lost-units
