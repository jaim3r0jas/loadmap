---
'@loadmap/cli': minor
---

`loadmap lsp`: the language server protocol over standard input and output, so Neovim, Helix and any editor that
speaks it get the docs' editor's help for `.loadmap` files: errors and failing `expect` lines as you type (after a
pause), completion with snippets, hover with the values at the defaults (the last version without errors while the
text has one), the arguments of a call, formatting, quick fixes as code actions, go to definition, references,
highlights, rename (refused with the reason) and an outline of what the definition declares. One file at a time, the
whole text on each change; nothing but Node, and no Playwright. The language guide shows the setup for Neovim and
Helix.
