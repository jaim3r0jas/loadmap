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
[Checkout](/examples/checkout/), [Alerts](/examples/alerts/) or [Search](/examples/search/), or a model in several files
from [Two regions](/examples/regions/).

## Setup

@include(docs/dsl.md, "In **VS Code**", "## Reference")

## The VS Code extension's commands and settings

| Command (under **loadmap:**)                           | What                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| **Open Preview**, **Open Preview to the Side**         | The diagram of the file, drawn as you type                          |
| **Track Live Changes**, **Stop Tracking Live Changes** | The preview brings the boxes each edit changed into view            |
| **Add from the Catalog…**                              | A component's published figure, as a new box or a box's capacity    |
| **Copy Share Link**, **Open in the Live Editor**       | The text and the values shown, in a link to the editor on this site |
| **Restart the Language Server**                        | Starts the language server again                                    |

| Setting                        | What                                                                        |
| ------------------------------ | --------------------------------------------------------------------------- |
| `loadmap.server.path`          | A project's own `loadmap` command to run as the language server             |
| `loadmap.preview.trackChanges` | Track live changes in the preview (default off)                             |
| `loadmap.editorUrl`            | The live editor a share link opens: this site's, or a copy hosted elsewhere |
| `loadmap.trace.server`         | Log the messages between VS Code and the language server (default off)      |

The preview runs nothing but the extension's own files: no network, no `eval`. A definition's formulas are read as a
syntax tree, never run as code, so opening someone else's file is safe.

