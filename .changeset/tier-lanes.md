---
'@loadmap/layout': minor
'@loadmap/react': minor
'@loadmap/dsl': patch
---

Tiers are drawn as lanes. Each tier has a header at its start, a strip across the top (running down, and on a phone, a
column on the left, the name reading up), with its name in capitals; a line between the lanes, and every other lane
shaded. A name wider than its lane takes two lines, and every header on that board takes two; only past two lines is it
cut short with "…". The layout reserves the header's room, so no box or edge label sits under one: `collisions()`
checks the whole header. Export, posters and the editor draw the same lanes.

`SceneTier` has `head` (the header's box), `lines` (each line of the name with its spot; a line that comes or goes in
a morph fades) and `spacing`, in place of `text` and `spot`. Four theme tokens colour the lanes: `--lm-tier` (a shaded
lane), `--lm-tier-head`, `--lm-tier-fg` (the name) and `--lm-tier-line` (the dividers).
