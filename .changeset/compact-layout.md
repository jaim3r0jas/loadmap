---
'@loadmap/layout': minor
'@loadmap/dsl': minor
---

Each scenario, story step, preset and choice of a select or switch is laid out on its own by default (`layout:
'compact'` on the view, `layout: compact` in a `.loadmap`), over every load and every value of the range controls, and
the boxes move from one to the next: a long story no longer pays for its largest step in every step. Dragging the load
or a range control still never moves a box, and a step looks the same whichever came before. `layout: stable` keeps
the old promise that no phase moves a box. In a stable layout, an edge whose `when` turns on partway up the load range
no longer moves the boxes when the load reaches it.

In the language the direction is now `direction: right | down`; `layout: right` and `layout: down` still work, with a
warning, and `loadmap fmt` rewrites them. A `<Loadmap>` page loads 0.4 kB more; its budget is 51.5 kB.
