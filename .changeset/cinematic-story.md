---
'@loadmap/core': minor
'@loadmap/dsl': minor
'@loadmap/react': minor
'@loadmap/export': minor
'@loadmap/cli': patch
---

Play tells the story on the diagram: the whole diagram first, then for each step a close-up on what it changes (the box
it points at and any box it reshapes, several framed together), the change, and the whole diagram again for the step's
`seconds`, with a short title on the board. A step's new `title` (`StoryStepDef.title`, `title:` in `.loadmap`) names
it there; without one the title says what changes ("Users 1× → 20×"). The camera runs on the engine's clock and moves
the view, never the board; with reduced motion it cuts. The component that runs out first wears a ring and a tag that
breathe while the story plays and once it is past the target.

`ref.playStory()` plays it on the engine's clock (`step()` advances it); `recordVideo({ story: true })` and
`loadmap record --story` record it that way, from the defaults, the same options giving the same file. The controller
gains `lm.cue`. A render React makes of older values no longer hands the engine their numbers.
