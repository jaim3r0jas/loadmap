---
'@loadmap/react': patch
---

A page's plain `.lm-canvas { height: … }` sets the canvas's height wherever its stylesheet stands: the default
height has no weight of its own. In a shadow root the canvas and the zoom buttons put their stylesheets in that root,
where they were unstyled.
