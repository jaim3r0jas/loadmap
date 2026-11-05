---
"@loadmap/react": minor
"@loadmap/dsl": minor
"@loadmap/editor": patch
"@loadmap/cli": patch
---

Full screen fits the screen without scrolling. The diagram stays on top, as wide as the screen; under it the verdict in
one line (the load, how far the target holds, the first limit, how sure its capacity is) and the panels `fullScreen`
lists in a compact form, side by side in a box the screen sizes: Live as small meters, where it runs out a line per
component, the controls a line each, headroom as a sparkline, compare its first table, the assumptions a count. Rows
that do not fit are left out whole and counted; each compact panel, "Why" and the assumptions open the panel whole over
the diagram (its button closes it, and Esc in the overlay; the browser's own full screen takes Esc for itself). A phone
shows one panel at a time under tabs, and pans the diagram in its own box. Nothing the load changes moves the board.

A switch beside Close, or the F key, turns full screen into focus: the diagram, the story under it, and the verdict and
the load slider when `fullScreen` lists them. `<Loadmap fullScreenMode="focus">` and `fullScreenMode: focus` in a
`.loadmap` open full screen there (type `FullScreenMode`, default `'panels'`); the editor, the docs and the CLI viewer
pass it on. The story bar gets Play: each step for its `seconds`, as `loadmap record --story` plays it, until the last
or a value of the reader's own; its text keeps the room of the longest step.

The controller has the state: `fullScreen`, `toggleFullScreen()`, `fullScreenMode`, `setFullScreenMode()`,
`storyPlaying`, `setStoryPlaying()`. `<Loadmap>`'s `.lm-side` is now also `.lm-drawer`; a page of its own keeps its
`.lm-side` under the board, in a box that scrolls on its own. `.lm-corner` is gone: nothing scrolls Close away.
