---
'@loadmap/layout': patch
'@loadmap/react': minor
'@loadmap/editor': minor
---

A new version of a model keeps more of what is drawn. The story step shown stays when the text is edited (or another
`model` is handed to `<Loadmap>`), as the new version writes it: its values, and what it closes, change as the step is
edited, and only a story that no longer has the step leaves it; a story that is playing still stops. A version whose
boxes and edges take the same room is not laid out again: ELK's result is kept by the frame, not by the compiled view.
The editor's handle has `changeFiles(files)`, which changes the definition's files as an edit (one undo step per file),
where `setFiles` starts a new definition from its defaults. In the editor, a change that reaches only a file that is
not open (a restore, an accepted proposal, a rename) is drawn at once, not with the next key.

Docs: /api/react/#useloadmap-and-the-controller
