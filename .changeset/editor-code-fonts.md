---
'@loadmap/editor': minor
---

View sets the code's font, its size and its ligatures, each the reader's own and kept in the browser: the system's
monospace, Fira Code, JetBrains Mono or Cascadia Code (SIL Open Font License, about 36 to 49 kB each, fetched only when
picked, never in a first load), a size from 11 to 20 px (13 by default; at least 16 on a phone), and ligatures on or
off (`->` drawn as one arrow, or as its two marks). The new `fonts` prop says which fonts View offers and where their
files are: `CODE_FONTS` (exported) by default, from fontsource on jsDelivr at a pinned version; the docs site serves
its own copies.
