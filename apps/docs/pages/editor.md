# Editor

A `.loadmap` definition next to its live diagram. Errors show under the line as you type, the diagram keeps the last
version that compiled, and **Share link** puts the whole definition and the values you set into a link. Your text is
kept in this browser as a draft.

A click on a box selects its lines in the text, and the cursor in a box's lines rings the box. **Format** (Shift+Alt+F)
lays the text out the one way, as `loadmap fmt` does.

**Hide code** shows the diagram with an inspector beside it, and a shared link opens that way: click a box to change
its label, its capacity (the numbers, ± and where it comes from) and the parameters it reads, or open **Model** for
the title, the load, growth and the flows. Each change is a small edit of the text, so **Undo** takes it back, the
link you share carries it, and **Show code** shows exactly what changed. A change the definition would not take (an
option a scenario still uses) is refused under its field, with the reason.

<div class="island" data-island="editor"></div>
