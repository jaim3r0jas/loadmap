---
'@loadmap/dsl': patch
'@loadmap/editor': patch
---

Several files, what was left:

- An input set with a formula is checked against its default: the same type (`wrong-type`), and where both say a
  unit, the same one (a `unit-mismatch` warning).
- Hover on a box that is `like` another lists the inputs it sets. The inspector lists each line the box takes from
  the other, as written there; "Write here" puts it in the box, to change it there.
- Rename in the editor reaches every file of the model: the other tabs change too.
