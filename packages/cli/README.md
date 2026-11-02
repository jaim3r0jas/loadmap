# @loadmap/cli

```bash
npx @loadmap/cli check shop.loadmap          # exit 1 when an expect line fails; GitHub annotations under Actions
npx @loadmap/cli record shop.loadmap --out shop.gif --caption
npx @loadmap/cli record http://localhost:5173/ --out poster.png --poster
```

`loadmap check` compiles each `.loadmap` and tests its `expect` lines on the pessimistic edge (every capacity at its
low bound). `loadmap record` draws a `.loadmap` (or opens a page that calls `expose()` from `@loadmap/export`) in
headless Chromium and records it on a fixed clock: the same options give the same file. Recording needs Chromium
once: `npx playwright install chromium`. `loadmap --help` lists every option.
Docs: https://jaim3r0jas.github.io/loadmap/ · MIT
