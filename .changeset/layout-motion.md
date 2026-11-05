---
"@loadmap/react": minor
"@loadmap/dsl": minor
"@loadmap/layout": minor
"@loadmap/export": patch
---

The diagram moves to a new structure instead of swapping it: when a scenario, a story step or a control adds pods,
brokers or partitions, the boxes that stay move and resize to their new places with their edges, what goes fades out,
and what is new fades in, its edges drawing in last. `<Loadmap transition={0.8}>` sets how many seconds it takes (0
cuts), and `transition: 0.8` in a `.loadmap` does the same in the editor, the docs and `loadmap record`; with reduced
motion it always cuts, and so does a board paused with nothing stepping it. The load never moves the diagram, as
before. The move runs on the engine's clock, so a recording shows it and stays the same file, byte for byte;
`handle.ready()` waits for each of its frames to be drawn, `board().scene` is the frame drawn, and `reset()` ends a
move. A `Scene`'s parts carry `fade` (and a new edge `draw`) only while it moves.
