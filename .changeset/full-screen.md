---
"@loadmap/react": patch
---

Full screen fills the screen: the diagram as large as fits, the legend over it, and the verdict, the live meters and
the controls in a panel beside it (below it on a phone). Where the browser refuses full screen (an iPhone, a frame),
the page is covered instead; Esc or Close leaves. `<Loadmap>` now puts the verdict and the panels after the diagram
in a `div.lm-side`: CSS that selected them as children of `.lm` needs `.lm-side` in between.
