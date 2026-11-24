---
'@loadmap/dsl': patch
---

`loadmap bundle` and `flatten()` keep the parentheses of a comparison that is compared again: `(mode == "a") == flag`
was written `mode == "a" == flag`, a chain, and the flat copy did not compile. A comparison given to an input of a
library is one value where the library compares it again (`ok == flag`), no longer a chain. A signed share of a
capacity keeps its pair (`100 +- (-5)%`), and a plus before a minus (`+(-a)`) is written `+ -a`, never the `+-` of a
capacity; `format()` no longer glues those two signs either, under any stamp. Parentheses that change nothing still
go (`(a * b) + c` is `a * b + c`), and a number or a text in parentheses is copied as written.
