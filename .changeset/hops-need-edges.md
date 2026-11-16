---
'@loadmap/core': minor
'@loadmap/layout': minor
'@loadmap/dsl': minor
---

Dots move only along edges. Every hop a flow takes needs an edge drawn the way it goes: from its `from` node to its
first stage, along its route, on each way of a split (and where a way rejoins the route), and from a fan-out to each
stage it copies to. A hop without one used to draw its dots straight across the diagram; now `defineView` throws
(`flow "signups" goes from node "gateway" to node "api" with no edge between them: add edge('gateway', 'api')`) and
the language reports an error at the hop from `loadmap 1.1` on (a warning in a file stamped before, whose dots still
cross straight), with quick fixes that add the edge or route the flow through the boxes the
edges already join. The edge must point the way the flow goes: one drawn the other way round no longer carries a
route's dots (a cache's answers still go back along the edge they came in on). An edge a flow takes that its `when` hides at the defaults, in a preset or a scenario is a warning.
To move a file over: apply the quick fix in the editor or VS Code, or add the edge `loadmap check` names.
`model.stagesAt()` also returns each flow's ways (`paths`).
