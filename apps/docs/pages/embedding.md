# Embedding

A model made in the [editor](/editor/) can live inside another page: a ClickUp doc, a wiki, a status page. The embed
page draws it filling its frame, with nothing around it, and never scrolls: the scenarios over the diagram, the load
and the verdict under it. This is the checkout example, framed as another page frames it:

<div class="island" data-island="framed" data-root="../"></div>

## Get the link

In the editor, **Embed in a page…** (in **Share**'s ▾ menu, or under **⋯** on a phone) opens a small panel:

- **Show**: the diagram with the verdict and the load (Diagram), or with the panels' tabs too (With panels);
- **Theme**: Auto follows the reader's system, Light and Dark stay so;
- **Play the story when it comes into view**, when the model has a story;
- **Copy link** for a tool that takes a link, **Copy &lt;iframe&gt;** for a page that takes HTML.

The link is the editor's share link pointed at the embed page:

```text
https://jaim3r0jas.github.io/loadmap/embed/?mode=focus&play=1#v1.jZNNb9swDIbv…
```

A model in several files makes a `#v2.` link, which carries every file it reaches: it embeds the same way.

## In ClickUp

Type `/embed` in a doc, paste the link, and size the block. The board takes the room it is given and arranges itself
by it: from 900 px of width the bar shows the flows' legend, and under 420 px of height the bar and the load fold to
one row each. **Open ↗** beside the title opens the same model in the editor, for anyone who wants to change it.

The doc keeps its scroll: over the frame the plain wheel and one finger still move the page. Ctrl or ⌘ with the
wheel, two fingers, or the buttons on the diagram zoom it, and a drag pans it.

ClickUp has no HTML block: use the link, not the `<iframe>`.

## In any page

```html
<iframe
  src="https://jaim3r0jas.github.io/loadmap/embed/#v1.jZNNb9swDIbv…"
  title="Checkout pipeline"
  width="100%"
  height="480"
  style="border: 0"
  loading="lazy"
  allow="fullscreen"
></iframe>
```

The page needs only scripts in the frame: no storage, no cookies, nothing from the page around it.

## Options

| Option   | Values                                                           | Default                                   |
| -------- | ---------------------------------------------------------------- | ----------------------------------------- |
| `mode`   | `focus`: no panels; `panels`: their tabs                         | `focus`                                   |
| `panels` | any of `limits,controls,headroom,live,assumptions`               | the model's `fullScreen`, else every one  |
| `theme`  | `auto`, `light`, `dark`                                          | `auto`                                    |
| `play`   | `1`: plays the story once, when half the frame is in view        | off                                       |

A value it does not know is left at its default. With reduced motion the story never plays by itself.

`panels` says which tabs `mode=panels` offers: Limits (with the verdict's sentence), Design, Headroom (with the
scenarios compared), Live and Assumes. A link made before the tabs still works: `verdict` stands for `limits` and
`compare` for `headroom`. One panel opens at a time, beside the diagram, or as a sheet over it in a frame under
520 px wide. The tabs are a row over the load, a rail from 900 px of width, and one menu in a frame under 420 px
high: give `mode=panels` 420 px or more.

## Who can read it

**The whole model travels in the link**, after the `#`: GitHub, which serves the page, never receives it, but anyone
who can open the doc or the page it is pasted in can read the model, its numbers and its notes. Share it where you
would share the `.loadmap` file.

A link that holds no model, or a model that does not compile, shows a plain message with the reason and a way to the
editor. The text is read as untrusted: its formulas never run as code, and the language's size limits apply.
