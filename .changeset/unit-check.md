---
'@loadmap/dsl': minor
'@loadmap/editor': minor
---

The language checks units where the text says them. `flows.x` and `at.stage.x` are units a second, a number with a
unit is what it says, a fit returns its y (`points rate cores` gives cores), and `demand: … as "cores"` declares the
rest. A demand per second against a capacity that counts something (`"cores"`), the reverse, or two counts in different
words (`"cores"` against `"connections"`) is a warning, and so is a component without a demand line whose capacity is
not per second, an `as` its formula contradicts, and an empty unit. The schema gives the properties that are times,
shares or rates their unit (`held`, `service`, `timeout`, `p99`, `olderThan`, `hit`, `share`, `rate`, …), so
`held: 80%` warns too, and the reference says each one's. A bare number is any unit: every definition from before
compiles as it did, without a new warning. The editor and the VS Code grammar colour `as` as a keyword.
