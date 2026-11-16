---
'@loadmap/dsl': minor
'@loadmap/cli': minor
'@loadmap/editor': minor
'@loadmap/react': minor
'@loadmap/vscode': minor
---

A definition in several files, from `loadmap 1.3`, which this opens: a new definition starts with `loadmap 1.3`, and
the templates and examples say it. A file stamped `loadmap 1`, `1.1` or `1.2` reads as it did, and one file is still
a whole definition.

- **Parts:** a model says `include "./shop.story.loadmap"`, the part `part of "./shop.loadmap"`. Its statements are the
  model's; it says the model's version.
- **Libraries:** `library "…"` holds values (`let`, `fit`, `metric`, `measure`, `tier`, `published`), boxes with
  inputs and subsystems; a model takes them by name, `import "./platform.loadmap" { postgres; pool: podPool }`.
- **Inputs:** `input pods = 3` in a library's box or subsystem, set in `with { … }` by the box that is `like:` it;
  `input flow main` takes a flow's name.
- **Subsystems:** `subsystem orderLine "Orders" { like: pipeline; with { … } }` is several boxes as one, each named
  `orderLine.<name>`; with a `route:` of its own, a flow's route and an edge may name the subsystem.
- **Variants:** `extends "./shop.loadmap"` is a model with other defaults and values.
- `compile(source, { path, files })`: the host gives the files, the compiler reads none. A diagnostic and a symbol in
  another file carry `file`. New: `imports`, `gather`, `flatten`, and `definitionAcross`, `referencesAcross`,
  `renameAcross`, `hoverAcross`, `completionsAcross`.
- A share link with more than one file is `#v2.`; one file still makes `#v1.`.
- `loadmap check`, `pull`, `drift` and `record` read a definition with its files, inside the project root;
  `--format json` adds `file` to a diagnostic of another file. `loadmap fmt` on a model sets its parts' versions.
  New: `loadmap bundle <model.loadmap>` writes the definition as one file.
- The language server and the VS Code extension: problems in the file they are in, definition, references and rename
  across a model's files, completion of paths, imports and inputs, a quick fix that imports a name, and the preview
  of a part (its model) and of a library (its own boxes).
- The editor shows each file as a tab; `<LoadmapSource>` takes `files` and `path`.
- A name with a dot (`a.b`) that is no table is now read as one name: where it names nothing, the error says so
  as before.
