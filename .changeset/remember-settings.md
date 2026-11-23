---
'@loadmap/editor': minor
---

The Ask panel remembers the reader's model and key through the page: `assist.settings` (a `ModelSettings`: `where`,
`load()`, `key(provider)`, `save(choice)`, `remove(what)`) replaces `assist.vault`. The panel reads what is kept as it
opens, asks for a kept key only when a question needs it, and keeps a new choice or key when the reader asks with
**Remember it for my account** ticked; **Forget** removes it there too. `KeyVault` and the passphrase are gone: the
docs' editor now keeps these with its own service for a reader connected to GitHub.

Docs: /assistant/#where-your-key-is-kept
