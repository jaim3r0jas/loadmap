---
'@loadmap/dsl': minor
---

Language 1.6: a capacity's ± is written `+-`, which every keyboard has: `estimated(20_000 +- 30%, "req/s")`. `±` and
`+/-` keep reading the same, and `loadmap fmt` writes `+-` for them in a file stamped 1.6. Before 1.6 `a +- b` was
`a + -b`, and a file stamped before it still computes so, with a warning (`plus-minus`) and a quick fix that writes
`+ -`; from 1.6 a `+-` outside a capacity's value is an error that says how to write the sum. Completion, the
inspector and the help write `+-` in a file stamped 1.6 and `±` before, and the VS Code extension's grammar reads `+-`
as one operator. Every definition of the repository, the templates included, moves to 1.6.
