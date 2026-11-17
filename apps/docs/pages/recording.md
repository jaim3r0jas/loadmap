# Recording and CI

`@loadmap/cli` is the command line: `loadmap record` makes media that stand alone, `loadmap fmt` lays a definition
out the one way, `loadmap check` holds a model to its promises in CI, `loadmap pull` reads measured data into a
snapshot, `loadmap drift` finds what moved in that data, `loadmap bundle` writes a model in several files as one, and
`loadmap lsp` is the language server.

```bash
npm i -D @loadmap/cli playwright     # playwright only for record; check and fmt run without it
npx playwright install chromium      # once, for record
```

## Record

```bash
loadmap record shop.loadmap --out shop.gif --caption                 # a .loadmap needs no page of its own
loadmap record shop.loadmap --out story.webm --story --caption       # play the story, as Play does
loadmap record shop.loadmap --out poster.png --poster --scenario Proposed
loadmap record http://localhost:5173/ --out shop.mp4 --script ramp.json
```

A page is recorded when it calls `expose(handle)` from `@loadmap/export` with the `ref` of its `<Loadmap>`. The clock
is fixed and the simulation seeded, so the same options give the same file, byte for byte: a recording can live in a
repository and change only when the model does.

`--out` picks the format: GIF, WebM, MP4, PNG or SVG. `--caption` puts the title, scenario and load above the board and
the verdict (or the story step's text) below it. `--story` plays the story from the defaults as the page's Play does:
the whole diagram, a close-up on what each step changes, the change, and the whole diagram again, the step's title on
the board. `--poster` draws one PNG with the verdict, where each component runs
out and the scenarios compared. `--script` changes values during the recording:

```json
[{ "at": 0, "set": { "load": 5 } }, { "at": 2, "set": { "load": 30 } }, { "at": 4, "scenario": "Proposed" }]
```

| Option                | What                                                                          |
| --------------------- | ----------------------------------------------------------------------------- |
| `--scenario <label>`  | Start from a scenario's values                                                |
| `--set <key=value>`   | A value before recording starts, on top of the scenario; repeatable           |
| `--seconds <n>`       | Length of a video or GIF (default 8, or the script's)                         |
| `--fps <n>`           | Frames per second (default 30; GIF 15, at most 50)                            |
| `--scale <n>`         | Pixels per diagram unit (default 1, PNG 2)                                    |
| `--seed <n>`          | The simulation's seed (default 1)                                             |
| `--name <name>`       | Which exposed loadmap, when the page has several                              |
| `--width <px>`        | The browser window (default 1280; a narrow one runs the diagram top to bottom) |
| `--color-scheme <s>`  | `light` or `dark`, for a page that follows the system theme (default light)   |

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

Each expectation ends pass, fail or inconclusive: data missing, or a ± that decides it. A `severity: warn` line never
fails the run.

| Option                 | What                                                                              |
| ---------------------- | --------------------------------------------------------------------------------- |
| `--format <f>`         | `text`, `github` (annotations; the default under GitHub Actions) or `json`        |
| `--pull`               | Read the measures first, as `loadmap pull` does, and check against them           |
| `--snapshot <file>`    | Check one definition against a snapshot already written                           |
| `--inconclusive <i>`   | `warn` (the default) or `fail`                                                    |
| `--units <u>`          | `warn` (the default) or `fail`: a unit that disagrees fails the run               |
| `--dry-run`            | Report everything and exit 0                                                      |
| `--json <file>`        | Write the run's result: outcomes, reasons, headroom, the window, the commit       |
| `--base <ref>`         | Compare each definition with itself at a git ref, against the same data           |
| `--tolerance <t>`      | How much headroom a change may lose: `10%` (the default) or multiples (`0.5×`)    |
| `--accept <reason>`    | A deliberate loss: what `--base` finds becomes warnings, with the reason          |
| `--comment <file>`     | Write the pull request comment, as Markdown                                       |

With `--base origin/main` the check fails when the first limit's headroom drops by more than the tolerance, when the
first limit moves to another component without more headroom, or when a component crosses the target or 100 % from
below at today's load. [The language guide](/language/#how-sure-and-what-must-hold) has the workflow that comments on
a pull request.

## Pull

```bash
export LOADMAP_PROMETHEUS_URL=https://prometheus.example:9090
loadmap pull shop.loadmap                  # writes shop.snapshot.json
loadmap check shop.loadmap --snapshot shop.snapshot.json
loadmap check shop.loadmap --pull          # both in one
```

It reads each `measure` of the definition from its provider and writes the snapshot the model reads, next to the
definition. The address and the credentials come from the environment, never from the file:
`LOADMAP_PROMETHEUS_URL` with `LOADMAP_PROMETHEUS_TOKEN` (or `_USER` and `_PASSWORD`), and
`LOADMAP_ELASTICSEARCH_URL` with `LOADMAP_ELASTICSEARCH_API_KEY` (or `_USER` and `_PASSWORD`). A query that fails,
or a window with fewer samples than its metric's `minSamples`, leaves that measurement missing: the model uses the
definition's fallback, and the line says why. `--window` is how far back it reads (default `7d`), `--step` the time
between points (default `5m`), `--to` the end of the window (default now) and `--out` where the file goes.
[Measured data](/language/#measured-data) has the statements; in code it is `pull` from `@loadmap/providers`.

## Drift

```bash
loadmap drift shop.loadmap --pull --history snapshots/
```

It finds what moved in the measured data that no change of the definition shows: a change point in a value across
the past runs, a series unlike the last run's, and a value, a fit's slope or the first limit's headroom outside the
band of the last runs. It exits 1 when something drifted and 3 when it cannot look. `--history <dir>` holds the past
snapshots, `--markers <file>` names deploys to explain a shift by, and `--json` and `--issue` write the result and
the body of an issue for a workflow to open. `--p-value`, `--confidence`, `--dead-zone`, `--test`, `--runs` and
`--min-runs` tune the tests; `loadmap --help` has their defaults.

## Bundle

```bash
loadmap bundle shop.loadmap --out shop.one.loadmap
```

A model in [several files](/language/#several-files) written as one file that draws and computes the same, for a
host that reads one file. Without `--out` it goes to standard output.

## Language server

`loadmap lsp` serves the language server protocol over standard input and output, for any editor that speaks it:
errors and failing expectations, completion, hover with the values at the defaults, signature help, formatting, quick
fixes, definition, references, rename and an outline. [In your editor](/in-your-editor/) has the setup for Neovim
and Helix.
