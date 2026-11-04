# Recording and CI

`@loadmap/cli` has three commands: `loadmap record` makes media that stand alone, `loadmap fmt` lays a definition out
the one way, and `loadmap check` holds a model to its promises in CI.

```bash
npm i -D @loadmap/cli
npx playwright install chromium     # once, for record
```

## Record

```bash
loadmap record shop.loadmap --out shop.gif --caption                 # a .loadmap needs no page of its own
loadmap record shop.loadmap --out story.webm --story --caption       # play the story, a step at a time
loadmap record shop.loadmap --out poster.png --poster --scenario Proposed
loadmap record http://localhost:5173/ --out shop.mp4 --script ramp.json
```

A page is recorded when it calls `expose(handle)` from `@loadmap/export` with the `ref` of its `<Loadmap>`. The clock
is fixed and the simulation seeded, so the same options give the same file, byte for byte: a recording can live in a
repository and change only when the model does.

`--out` picks the format: GIF, WebM, MP4, PNG or SVG. `--caption` puts the title, scenario and load above the board and
the verdict (or the story step's text) below it. `--poster` draws one PNG with the verdict, where each component runs
out and the scenarios compared. `--script` changes values during the recording:

```json
[{ "at": 0, "set": { "load": 5 } }, { "at": 2, "set": { "load": 30 } }, { "at": 4, "scenario": "Proposed" }]
```

`loadmap --help` lists every option. In a page, the same functions are `exportPng`, `exportSvg`, `recordVideo` and
`recordPoster` from `@loadmap/export`.

## Format

```bash
loadmap fmt models/*.loadmap           # rewrites each file
loadmap fmt --check models/*.loadmap   # changes nothing; exit 1 when one needs it
```

Two spaces a block, a statement a line, at most one blank line, one space around operators. Numbers, texts,
templates and parentheses stay as written, so a formula never changes; a block written on one line stays on one line
while it fits in 120 columns. A file with a syntax error is left alone. `loadmap fmt -` reads standard input and writes
standard output, for an editor's format-on-save. The function is `format()` from `@loadmap/dsl`.

## Check

```bash
loadmap check models/*.loadmap
```

It compiles each definition and tests its `expect` lines on the pessimistic edge (every capacity at its low bound).
It exits 1 when a definition has an error or an expectation fails, with the line and column. Under GitHub Actions it
also writes annotations, so a failure shows on its line in the pull request:

```yaml
# .github/workflows/capacity.yml
name: capacity
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npx @loadmap/cli check models/*.loadmap
```

A TypeScript model does the same in a test: `assertHolds(model)` from `@loadmap/core` throws, listing every failed
expectation.
