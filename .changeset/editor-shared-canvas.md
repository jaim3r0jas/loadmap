---
'@loadmap/editor': minor
'@loadmap/react': minor
---

**The editor's diagram is the canvas every loadmap is.** With `fill`, the diagram beside the code is `<Loadmap fill>`:
the scenarios in a bar over it, the load and the verdict in one line under it, and the limits, the design, the
headroom, the live meters and the assumptions in panels that open one at a time from their tabs (a rail, a row over
the console, or a panel kept open from 1280 px of canvas). The editor's own side panel is gone, with its rail, its pin,
its resize and its hover, and so is the phone's sheet with its three heights: on a phone a tab opens its panel as a
sheet on the console. While the code is hidden the inspector is the first tab, **Inspect**: a click on a box opens it,
once for each box, and it no longer shows before a box is picked unless the canvas keeps a panel open. The note that
the diagram is the last version without errors lies over the canvas, under its bar.

Removed from `<LoadmapEditor>`: `panel`, `onPanel`, `panelWidth`, `onPanelWidth` and the type `PanelMode`; a page that
passes them no longer compiles, and has nothing to keep in their place. The classes `.lme-canvas`, `.lme-panel`,
`.lme-sheet`, `.lme-over` and `.lme-sec` are gone: the canvas's own are `.lm-canvas` and the rest (Styling). The dot
grid's `data-grid="off"` is on `.lme-preview`.

`<Loadmap>` takes `children`: each `Canvas.Panel` among them is a panel of the page's own, its tab before the
loadmap's, and anything else is drawn over the canvas. `open` and `defaultOpen` take such a panel's id.

Docs: /using-the-editor/#the-canvas-and-the-panels
