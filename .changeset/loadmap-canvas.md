---
'@loadmap/react': minor
---

**`<Loadmap>` is one canvas.** Everything it draws is in one box whose height the page gives (`.lm-canvas`, by
default `clamp(420px, 70dvh, 760px)`): the title, the scenarios and the story's button in a bar over the diagram, the
load and the verdict in one line under it, and the limits, the design, the headroom, the live meters and the
assumptions in panels that open one at a time from their tabs. The canvas arranges itself by its own size (tabs as a
rail, a row or a menu; the panel beside the diagram, or a sheet under 520 px), the diagram always pans and zooms, and
nothing the reader does lays it out again or changes the box's height. Full screen is the same canvas at the
screen's size, with one panel kept open from 1280 px.

What changes for a page:

- `<Loadmap>` no longer grows with its panels: it has a fixed height. Set `.lm-canvas { height: … }`, or `fill`.
- `panels`, `open`, `defaultOpen` and `onOpen` choose and drive the panels; `chrome="least"` opens full screen (and
  a root that fills) with the diagram, the load and the verdict alone. `fullScreen` and `fullScreenMode` still work
  and say in the console that they are `panels` and `chrome` now; `zoom` is no longer needed.
- `LOADMAP_PANELS` is the five tabs: `limits` (with the verdict's sentence), `controls`, `headroom` (with the
  scenarios compared), `live`, `assumptions`.
- Gone from `<Loadmap>`: the dock of compact cards and the drawer of full screen, focus mode's layout, and the
  classes of the old page (`.lm-loadbar`, `.lm-side`, `.lm-panel`, `[data-out]`, `.lm-line`, `.lm-dock`, `.lm-mini`,
  `.lm-drawer`). A page that wants every panel on the page at once composes it from the parts, as before:
  `useLoadmap`, `LoadmapRoot`, `LoadBar`, `Story`, `Diagram` and the panels.
- New for a layout of your own: `Canvas` with `Canvas.Bar`, `Canvas.Console` and `Canvas.Panel`, `useCanvasSize`,
  `useCanvasPanels`.
- A `.loadmap` file's `fullScreen` and `fullScreenMode` keep their meaning: the panels a page offers, and what stands
  around the diagram in full screen.
- `loadmap record` draws the board as before: its recordings do not change. A recording made from a page that draws
  `<Loadmap>` takes the canvas's room, so its size can differ from one made before.

Docs: /api/react/#the-canvas
