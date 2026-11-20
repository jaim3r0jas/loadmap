---
'@loadmap/react': patch
---

A page's plain `.lm-canvas { height: … }` sets the canvas's height wherever its stylesheet stands: the default
height has no weight of its own. `LOADMAP_CSS` holds the canvas's styles too, so a page that puts it in its `<head>`
for server rendering, or in a shadow root, has the canvas styled from the first paint.
