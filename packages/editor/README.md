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

Docs and a live editor: https://jaim3r0jas.github.io/loadmap/ · MIT
