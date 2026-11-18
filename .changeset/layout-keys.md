---
'@loadmap/editor': patch
---

The editor's keys held with ⌥ work on a Mac, on any keyboard layout. ⌥ with a letter types a character or starts a
dead key there, so ⌥I (what fits at the cursor), ⇧⌥F (format) and ⇧⌥M (Tab moves on) never ran: they now find
their binding by the key pressed, and a key no binding takes still types its character (⌥L is @ on a German Mac).
⌘I also lists what fits at the cursor on a Mac, as in VS Code, since macOS takes ⌃Space to switch the input source;
selecting the block around moves from ⌘I to ⌃⇧⌘→ there.
