---
"@loadmap/react": minor
---

`<LoadmapSource source={text} name="shop.loadmap" />` from `@loadmap/react/source` draws a `.loadmap` text with the
options it declares (the page's props win; its `assumptions` come first). It compiles again when the text's tokens
change, so spaces and comments keep the board and its values; while the text does not compile it shows the
diagnostics as `loadmap check` prints them, above the last version that did. It is a separate entry, the one that
loads the compiler: a page built from code never does. `@loadmap/react` now depends on `@loadmap/dsl` for it.
