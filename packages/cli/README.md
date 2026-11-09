# @loadmap/cli

```bash
npx @loadmap/cli check shop.loadmap          # exit 1 when an expect line fails; GitHub annotations under Actions
npx @loadmap/cli fmt shop.loadmap            # lays it out the one way; --check exits 1 instead (for CI)
npx @loadmap/cli lsp                         # a language server over stdio, for Neovim, Helix and others
npx @loadmap/cli pull shop.loadmap           # reads its measures into shop.snapshot.json (LOADMAP_PROMETHEUS_URL)

npm i -D @loadmap/cli playwright && npx playwright install chromium   # once, to record
npx loadmap record shop.loadmap --out shop.gif --caption
npx loadmap record http://localhost:5173/ --out poster.png --poster
```

`loadmap check` compiles each `.loadmap` and tests its `expect` lines on the pessimistic edge (every capacity at its
low bound). `loadmap fmt` rewrites each file laid out the one way (two spaces a block, a statement a line, one space
around operators; numbers, texts and formulas as written), `--check` only names the ones that are not, `-` reads
standard input. `loadmap record` draws a `.loadmap` (or opens a page that calls `expose()` from `@loadmap/export`) in
headless Chromium and records it on a fixed clock: the same options give the same file. Only recording needs
Playwright and its Chromium, installed next to the command (`npx @loadmap/cli record` alone cannot find them);
`check`, `fmt` and `lsp` run without them. `loadmap pull` reads every `measure` of a definition from its provider (Prometheus) into a snapshot next to it, with
the address and the credentials from the environment, never from the file. `loadmap lsp` serves the language server protocol over standard input
and output: errors and failing expectations, completion, hover with the values at the defaults, signature help,
formatting, quick fixes, definition, references, rename and an outline; the language guide shows how to set it up in
Neovim and Helix. `loadmap --help` lists every option.
Docs: https://jaim3r0jas.github.io/loadmap/ · MIT
