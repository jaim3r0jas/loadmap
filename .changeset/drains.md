---
'@loadmap/core': minor
'@loadmap/layout': minor
'@loadmap/sim': minor
'@loadmap/react': minor
'@loadmap/dsl': minor
---

Drains: a box for what other boxes lose, counted. A unit a stage turns away (a limiter, or a pass, cache or split past
capacity), one a queue drops as too old, or one too slow for its client used to fade where it was; with a drain, its
dot goes along the edge into the drain's box and fades there. In the language, `node tooMany "Turned away" { drain }`
and an edge `limiter -> tooMany`: the edge says what goes there, and `reason: [rejected]` keeps only some losses
(`rejected`, `dropped`, `timedout`). In TypeScript, `drain({ from: ['limiter'], reason: ['rejected'] })`. `at.tooMany`
is what is lost there for good, after every retry, and the box says it on its second line ("500 rejected/s"); it is
drawn dashed in the colour of a loss (`--lm-drain-fill`, `--lm-drain-line`), and so is the edge into it. A merge loses
nothing: a merged dot now shrinks into a ripple of its flow's colour instead of fading grey, and the legend says
"merged, newest kept".
