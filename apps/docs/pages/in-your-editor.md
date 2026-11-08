# In your editor

A `.loadmap` is a text file: write it where you write code, with errors as you type, completion, hover, formatting
and a live preview of the diagram.

- **VS Code, Cursor, VSCodium:** the extension **loadmap**, from the
  [Marketplace](https://marketplace.visualstudio.com/items?itemName=jaim3r0jas.loadmap) or
  [Open VSX](https://open-vsx.org/extension/jaim3r0jas/loadmap), or [open it in VS Code](vscode:extension/jaim3r0jas.loadmap).
- **Neovim, Helix, or any editor that speaks the language server protocol:** `npm i -D @loadmap/cli` in the
  project, then the setup below.
- **No install:** [the editor](/editor/) on this site. **Copy Share Link** in VS Code opens a file there, and
  **Export → Download .loadmap** there gives you the file back.

To try it on a model that uses most of the language, take one from an example: **.loadmap ↓** over the board of
[Checkout](/examples/checkout/) or [Alerts](/examples/alerts/).

## Setup

@include(docs/dsl.md, "In **VS Code**", "## Reference")
