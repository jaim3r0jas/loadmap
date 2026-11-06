---
'@loadmap/core': minor
'@loadmap/layout': minor
---

No scenario, story step, preset or control moves a box any more. ELK lays out every box at the largest size it takes
anywhere the model reaches, and each box is drawn at its own size in the middle of that slot: a pool that gains pods
grows where it stands and its neighbours stay put. What it reaches: the defaults, each scenario, story step and
declared preset, and every combination of the controls (a range at each step, or at points across a long one); past
256 combinations, each control's options one at a time from each scenario, step and preset. Edges leave and enter a
box at the middle of its sides, and an edge that comes or goes (`when`) keeps its room. Values nothing declared
reaches (a combination past that bound that draws a box larger) lay out again, as before.

`model.stagesAt(values)` gives the stages and the context they resolve in, without the crossings and the verdict: what
a drawing needs, cheap enough to call for many values.
