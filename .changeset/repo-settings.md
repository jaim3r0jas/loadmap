---
'@loadmap/editor': minor
---

The Ask panel's settings fold to one line once set (provider, model, and where the setting in force comes from), and
**Settings** opens them again. A page whose `assist.settings` names the open repository (`repository()`) lets the
reader give it its own model, with a key of its own or their key for the provider: `load(repo)`, `key(provider, repo)`,
`save({ …, repo, ownKey })` and `remove({ repo })`. While it is open, the repository's own is in force; **Use your
default here** goes back.

Docs: /assistant/#where-your-key-is-kept
