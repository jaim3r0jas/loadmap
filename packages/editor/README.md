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

`fill` makes it the whole of its container, as a page of its own: the diagram as a canvas to pan and zoom, the text
floating over its left in a card that resizes (`split`, `onSplit`) and hides (`onLayout`), and the verdict and the
other panels on its right, pinned or on a rail (`panel`, `onPanel`). On a phone (below 720 px wide or 500 px high)
the text or the diagram, switched at the bottom, the panels in a sheet over the diagram, and a row of keys over the
keyboard. `start` adds controls
at the start of its bar:

```tsx
;<div style={{ height: '100dvh' }}>
  <LoadmapEditor fill initial={source} start={<a href="/">← Back</a>} split={0.3} onSplit={keepSplit} />
</div>
```

Docs and a live editor: https://jaim3r0jas.github.io/loadmap/ · MIT
