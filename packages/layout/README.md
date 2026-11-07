# @loadmap/layout

Views for [loadmap](https://jaim3r0jas.github.io/loadmap/) models (`defineView`, `node`, `cluster`, `pool`, `edge`) and
their layout with ELK: boxes, orthogonal edges, labels sized for their widest text and boxes for their largest over
the load range, so the load never moves the diagram and no label covers another. Each scenario, story step, preset
and choice of a select or switch is laid out on its own (`layout: 'compact'`, the default), over the load and every
range control, and `morph` moves the boxes from one to the next; `layout: 'stable'` lays out each box at its largest
anywhere the model reaches, so none of them moves a box. Tiers cut the diagram into labelled bands across the flow.
`layout()` takes an ELK engine; by default it imports ELK on first use. `@loadmap/react` re-exports the view API and
runs ELK in a Web Worker. MIT.
