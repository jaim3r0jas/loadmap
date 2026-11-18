# Styling

A board is styled by CSS custom properties, the `--lm-*` tokens: colours, fonts, the root's padding and background,
and where the load bar sticks. The stylesheet is scoped to the root, the element with the `.lm` class, and goes into
the document on the first render, so a page imports no CSS. Light and dark each have a full set of tokens; a page
changes the ones it wants in its own stylesheet.

## Setting a token

The colour and font tokens are defined on `.lm` itself, so a value set on an ancestor (`:root`, `body`, a wrapper) does
not reach them: set them on the root, with a selector that weighs more than `.lm`. The stylesheet's dark theme uses
`.lm:not([data-theme="light"])` in a `prefers-color-scheme: dark` query and `.lm[data-theme="dark"]`, so give the dark
values the same weight plus one:

```css
/* .capacity .lm outweighs the stylesheet's .lm: the light values */
.capacity .lm {
  --lm-accent: #2f5fd0;
  --lm-font: "Inter", system-ui, sans-serif;
}

/* the system's dark, unless the board is held light */
@media (prefers-color-scheme: dark) {
  .capacity .lm:not([data-theme="light"]) {
    --lm-accent: #8fb0ff;
  }
}

/* a board held dark: theme="dark", or theme="inherit" on a dark page */
.capacity .lm[data-theme="dark"] {
  --lm-accent: #8fb0ff;
}
```

Three tokens are for the page around the board and are not defined on `.lm`: `--lm-pad`, `--lm-root-bg` and
`--lm-sticky-top`. They take their value from wherever the page sets them, an ancestor too.

The dots are drawn on a canvas with the colours the root's tokens had when the board started or its theme last
changed: a token changed later reaches the dots at the next theme change.

## The tokens

Colours, with their defaults in light and in dark:

| Token              | Light     | Dark      | What it colours                                                                   |
| ------------------ | --------- | --------- | --------------------------------------------------------------------------------- |
| `--lm-bg`          | `#eef2f5` | `#0d141b` | The root's background (unless `--lm-root-bg`), and full screen's                  |
| `--lm-surface`     | `#ffffff` | `#151e27` | The board, the cards, the load bar, buttons and tips                              |
| `--lm-fg`          | `#17212b` | `#e4ebf1` | Text; the scenario picked; values of the reader's own in the charts              |
| `--lm-muted`       | `#5d6d7c` | `#93a3b3` | Secondary text, panel headings, the legend, edges and their arrows               |
| `--lm-line`        | `#c6d0da` | `#2a3744` | Borders, table rules, the outline of a box with nothing to say                   |
| `--lm-accent`      | `#0b6b8f` | `#5fb7d6` | The focus ring, the slider, the load marks, the story's progress; a flow's dots by default (`color: 'accent'`) |
| `--lm-accent-soft` | `#d6e9f0` | `#163442` | Behind the verdict and the presets                                                |
| `--lm-alt`         | `#7a4f9a` | `#c39be0` | Published capacities' tags; a flow with `color: 'alt'`                            |
| `--lm-alt-soft`    | `#efe5f6` | `#2b2236` | Defined for pages to use; the board does not use it                              |
| `--lm-ok`          | `#2a7f5a` | `#5fc08f` | Under the target: a box's outline, the slider's first zone, a meter; dots served |
| `--lm-warn`        | `#b86e00` | `#e2a24a` | Past the target: outlines, the zone, the target's mark                            |
| `--lm-drop`        | `#b7392e` | `#e26a5c` | Past capacity: outlines, the zone, where it runs out; dots dropped, rejected or timed out |
| `--lm-lane`        | `#e3e9ee` | `#1b2631` | The cells inside a box: a queue's partitions, a pool's workers                    |
| `--lm-lost-fill`   | `#fbefed` | `#2b1c1d` | The inside of a `lost` box, where what is lost ends                               |
| `--lm-lost-line`   | `#b7392e` | `#e26a5c` | The outline of a `lost` box and the edges into it                                 |
| `--lm-tier-base`   | `#f4f7fa` | `#1b2530` | The first, third… tier lane (`lanes: 'filled'`)                                   |
| `--lm-tier`        | `#e8eef3` | `#24323f` | The second, fourth… tier lane                                                     |
| `--lm-tier-head`   | `#dbe3eb` | `#2c3b4a` | A tier's heading band                                                             |
| `--lm-tier-fg`     | `#34424f` | `#c3cfda` | A tier's name                                                                     |
| `--lm-tier-line`   | `#c6d0da` | `#33424f` | The lines between tiers and under their headings                                  |
| `--lm-s1`          | `#2a78d6` | `#3987e5` | The first scenario in the headroom chart and the comparison                       |
| `--lm-s2`          | `#eb6834` | `#d95926` | The second scenario                                                               |
| `--lm-s3`          | `#6250d6` | `#9085e9` | The third scenario                                                                |
| `--lm-s4`          | `#eda100` | `#c98500` | The fourth; a fifth and later are drawn muted                                     |

A flow's `color` in the view is one of `accent`, `alt`, `ok`, `warn`, `drop` and `muted`, which follow the tokens and
the theme, or any CSS colour, which stays as written. A tier's own `fill` wins over the lane tokens.

Fonts and the page around the board:

| Token             | Default                                                                   | What                                     |
| ----------------- | ------------------------------------------------------------------------- | ---------------------------------------- |
| `--lm-font`       | `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` | Every text but the numbers      |
| `--lm-mono`       | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`                | Numbers, tables, the load value          |
| `--lm-pad`        | `16px`                                                                    | The root's padding                       |
| `--lm-root-bg`    | `var(--lm-bg)`                                                            | The root's background                    |
| `--lm-sticky-top` | `0px`                                                                     | Where the load bar sticks while the page scrolls: a fixed header's height |

The root's text is 14 px with a line height of 1.45, in `--lm-font`.

Inside a card of its own, drop the root's padding and background: full screen keeps both.

```css
.card > .lm {
  --lm-pad: 0;
  --lm-root-bg: transparent;
}

/* a page whose header stays fixed: the bar sticks under it */
body {
  --lm-sticky-top: 56px;
}
```

In a grid or a flex row, give the root (or its cell) `min-width: 0`: the board sizes the diagram to its width.

The board sets a few properties on its own elements while it runs (`--lm-fit`, `--lm-at`, `--lm-step` and
`--lm-inset-top`, `-right`, `-bottom`, `-left`). They are not for a page to set.

## Light, dark and inherit

`<Loadmap theme>` (and `LoadmapRoot`, `<LoadmapSource>`, the editor) takes one of four:

| `theme`     | What it draws                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `'auto'`    | The system's light or dark (`prefers-color-scheme`); the default                                |
| `'light'`   | Light, whatever the system says                                                                 |
| `'dark'`    | Dark, whatever the system says                                                                  |
| `'inherit'` | The page's own switch, followed as it changes; the system's while the page says nothing         |

With `'inherit'`, the page's switch is on `<html>`: `data-theme="dark"` or `"light"`, or a `dark` or `light` class. One
observer of `<html>` serves every board on the page. On the server, and while the page says nothing, it draws as
`'auto'`.

The root carries the theme it draws as `data-theme="light"` or `"dark"`, and none for `'auto'`. `usePageTheme(theme)`
returns the same, `'auto'`, `'light'` or `'dark'`, for a piece of your own that should match the board.

## Server rendering and a shadow root

The stylesheet is one string, `LOADMAP_CSS`. `injectStyles(doc?)` adds it once to a document's `<head>` (as
`<style id="loadmap-css">`; default the current `document`), which every root does on its first render.

- Server rendering: put `LOADMAP_CSS` in the page's `<head>` as `<style id="loadmap-css">`, so the first paint is
  styled; the root then finds it by its id and adds nothing.
- A shadow root: the document's stylesheet does not reach inside it, so put `LOADMAP_CSS` in a `<style>` inside the
  shadow root yourself. The zoom buttons and the path over a zoomed board have a small stylesheet of their own, which
  goes into the document only: in a shadow root they show unstyled, so leave `zoom` off there.
- A frame or a window of your own: `injectStyles(frame.contentDocument)`.

```ts
import { LOADMAP_CSS } from '@loadmap/react'

const shadow = host.attachShadow({ mode: 'open' })
const style = document.createElement('style')
style.textContent = LOADMAP_CSS
shadow.append(style, mount)
```

## Full screen

Full screen lays the root out as a column that never scrolls: the bar, the diagram as large as fits, the verdict in a
line, and the panels in a compact dock ([Full screen](/api/react/#full-screen) has what each mode shows). The
root says where it is, for a page's own rules:

| Attribute on `.lm`  | Values                                   | When                                                         |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| `data-full`         | `screen`, `overlay`, `fill`              | The browser's full screen, the fixed overlay where it has none, or `fill` |
| `data-mode`         | `panels`, `focus`                        | What full screen shows                                       |

- Full screen takes the whole screen (`100dvh`) with a 16 px padding and the `--lm-bg` background, whatever
  `--lm-pad` and `--lm-root-bg` say; `fill` takes its container's height with a 10 px padding.
- The overlay sits in the top layer (a popover), so an ancestor with a transform, a filter or containment does not
  trap it.
- Under 760 px wide the title and the legend go, the diagram pans in a box of its own 40 % of the screen high, the load
  bar moves under it, in thumb reach, and the panels show one at a time under tabs.
- In a layout of your own, only a title, the bar, the story, the diagram and a `.lm-side` stay in full screen:
  [A layout of your own](/api/react/#a-layout-of-your-own).
