# For agents

A language model writes a `.loadmap` well when it has the reference at hand and a checker that answers in words. Each
of these is made for that, and each says the same as these pages, for the version they came with.

## The reference, in one file

- **[llms.txt](/llms.txt)** lists the pages of this site by group, each with
  its address: a map to read first.
- **[llms-full.txt](/llms-full.txt)** is the whole language guide and reference
  in one file, with one model that uses every statement and a model in several files (a model, a part, a library and
  a variant). Hand it to a model that writes `.loadmap` files.
- **`@loadmap/dsl`'s `dist/REFERENCE.md`** is the same guide and reference, shipped in the package: an agent working in
  a project that installs it reads the reference for the version it has, offline.

These pages document loadmap %VERSION%, language %LANGUAGE%: `llms.txt` and `llms-full.txt` are published with them,
with each release ([What's new](/whats-new/)), and `REFERENCE.md` ships in each release of the package.

## A checker that answers in words

`loadmap check` runs a definition's expectations and prints each diagnostic with its code, its line and a hint, so an
agent can fix what it wrote and run it again. `--format json` gives the same as data: every diagnostic with its `code`,
`hint`, `line` and `column` (and its `file` when it is in another file of the model, a part or a library), each expectation's `outcome` and `reasons`, the first limit and each component's
headroom. `loadmap fmt` lays a file out the one way, so a diff shows only what changed.

```bash
npx @loadmap/cli check shop.loadmap --format json
npx @loadmap/cli fmt shop.loadmap
```

[Errors and versions](/language/errors/) lists every code; [The command line](/recording/) every flag.

## In an editor

`loadmap lsp` is a language server: completion, hover, diagnostics, rename and formatting in any editor that speaks the
protocol, and to any agent that drives one ([In your editor](/in-your-editor/)). In the browser, a share link carries
a whole definition and opens it in [the editor](/editor/), so an agent can hand a person a model to look at.
