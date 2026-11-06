---
"@loadmap/react": minor
"@loadmap/editor": minor
---

`theme="inherit"` follows the page's own light and dark switch, `data-theme="dark"` or a `dark` class on `<html>`,
as it changes (the dots and the meters too), and the system's while the page sets none; `usePageTheme(theme)` gives
the theme it resolves to. `<LoadmapEditor theme="inherit">` does the same. Two tokens fit the root into a card that
has its own: `--lm-pad` (its padding, 16px) and `--lm-root-bg` (its background); full screen keeps both.
