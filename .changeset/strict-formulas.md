---
'@loadmap/dsl': minor
---

Formulas are typed strictly, as CEL types JavaScript's syntax: a condition (the test of `? :`, each side of `&&`, `||`
and `!`, a `when`, an `enabled`) is true or false, `< <= > >=` compare numbers, `==` and `!=` compare like with like,
a literal compared with a select is one of its options (`mode == "c"` with options "a" and "b" is always false), both
answers of a `? :` have one type, and comparisons don't chain ("comparisons don't chain: write 1 < load && load <
3"). Where the definition is computed, a rate or a demand below 0 and a capacity of 0 or less are refused, and so is
a preset's load or slider value outside its range. Each is an error from `loadmap 1.1` and a warning in a file stamped before it,
which computes as it did. A demand that is not a number (`flows.orders / (pods - 2)` with 2 pods) warns, as a rate
does, instead of a verdict that holds "up to 0×". New codes: `chained-comparison`, `bad-demand`. `edit()` returns at
once for a change that leaves the text as it is.
