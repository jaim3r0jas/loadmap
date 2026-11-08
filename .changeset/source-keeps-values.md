---
"@loadmap/react": minor
---

`<LoadmapSource>` keeps the values the board shows (the load, the scenario, the controls) when its text changes, as
the editor does: a slider set by the reader stays where it is through an edit, and a value that no longer fits (an
option taken away) goes back to its default. `initial` is for the first version; a `key` per file starts another file
from its own defaults.
