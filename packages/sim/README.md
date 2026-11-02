# @loadmap/sim

The fluid queue simulation behind [loadmap](https://jaim3r0jas.github.io/loadmap/)'s moving dots: priorities, drop
rules, workers filling up, seeded randomness so a recording is the same every time. It never has capacity numbers of
its own: a stage drains what its flows carry at the load where its component is full. Used by `@loadmap/react`; you
rarely need it directly. MIT.
