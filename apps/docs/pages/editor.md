# Editor

<div class="island" data-island="editor"></div>

<aside class="help" id="help" aria-label="Help" hidden>
<button type="button" class="help-close" aria-label="Close the help">✕</button>

## The editor

A `.loadmap` definition and its live diagram. Errors show under the line as you type, and the diagram keeps the
last version that compiled. Your text is kept in this browser as a draft.

The diagram fills the window: drag it to move it, zoom with the wheel or a pinch (or + and −), and **Fit** brings
the whole of it back. The text floats on its left: drag its edge to resize it, and **‹** hides it. The verdict, the
controls and the other panels stand on the right: **Unpin** folds them onto a rail that opens when you point at it.
This browser remembers how you leave them.

On a phone, **Diagram** and **Code** at the bottom switch between the two. The panels rest in a sheet over the
diagram's bottom: the verdict and the load at first, more as you drag or tap it up. Typing, a row over the keyboard
has Suggest, Format, Undo, an indent, braces, quotes, Rename, Find and Done; **⋯** has the rest.

A click on a box selects its lines in the text, and the cursor in a box's lines rings the box. **Format**
(Shift+Alt+F) lays the text out the one way, as `loadmap fmt` does.

**Ctrl+Space** (on a Mac **⌘I** or ⌥I, on any keyboard layout: macOS takes ⌃Space to switch the input source) lists
what can go at the cursor: the statements and properties of the block it is in, the names a formula can read, the
stages a route can take next. Ctrl+F (⌘F) finds and replaces, F12 goes to where a name is declared and F2 renames it.
**View → Keyboard shortcuts** lists every key; Esc then Tab leaves the text. There is nothing to save: the page keeps
your draft as you type, so ⌘S (Ctrl+S) only says so.

**New** starts from a template or an example, and **Export** downloads the text or an image.

**Share** puts the whole definition and the values you set into a link and copies it; its **▾** has **Embed in a
page…**, for a frame in another page. The link opens with the text hidden: the diagram, and an inspector in the panel.
Click a box to change its label, its capacity and the parameters it reads, or open **Model** for the title, the load,
growth and the flows. Each change is a small edit of the text, so **Undo** takes it back, the link carries it, and
**Show code** shows what changed.

[The language](/language/) · [Reference](/reference/) · [Examples](/examples/)

</aside>
