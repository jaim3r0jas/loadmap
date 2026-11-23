---
'@loadmap/editor': patch
---

Keeping a key sealed says what to do when it cannot: an error a `KeyVault` throws may carry a `link` (`{ href, label }`),
shown after its message. The docs' editor uses it when the GitHub token may not make `loadmap-keys`: a link to make the
repository on GitHub, private, then the same press keeps the key.
