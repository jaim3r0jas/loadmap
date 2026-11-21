---
'@loadmap/dsl': minor
'@loadmap/cli': minor
---

`loadmap ask <file> "<request>"` asks a language model for a change to a definition and shows it as a diff; `--write`
writes it, `--commit` commits it. The model answers with operations by name, or with whole files; the change is laid
out, compiled and checked before anyone sees it, a refused answer goes back to the model at most twice, and a capacity
it writes must use a number you gave or say it is the assistant's guess. `@loadmap/dsl/assist` is the same assistant
for any host: `createAssistant`, two adapters that need only `fetch` (`openaiCompatible`, `anthropic`), the providers
by name, and `recorded` for tests.

Docs: /in-your-editor/#ask-a-model
