---
'@loadmap/dsl': minor
---

A long text no longer has to be one long line. From `loadmap 1.2` a line that starts with a `"…"` text continues the
text that ends the line above it, and `loadmap fmt` breaks a text that runs past 120 columns at a space, piece under
piece (and puts pieces that fit back on one line). The text is the same text: its value, and a share link's
fingerprint, do not change with where it is broken.
