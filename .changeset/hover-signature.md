---
'@loadmap/dsl': minor
'@loadmap/editor': minor
---

Hover and signature help. `hover(source, offset, definition?)` says what a word is: a statement or a property (its
doc from the schema), a builtin (its arguments), a name the definition declares, with its values at the defaults when
given the compiled definition: a flow's rate and route, what of it reaches a stage, a component's utilization, demand
against capacity, how sure the capacity is and where it reaches the target and runs out, a `let`'s value, a
parameter's choices, a tier's boxes, what a scenario sets. The values come from the compiled model's own evaluation,
never from evaluating text. `signatureHelp(source, offset)` names the arguments of the builtin or fit the cursor is
in, and which one it is writing.

The editor shows both: a hover over a word (while the text has an error, with the values of the last version without
one, and a line that says so), and over the cursor inside a call its arguments, the one being written marked, on a
phone too. Completion, hover and signature help are one entry of the packed dsl, so a page that only reads a
definition never loads them.
