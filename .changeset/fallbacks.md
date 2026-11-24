---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/sim': minor
'@loadmap/layout': minor
---

A fallback: `fallback { after: api; route: staleQuotes }` on a flow (language 1.7; `fallback: { after, route }` in
TypeScript). What the flow fails for good, turned away or too slow after every retry, goes back to `after` and is
served along `route`: each fallback stage sees that rate (`ev.fallbacks.<flow>.rate`) and may run out like any other.
A lost box on the route counts none of it; one behind a fallback stage counts what that stage turns away. On the board
a failed dot fades where it failed and a dot sets out from `after` along its edge to the fallback, which needs that
edge (`missing-edge`). The budgets go to 74, 230 and 140 kB.

Docs: /language/building-blocks/#lost-units
