# @loadmap/layout

Views for [loadmap](https://jaim3r0jas.github.io/loadmap/) models (`defineView`, `node`, `cluster`, `pool`, `edge`) and
their layout with ELK: boxes, orthogonal edges, labels sized for their widest text so the load never moves the
diagram and no label covers another. `layout()` takes an ELK engine; by default it imports ELK on first use.
`@loadmap/react` re-exports the view API and runs ELK in a Web Worker. MIT.
