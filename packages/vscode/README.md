# loadmap for VS Code

[loadmap](https://jaim3r0jas.github.io/loadmap/) draws a system's architecture as a live capacity model: the load
flows through it as dots, and a ranked list says which component runs out first and at what multiple of today's
load. This extension makes VS Code an editor for its `.loadmap` files, with the help the docs' editor gives and the
diagram live beside the text.

## The preview

**loadmap: Open Preview to the Side** (the button over a `.loadmap` editor, or Ctrl+K V, ⌘K V on a Mac) draws the
file as it is typed: the scenarios and the load, Play for the story, pan and zoom, a box's details on hover, and the
panels the definition asks for. It follows the `.loadmap` editor in front, keeps the load and the controls through
your edits, and while the text has an error shows the problems over the last version that drew. Click a box to
select its declaration; put the cursor in a box's declaration to pick it on the board. It takes VS Code's light or
dark theme.

**Track live changes** (the eye over the preview, or `loadmap.preview.trackChanges`): once an edit is drawn and the
text rests about half a second, the preview brings the boxes it changed into view, at the same zoom and further out
only as far as it takes, and marks them with a short glow. Format Document is no edit to follow. Off, the view stays
where you left it.

**Copy Share Link** and **Open in the Live Editor** (over the preview, or from the command palette) put the text,
with the values the preview shows, in a link to the docs' editor. The text travels in the link's `#`, which never
reaches a server; `loadmap.editorUrl` points them at a copy of the docs hosted elsewhere.

The preview runs nothing but the extension's own files: no network, no `eval`. A definition's formulas are read as a
syntax tree, never run as code, so opening someone else's file is safe.

## Add from the catalog

**loadmap: Add from the Catalog…** (the library button over the preview, the command palette, or the light bulb in a
box's declaration) picks a component, then one of its published runs: the figure, the conditions it was run under,
and who ran it, with a button that opens the source. A component nothing is published for says so. Then **Use for**
the box the cursor is in (or the one selected on the preview), which takes the figure as its capacity, or **Add as a
new box**. It writes text only: a `published` statement and the box, refused with the reason when the definition
would gain an error or the figure's unit is not the box's.

## The language

- highlighting made from the language's own table of statements;
- errors and failing `expect` lines as you type;
- completion with snippets, the arguments of a call, and hover with the values at the defaults;
- quick fixes, go to definition, find references, rename and an outline;
- Format Document, the one layout `loadmap fmt` writes.

The language server is `loadmap lsp` from [`@loadmap/cli`](https://www.npmjs.com/package/@loadmap/cli), bundled in:
nothing else to install, and it works offline. To use a project's own version instead (the one its CI checks with),
set `loadmap.server.path` to that command, such as `node_modules/.bin/loadmap`; in a workspace you have not
trusted, the bundled server always runs.

The language guide: https://jaim3r0jas.github.io/loadmap/language/ · MIT
