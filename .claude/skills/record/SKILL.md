---
name: record
description: How loadmap records a page or a .loadmap file with `pnpm record` (GIF, WebM/MP4, PNG poster, SVG) on a fixed clock, and how `loadmap check` runs a .loadmap's expectations. Use when recording a demo, working on `expose()`, `@loadmap/export`, the cli's `record` or its viewer, or the `--caption`, `--scenario`, `--poster` and `--story` options.
---

# Recording

A page calls `expose(handle)` (`@loadmap/export`); then `pnpm record <url> --out demo.gif [--script s.json]
[--set load=30]` records it in headless Chromium on a fixed clock: the same options give the same GIF, byte for byte.
Each example page of the docs exposes its example: `pnpm dev`, then
`pnpm record 'http://localhost:5173/examples/alerts/' --out alerts.gif`. `--caption` adds the title, scenario, load and verdict to every frame, `--scenario <label>`
starts from a scenario, `--poster` (with `.png`) draws the board with the limits and the scenarios compared, and
`.svg` writes the board as a file. `--story` plays the model's `story` steps (each step resolved from the defaults, so
any step looks the same whichever came before). `pnpm record x.loadmap --out x.gif` compiles the definition and draws
it in the viewer built into `packages/cli/dist/viewer` (`pnpm record` builds it). `loadmap check x.loadmap` runs its `expect`
lines: exit 1 on a failure or an error, GitHub annotations under Actions.
