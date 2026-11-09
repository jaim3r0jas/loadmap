---
'@loadmap/dsl': patch
'@loadmap/editor': patch
---

The VS Code extension tracks live changes and adds from the catalog, as the editor does: an eye over the preview
(`loadmap.preview.trackChanges`) brings the boxes each edit changed into view and marks them, and **loadmap: Add from
the Catalog…** (a command, a preview button, a code action in a box) picks a component and one of its published runs,
then writes a `published` statement and a new box or the box's capacity. What an edit changed now comes from
`@loadmap/dsl/internal`, which the editor and the extension share.
