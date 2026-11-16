---
'@loadmap/dsl': minor
'@loadmap/cli': minor
'@loadmap/editor': patch
---

Every diagnostic has a code: the kind of problem (`unknown-name`, `missing-edge`, `unseen-loss`, …), which stays when
its message is reworded. `Diagnostic` gains `code` and `data` (the names a quick fix needs), and `@loadmap/dsl` exports
the list as `DIAGNOSTIC_CODES` (type `DiagnosticCode`); docs/dsl.md lists them under Errors. Quick fixes key on the code
and read names from `data`, never from the message. The text output shows the code in brackets
(`checkout.loadmap:24:17 error[unknown-name]: unknown flow "order"`); `loadmap check --format json` gives each
diagnostic its `code`, `hint`, `endLine` and `endColumn`; a GitHub annotation is titled with the code, and `loadmap lsp`
sends it. Ids in messages are quoted: `"orders" goes from "gateway" to "api", and no edge joins them`, `units of "o"
too slow for their client at "a" vanish: …`.
