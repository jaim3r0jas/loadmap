---
'@loadmap/core': minor
'@loadmap/layout': minor
'@loadmap/react': minor
'@loadmap/dsl': minor
---

A subsystem can be drawn closed: one box that stands for everything inside it. The box takes the colour of the worst
component inside, names the busiest one on its second line, and wears the limit when the first limit is inside, so a
board of closed subsystems says which one to open. The reader opens one with a click on it and closes one with a click
on its name (the frame's name is a button now, with the mark of an open folder). Language 1.5 reads `closed` in `view`
(`view { closed: [eu, us] }`: the ones the page starts with) and in a `step` (its own; `closed: []` for every one open).
In code: `<Loadmap closed={[…]}>`, `closed` on a story step, `setClosed(ids)` on the controller, and
`closed` among the options of a compiled definition, which `pageOptions()` passes on. Closing changes no number: the
dots still pass every stage inside. What closes and draws them is loaded with the first diagram that has a subsystem.
