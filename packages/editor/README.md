# @loadmap/editor

`<LoadmapEditor>`: a `.loadmap` definition in CodeMirror next to its live diagram, with errors under the line,
completions, share links, download, a formatter, and a menu of templates to start from. `layout="reader"` hides the
text: a click on a box opens an inspector for its label, capacity and parameters, each change a small edit of the
text, so a shared link carries it.

```tsx
import { LoadmapEditor } from '@loadmap/editor'

;<LoadmapEditor initial={source} onChange={saveDraft} />
;<LoadmapEditor initial={shared.source} values={shared.values} layout="reader" />
```

`fill` makes it the whole of its container, as a page of its own: the text in a panel on the left, the diagram as a
canvas to pan and zoom in the room between, and the verdict and the other parts in a panel on the right. Each panel
resizes by its inner edge (`split`, `onSplit`; `panelWidth`, `onPanelWidth`) and folds onto a rail (`onLayout`;
`panel`, `onPanel`). An edit keeps the view the reader zoomed to; **Track live changes** in the code panel (`track`,
`onTrack`) brings the boxes each edit changed into view and marks them. On a phone (below 720 px wide or 500 px high)
the text or the diagram, switched at the bottom, the panels in a sheet over the diagram, and a row of keys over the
keyboard. The bar shows the model's title, **New** (the templates), **Export** (the `.loadmap` file) and **Share**
(the link; with `embedLink`, an embed too). `start` adds controls before the title, `newItems` and `exportItems`
sections to the two menus, and `actions` controls before Share:

```tsx
;<div style={{ height: '100dvh' }}>
  <LoadmapEditor fill initial={source} start={<a href="/">← Back</a>} split={0.3} onSplit={keepSplit} />
</div>
```

Docs and a live editor: https://jaim3r0jas.github.io/loadmap/ · MIT
