---
'@loadmap/dsl': patch
'@loadmap/editor': patch
'@loadmap/cli': patch
---

Completion ranks by what the model already says. In a route, the stages an edge joins to the last one come first; the
others come last and draw the edge they need when picked (in VS Code too, as an additional edit). `from:` offers the
nodes that run no stage first, an edge leaves out what is drawn already and offers where a route goes next first, and
`partitions`, `held` and a connection's `flows` offer the flows that pass there first. A box with one queue of another
name is offered once, by its stage, and a subsystem never next to its own boxes. Completion's code is an entry of its
own, which the editor loads the first time the text has the focus. The language server opens the list after `{` and `[` too.
