# The language in code

`@loadmap/dsl` reads a `.loadmap` text: it compiles it to the `model`, `view` and page options that `<Loadmap>` takes,
lays it out the one way, and gives an editor what it needs (hover, quick fixes, rename, completion). It reads no disk
and no network: a host hands it the text and, for a model in several files, the other files.
[In code](/language/in-code/) in the language guide has the short version; this page has every export.

## Entries

| Entry                     | What                                                                             |
| ------------------------- | -------------------------------------------------------------------------------- |
| `@loadmap/dsl`            | Compile, format, diagnostics, the editor help, files, share links, the catalog   |
| `@loadmap/dsl/completion` | `completions` and `completionsAcross`: loaded with the first list an editor asks |
| `@loadmap/dsl/add`        | What the editor's catalog picker writes: no promise between versions (see below) |
| `@loadmap/dsl/internal`   | For loadmap's own packages: no promise between versions                          |

The package also ships the language guide and the reference as `dist/REFERENCE.md`, the same text as
[the language guide](/language/) and [the reference](/reference/).

## compile

```ts
import { compile, formatDiagnostic } from '@loadmap/dsl'

const r = compile(source, { path: 'models/shop.loadmap', files })
if (!r.definition) {
  for (const d of r.diagnostics) console.error(formatDiagnostic(d, source))
  throw new Error('the definition does not compile')
}
const { model, view, options } = r.definition
// <Loadmap model={model} view={view} {...options} />
```

`compile(source: string, options?: CompileOptions): CompileResult`. It never throws on a bad text: what is wrong is
in `diagnostics`.

| Option      | What                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| `functions` | `HostFunctions`: what formulas may call beyond the built-in ones, each called with plain values           |
| `catalog`   | The catalog's editions, for `published` statements; by default the one `loadCatalog()` loaded             |
| `snapshot`  | Measured data for the `measure` statements: `fromSnapshot(parseSnapshot(text))` (`@loadmap/core/measure`) |
| `path`      | This text's own path from the project root (`models/shop.loadmap`); default `input.loadmap`               |
| `files`     | The other files the definition may name, by their path from the project root                              |

Without a `snapshot`, every measure is its fallback. `files` is a function `(path) => string | undefined`, a `Map` or
a plain object (the type `Files`). A path the host does not give is an error where it is written (`missing-file`).

`HostFunctions` is `Readonly<Record<string, (...args: any[]) => unknown>>`: the escape hatch for what formulas cannot
say. [What stays code](/language/in-code/#what-stays-code) says when to reach for it. A formula that fails while the
model runs throws a `FormulaError`, with the `span` of the formula and an optional `hint`.

## CompileResult

| Field          | What                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| `ok`           | No errors (warnings may be there)                                                                              |
| `diagnostics`  | `Diagnostic[]`: every error and warning, in order                                                              |
| `definition`   | `{ model, view, options }`; only when there are no errors                                                      |
| `expectations` | Each `expect` line: `{ at, line, column, result, file? }`, `result` a `CheckResult` from core                  |
| `measures`     | Each `measure` as `loadmap pull` reads it: `{ id, metric, label?, provider, query, stat?, minSamples?, unit }` |
| `symbols`      | `DslSymbol[]`: every name the definition declares, and where                                                   |
| `doc`          | The text that was compiled, parsed                                                                             |
| `role`         | `'model'`, `'part'`, `'library'` or `'variant'`: what the text is, said in its head                            |
| `files`        | Every file the definition read, by its path from the project root, the model first                             |

`expectations` and `measures` are empty when the definition has errors. Each expectation is tested on the pessimistic
edge (every capacity at its low bound); [Checks](/checks/) has what `outcome`, `reasons` and `message` say.

`definition.options` (`DefinitionOptions`) is what the text sets beyond the model and the view, as props of
`<Loadmap>`: `speed`, `transition`, `direction`, `rows`, `assumptions` (always a list, maybe empty), `fullScreen`,
`fullScreenMode`, `closed`, and `grid` (the editor's dot grid; only the editor reads it).

A `DslSymbol` is `{ kind, id, span, decl, detail?, file? }`. `kind` is one of `param`, `let`, `fit`, `published`,
`measure`, `metric`, `flow`, `node`, `stage`, `component`, `scenario`, `tier` or `connection`; `span` is where its id
is written, `decl` the whole statement, `detail` a stage's box or a node's kind, and `file` the file it is declared in
when that is not the text that was compiled.

A part or a variant is read through its model: compile its text with `path` and `files`, and `role` says what it is.
A diagnostic, a symbol or an expectation in another file carries its `file`, with its offsets, line and column in that
file.

`LANGUAGE_VERSION` is the language version this build reads, as text (`'1.6'`).

## Diagnostics

```ts
interface Diagnostic {
  severity: 'error' | 'warning'
  code: DiagnosticCode
  message: string
  from: number // offsets in the text: from inclusive, to exclusive
  to: number
  line: number // 1-based, as an editor shows them
  column: number
  hint?: string // the line under the mark: did you mean "orders"?
  data?: Readonly<Record<string, string>> // the names a quick fix needs
  file?: string // when it is in another file of the model
  related?: { file?: string; line: number; column: number; message: string }
}
```

`code` is the kind of problem, stable across rewordings of the message: key a tool on it, never on the text.
`DIAGNOSTIC_CODES` maps each code to one line on what it means; [Errors](/language/errors/#errors) has the table.
`related` points at another place worth reading, such as the line of a library that a misuse is about.

`formatDiagnostic(d, source, file?)` prints one as `loadmap check` does, with the line and a caret under it. `file`
defaults to the diagnostic's own `file`, then `input.loadmap`:

```text
checkout.loadmap:24:17 error[unknown-name]: unknown flow "order"
  24 |   demand: flows.order + flows.events
     |                 ^^^^^ did you mean "orders"?
```

`problems(result, failed?, inconclusive?)` returns the diagnostics with each `expect` that does not hold added, in
source order: `expect-failed` at the `failed` severity and `expect-inconclusive` at the `inconclusive` one (both
`'warning'` by default). An editor keeps them warnings, since the diagram still shows; `loadmap check` passes
`'error'`. An `expect` written with `severity: warn` stays a warning either way.

## format

`format(source)` lays a definition out the one way (what `loadmap fmt` runs) and returns `FormatResult`:
`{ ok, text, diagnostics }`. It works on the tokens, so a formula never changes. With a syntax error `ok` is false and
`text` is the source unchanged. It also rewrites old spellings and raises the `loadmap` line to the lowest version
that has everything the text uses, never lowers it. `FORMAT_WIDTH` (120) is the line length past which one-line
blocks are split. [Formatting](/language/in-code/#formatting) has the rules.

## Editor help

Each takes the text and an offset into it, and reads only what it is given.

| Export                                   | Returns                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `hover(source, offset, definition?)`     | `Hover \| null`: `{ from, to, head, body }`; given the compiled definition, values too |
| `signatureHelp(source, offset)`          | `SignatureHelp \| null`: the builtin or fit the cursor is in, and which argument       |
| `quickFixes(source, diagnostics)`        | `QuickFix[][]`: for each diagnostic in order, its fixes `{ title, changes }`           |
| `definition(source, offset)`             | `Span \| null`: where the name at the offset is declared                               |
| `references(source, offset)`             | `Span[] \| null`: every place the name is written, the declaration included            |
| `rename(source, offset, name, options?)` | `EditResult`: `{ source, changes }`, or `{ error }` when it would not compile          |

`Hover.head` is what the word is, as a line of the language (`flow orders "orders"`); `body` is short sentences, and
with a `definition` (the `r.definition` of a compile) its values at the defaults: a flow's rate, what reaches a stage,
a component's utilization and where it runs out. `SignatureHelp` is `{ name, label, params, active, variadic, doc }`,
`active` the argument the cursor is in from 0.

A `TextChange` is `{ from, to, insert }`. A quick fix keys on the diagnostic's `code` and reads names from its `data`:
the did-you-mean applied, a missing property added, a bare number made a capacity. Each is the smallest change to the
text it was given; apply it only to that text. Most diagnostics have none.

`rename` takes the same `CompileOptions` as `compile`, and refuses a name that is not one, is reserved or taken, or a
result that would not compile where the text did. A box's id is renamed with the stage and the component that take
it.

## Completion

```ts
import { completions } from '@loadmap/dsl/completion'

const { from, to, options } = completions(source, offset)
```

`@loadmap/dsl/completion` is an entry of its own, so an editor loads it with the first list it asks for rather than in
its first load. `completions(source, offset)` returns `Completions`: `{ from, to, options }`, the word being completed
(replace `source.slice(from, to)`) and what may go there, ranked. It reads only the parse and the declared names, never
runs the model: cheap enough for every keystroke.

| `Completion` field | What                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------- |
| `label`            | What the list shows                                                                    |
| `type`             | `'keyword'`, `'property'`, `'variable'`, `'function'`, `'constant'` or `'type'`        |
| `detail`, `info`   | A few words beside the label; the longer help beside the list                          |
| `apply`            | What to insert when it differs from the label: `rate: `                                |
| `snippet`          | A template instead of `apply`: `${1:value}` a field Tab moves to, `${0}` where it ends |
| `boost`            | From -99 to 99: higher fits the place better                                           |
| `edits`            | Other changes made with it, in the same text: the edge a route's next stage needs      |

CodeMirror's snippets and the language server protocol both read `snippet` as written.

## Several files

A model in several files is compiled with them: `compile(source, { path, files })`. These help a host find and move
them:

| Export                              | What                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `imports(source, path?)`            | The head only: `{ role, files }`, each file `{ kind, written, path?, names }`                   |
| `gather(source, { path?, files? })` | Every file the definition reaches: `{ path, files, missing }`                                   |
| `flatten(source, options?)`         | The model as one file that draws and computes the same: `{ text }`, or `{ error, diagnostics }` |

`imports` reports nothing: it is for a host that must fetch the files before it compiles (read the head, fetch what
it names, read their heads). `kind` is `include`, `import`, `part`, `library` or `extends`; `path` is from the project
root, missing when what is written is not a path. `gather` returns the file to open as `path` (the model, also when
`source` is one of its parts), every file it read, and the paths nothing answered as `missing`. `flatten` takes
`CompileOptions`, refuses a library or a definition that does not compile, and drops the comments.

The editor help has a form over a model and its parts. Each takes `WorkspaceOptions`, `{ path?, files?, paths? }`
(`paths` every `.loadmap` of the project, for what a path or an import may complete to), and each place it returns is
a `Located`: a span with its `file` when it is in another file.

| Export                                               | Returns                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| `hoverAcross(source, offset, options?, definition?)` | `Hover \| null`                                                 |
| `definitionAcross(source, offset, options?)`         | `Located \| null`                                               |
| `referencesAcross(source, offset, options?)`         | `Located[] \| null`                                             |
| `renameAcross(source, offset, name, options?)`       | `{ changes }`, each change with its `file`, or `{ error }`      |
| `completionsAcross(source, offset, options?)`        | `Completions` (from `@loadmap/dsl/completion`)                  |
| `libraryOf(name, options)`                           | `{ path, keyword }` of a library in `paths` that declares it    |
| `addImport(source, name, from, options?)`            | The `TextChange` that imports `name` from the library at `from` |
| `importersOf(path, theirs, name, options)`           | The changes in every file that imports `theirs` from `path`     |

`renameAcross` also takes `functions` and `catalog`. A name imported under the library's own (`import { a }`) keeps it
there: the rename writes `import { b: a }`. `addImport` adds the name to an import of that library when there is one,
else a new line at the end of the head, and returns `undefined` for a part or a variant (they import nothing) or a
name already imported. `libraryOf` and `addImport` together are the quick fix for a name a library declares.

## Share links

```ts
import { compile, decodeShare, encodeShare, sharedValues } from '@loadmap/dsl'

const hash = await encodeShare(source, { load: 3 }) // 'v1.…&load=3'
location.hash = hash

const shared = await decodeShare(location.hash)
if ('error' in shared) throw new Error(shared.error)
const { definition } = compile(shared.source, { path: shared.path, files: shared.files })
const initial = definition && sharedValues(definition.model, shared.values)
```

`encodeShare(source, values?, bundle?)` resolves to the hash without its `#`: `v1.` and the text deflated and
base64url-encoded, then every value it is given (`&load=3&pods=6`): pass only the ones that differ from the
defaults, so a later change of a default still reaches the link. For a definition in several files,
`bundle` is `{ path, files }` (`SharedFiles`) and the link starts `v2.`; one file keeps making `v1.`. Both are async:
they deflate with the browser's `CompressionStream`.

`decodeShare(hash)` takes the hash with or without its `#` and never throws: it resolves to `{ source, values, path?,
files? }` or `{ error }`. A link that would unpack to more than `MAX_SHARED_BYTES` (1 MB) is refused. The values are
texts: only the model knows whether `"20"` is a number or the option `"20"`. `sharedValues(model, values)` reads them by
each parameter's kind and keeps only what still fits: known names, options that still exist, numbers clamped to their
range.

A link carries the whole definition, so nothing goes to a server, and it is untrusted input: formulas never reach
`eval`, and every path in a `v2.` link is checked.

## The catalog

A text with a `published` statement (or a connection's `rule:`) needs the catalog of published figures, which no first
load carries.

| Export                   | What                                                                              |
| ------------------------ | --------------------------------------------------------------------------------- |
| `needsCatalog(source)`   | Whether the text names the catalog                                                |
| `loadCatalogFor(source)` | Loads it when the text needs it; never rejects. Await it before `compile(source)` |
| `loadCatalog()`          | Loads it anyway, once: every edition, from loadmap's own data, never from a URL   |
| `loadedCatalog()`        | The editions once loaded, or `undefined`                                          |

```ts
await loadCatalogFor(source)
const r = compile(source)
```

Without the catalog, `compile` says so on the statement that names it (`catalog-not-loaded`). A chunk that failed to
load is tried again on the next call. [Published figures](/language/published/) has the statements; the catalog itself
is `@loadmap/core/catalog` ([Media, simulation and layout](/api/more/#the-catalog-loadmap-core-catalog)).

## @loadmap/dsl/add

`@loadmap/dsl/add` is what the editor's **Add → From the catalog** writes: `addPublished(source, pick, options?)`
returns the text with a `published` statement added and a new box that uses it (or a box's capacity set to it), as
`{ source, changes, id, box }`, or `{ error }` when the definition would gain an error. `catalogFlows(source)` lists
the flows a new box can go on, `catalogBox(component)` and `catalogStage(component, ends)` the box and stage a kind
runs, and `catalogDemand` how a new box's demand meets its figure's unit. It is an entry of its own so it loads with
the catalog picker, and its header says it is for loadmap's own editors, with **no promise between versions**: build
on it knowing it can change in any release.

## Not covered here

`@loadmap/dsl/internal` holds what only loadmap's own packages use: the inspector's `inspect`, `edit` and
`setProperty` (the smallest replacement of a value in the text, refused when the result would not compile),
`pageOptions` (a definition's options as `<Loadmap>` props, the unset ones left out), the parser, the schema and the
lexer. It promises nothing between versions.
