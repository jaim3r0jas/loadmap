---

"@loadmap/core": minor
"@loadmap/sim": minor
"@loadmap/layout": minor
"@loadmap/react": minor
"@loadmap/export": minor
"@loadmap/dsl": minor
"@loadmap/editor": minor
"@loadmap/cli": minor
---

Light editing for readers: `<LoadmapEditor layout="reader">` shows the diagram with an inspector (a box's label,
capacity and parameters; the model's load, growth and flows), each change a small edit of the text, and a shared link
opens that way on the docs site. `format()` and `loadmap fmt` (`--check` for CI) lay a definition out the one way.
`<Loadmap onNodeClick selected>`; in the editor a click on a box selects its lines, and **Format** (Shift+Alt+F).
