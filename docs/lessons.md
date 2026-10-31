# Lessons from a hand-built capacity page

Before loadmap there was one page built by hand: an SVG diagram, a canvas of moving dots and a small JS model, about
600 lines. It answered its question well. These are the lessons it left, stated generically; each names where
loadmap answers it.

## What worked, and stays

- **One model function, utilization per component, `null` for "switched off".** → `defineModel`, `when`.
- **Crossings by bisection over the load multiple, ranked by the 50 % crossing, the first limit marked.**
  → `crossing()`, `ranked`, `firstLimit`. loadmap adds a coarse scan first, so a utilization that does not rise
  steadily is not mis-bisected.
- **A three-tier verdict sentence** (past capacity / above target / all clear). → `verdict`.
- **Presets computed from the model** ("50 % target · 37×", "runs out · 52×"). → derived presets.
- **Dots are a picture of a fluid model, not a simulation of their own.** A backlog with lag = backlog ÷ capacity
  drove the meters; dots were sampled from it, with "one dot ≈ N" rounded to a 1-2-5 step and the dot rate clamped.
  → `@loadmap/sim`. loadmap keeps arrival cohorts, so the lag is the real age of the oldest unit and drop rules are
  exact.
- **Workers fill round-robin across pods**, shuffled inside a pod, at 70 % before the next one takes work.
  → `fillOrder`, `busyOf`.
- **Higher-priority work takes capacity first; the rest gets what is left.** → flow `priority`.

## What cost the time, and loadmap removes

- **Every coordinate and every label offset placed by hand** on a fixed canvas; grids fitted by trying cell sizes.
  This was the largest cost. → ELK places the boxes, edges and edge labels; loadmap packs the grids and sizes each
  label for its widest text, and a test fails on any overlap.
- **Dot paths as a state machine with numbered stages.** → routes through named stages; dots follow edge geometry.
- **Components that affect each other** (a store past 70 % slowing a consumer) **wired by hand.** → a lazy context
  where any model function may read any other, and a loop is an error that names it.
- **Each control wired by hand to "rebuild the diagram", "recompute" or "only reset the dots".** → the layout follows
  a structure key; values re-evaluate; the sim keeps its backlog across changes.
- **Sentence grammar by string tricks** (choosing "run" or "runs" from a name). → `short` and `plural` per component.
- **Phone width scaled the whole drawing down**, text included. → below 640 px the layout runs top to bottom.
- **Calibrated constants inline, their provenance only in prose.** → `fitLinear`, `measured`, `estimated`; the
  assumptions list is generated.
- **Colours read from CSS on every frame.** → read once per theme change.
- **Recording by screencasting a live page.** → `recordVideo` steps a fixed clock and encodes each frame at its own
  timestamp; two runs give identical frames.
