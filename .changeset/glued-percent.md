---
'@loadmap/dsl': minor
---

`30%+1` no longer passes in silence. A `%` straight after a number is a share, but before a value or a sign it read as
the remainder, so `30% + 1` was 1.3 and `30%+1` was 0. That spelling is now `glued-percent`, with a quick fix for each
meaning (`30% + 1`, `mod(30, 1)`): an error in a `loadmap 1.2` file, a warning in an older one, which computes as
before. `mod(a, b)` is new in 1.2 and says the remainder in words; `a % b` with spaces still works.
