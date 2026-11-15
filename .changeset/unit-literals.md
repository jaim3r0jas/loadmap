---
'@loadmap/dsl': minor
'@loadmap/editor': minor
---

Numbers with units in the language. A number may carry its unit straight after it: `ms`, `s`, `min` and `h` count in
seconds (`held: 20ms` is `held: 0.02`, `timeout: 5s` no longer fails), `%` makes a share (`hit: 80%`), and `×` (or
`x`) marks a load multiple. A `%` is a share only where no value follows it, so `10 % 3` is still the remainder and
`± 30%` means what it did. A word glued to a number that is not a unit (`5sec`) is one error that lists the units. The
inspector changes such a number as written and keeps its unit; the editor and the VS Code grammar colour the unit as
part of the number. The examples, the templates and the reference write durations and shares this way instead of
saying the unit in a comment.
