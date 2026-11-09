---
'@loadmap/editor': minor
'@loadmap/dsl': patch
---

The editor adds from the catalog: New → Add → From the catalog picks a component, the conditions of one of its
published runs and shows the figure they give, with its source, or says there is none. It writes text only: a
`published` statement, and a new box or the selected box's capacity. `catalog={false}` leaves it out. In the reader layout, the inspector shows a
published statement's conditions as the values its runs used. A constant `demand: 0` now compiles (it read as missing,
and `demand: 5` failed to evaluate).
