---
"@loadmap/react": minor
"@loadmap/dsl": minor
"@loadmap/editor": patch
"@loadmap/cli": patch
---

Full screen shows the diagram as wide as the screen, and below it every panel of the page: the verdict, Live and
where it runs out beside the controls, then the headroom chart, the scenarios compared and what it assumes; the whole
view scrolls, and the diagram never moves with the load. `<Loadmap fullScreen={['verdict', 'live', 'controls']}>`
keeps only the panels it lists (`LOADMAP_PANELS`, type `LoadmapPanel`), and `fullScreen: [verdict, live, controls]`
in a `.loadmap` does the same in the editor, the docs and `loadmap record`. A diagram in a narrow column turns to run
left to right in full screen. Scrolled down to the panels, Close waits in the corner. `<Loadmap>` now wraps each
panel in a `div.lm-panel` (`data-panel` names it), and `.lm-more` is gone: CSS that selected a panel as a child of
`.lm-side` needs `.lm-panel` in between.
