---
'@loadmap/editor': minor
---

`<LoadmapEditor fill>` fills its container, as a page of its own: the bar, then the text and the diagram side by side
with a divider to drag (or move with the arrow keys; a double-click puts it back), each side scrolling on its own.
Below 720 px wide, tabs switch between the text and the diagram, and the buttons other than Share fold into a menu.
`start` puts controls at the bar's start (a way back, a name), and `split` with `onSplit` let a page keep where the
divider was left. Without `fill` nothing changes.
