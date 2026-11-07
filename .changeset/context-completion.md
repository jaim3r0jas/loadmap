---
'@loadmap/dsl': minor
'@loadmap/editor': minor
---

Completion knows where the cursor is. A capacity offers `measured`, `estimated` and `configured` first, as snippets
that fill in value, unit and source field by field; after its value comes `± 30%`; its unit offers the units the file
already uses. A box's `demand` offers the flows that reach it first, `at.<stage>.` only the flows that pass that stage,
a route the stages next along an edge first, a `when` the switches. Nothing that reads itself is offered (a `let`'s own
name, a component's own `util`), nor a property the block already sets, nor anything inside a comment or a plain text;
a template's `${…}` completes by where the template is. A scenario, preset or step offers a parameter's options, and so does the parameter's own `default`; `tier:` offers the
tiers, wherever they are declared.
Builtins come with their arguments and a line of help. Completion reads the parse alone, never runs the model, so it
costs a small part of a compile on every keystroke: `completions(source, offset)` no longer takes a compile result.

A block left open while typing (`flow q {` without its `}`) ends at the next top-level line instead of taking the rest
of the file, so the diagnostics and completions below it stay right; a file whose braces balance reads as before.

The editor closes brackets and quotes as they are typed, and opens the list after `(`, `,`, an operator or a quote. Tab
moves through a snippet's fields and then out of the call; on a phone the ⇥ key over the keyboard does the same. Where
there is no room beside the list (a phone), its help goes under the list instead of over the options after the one
selected.
