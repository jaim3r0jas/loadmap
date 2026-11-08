# Embedding

A model made in the [editor](/editor/) can live inside another page: a ClickUp doc, a wiki, a status page. The embed
page draws it filling its frame, with nothing around it, and never scrolls. This is the checkout example, framed as
another page frames it:

<div class="island" data-island="framed" data-root="../"></div>

## Get the link

In the editor, **Embed in a page…** (in **Share**'s ▾ menu, or under **⋯** on a phone) opens a small panel:

- **Show**: the diagram with the verdict and the load (Diagram), or the panels around it too (With panels);
- **Theme**: Auto follows the reader's system, Light and Dark stay so;
- **Play the story when it comes into view**, when the model has a story;
- **Copy link** for a tool that takes a link, **Copy &lt;iframe&gt;** for a page that takes HTML.

The link is the editor's share link pointed at the embed page:

```text
https://jaim3r0jas.github.io/loadmap/embed/?mode=focus&play=1#v1.jZNNb9swDIbv…
```

## In ClickUp

Type `/embed` in a doc, paste the link, and size the block. The board takes the room it is given: wider shows more,
and below about 260 px of height it keeps the diagram and one line of verdict. **Open ↗** beside the title opens the
same model in the editor, for anyone who wants to change it.

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
| `mode`   | `focus`, `panels`                                                | `focus`                                   |
| `panels` | any of `verdict,live,limits,controls,headroom,compare,assumptions` | the model's `fullScreen`, else every one |
| `theme`  | `auto`, `light`, `dark`                                          | `auto`                                    |
| `play`   | `1`: plays the story once, when half the frame is in view        | off                                       |

A value it does not know is left at its default. With reduced motion the story never plays by itself. The panels
need room: give `mode=panels` a frame of 600 px or more in height.

## Who can read it

**The whole model travels in the link**, after the `#`: GitHub, which serves the page, never receives it, but anyone
who can open the doc or the page it is pasted in can read the model, its numbers and its notes. Share it where you
would share the `.loadmap` file.

A link that holds no model, or a model that does not compile, shows a plain message with the reason and a way to the
editor. The text is read as untrusted: its formulas never run as code, and the language's size limits apply.
