---
'@loadmap/dsl': patch
---

`loadmap bundle` and `flatten()` keep the parentheses of a comparison that is compared again: `(mode == "a") == flag`
was written `mode == "a" == flag`, a chain, and the flat copy did not compile. A `±` inside a larger formula keeps its
own pair too, and a plus before a minus (`+(-a)`) is written `+ -a`, never the `+-` of a capacity; `format()` no
longer glues those two signs either. Parentheses that change nothing still go (`(a * b) + c` is `a * b + c`), and a
number or a text in parentheses is copied as written.
