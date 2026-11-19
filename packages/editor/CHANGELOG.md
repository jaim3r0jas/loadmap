# @loadmap/editor

## 0.40.0

### Minor Changes

- 5f10219: Two more starters in New: **Sharded store** (writes split across shards by key, so the hottest shard runs out first)
  and **Slow partner API** (a partner that slows as it fills, a client timeout, and retries that add load when it is
  slowest). Each compiles clean, keeps its expectations and lays out without a collision, like the ten before them.

  Docs: /examples/#starters

### Patch Changes

- Updated dependencies [3531ca3]
- Updated dependencies [2189dae]
  - @loadmap/dsl@0.40.0
  - @loadmap/react@0.40.0
  - @loadmap/core@0.40.0

## 0.39.0

### Minor Changes

- 5279bd9: View sets the code's font, its size and its ligatures, each the reader's own and kept in the browser: the system's
  monospace, Fira Code, JetBrains Mono or Cascadia Code (SIL Open Font License, about 36 to 49 kB each, fetched only when
  picked, never in a first load), a size from 11 to 20 px (13 by default; at least 16 on a phone), and ligatures on or
  off (`->` drawn as one arrow, or as its two marks). The new `fonts` prop says which fonts View offers and where their
  files are: `CODE_FONTS` (exported) by default, from fontsource on jsDelivr at a pinned version; the docs site serves
  its own copies.
- ff26ddd: While ligatures are on, the editor draws a capacity's `+-` (and `+/-`) as `±`, in the room of its marks, the way a
  font joins `->`: the text keeps its marks (copy, undo, the file and a share link are as written), the cursor steps
  over the sign as over one character, and Backspace takes one mark at a time. A `+-` in a text, or in a file stamped
  before 1.6 (where it is a plus and a minus), is drawn as written, and so is every `+-` with ligatures off.
- 99062f1: ⌘S (Ctrl+S, with or without Shift) in the editor never opens the browser's Save Page. With the new `onSave` prop the
  page saves every file of the definition (a branch, a file of its own), one save at a time, and the bar says Saved or
  why not; without it the bar says what keeps the text: "Kept as you type" when the page keeps a draft, or that it keeps
  no copy and Share does. View → Keyboard shortcuts lists the key. The docs' editor page takes the key wherever the
  focus is.

### Patch Changes

- Updated dependencies [52c0325]
  - @loadmap/dsl@0.39.0
  - @loadmap/react@0.39.0
  - @loadmap/core@0.39.0

## 0.38.1

### Patch Changes

- f0f58c9: The editor's keys held with ⌥ work on a Mac, on any keyboard layout. ⌥ with a letter types a character or starts a
  dead key there, so ⌥I (what fits at the cursor), ⇧⌥F (format) and ⇧⌥M (Tab moves on) never ran: they now find
  their binding by the key pressed, and a key no binding takes still types its character (⌥L is @ on a German Mac).
  ⌘I also lists what fits at the cursor on a Mac, as in VS Code, since macOS takes ⌃Space to switch the input source;
  selecting the block around moves from ⌘I to ⌃⇧⌘→ there.
- @loadmap/core@0.38.1
  - @loadmap/dsl@0.38.1
  - @loadmap/react@0.38.1

## 0.38.0

### Minor Changes

- bbf3d7a: Add → From the catalog asks how flows use the new box: the stage where its kind has two (flows end here, or go on),
  a queue's partitions and the rule the pool after it reads by (`kafka/consumer-group`), a cache's hit ratio, what one
  unit is worth in a figure's unit that counts no units a second (tpmC), and which flows pass it and where on each
  route. It says the demand in words, shows the lines it adds and takes out before it adds them, and says why when it
  cannot.
- aca02dd: The editor's keys are found where a reader looks. View → Keyboard shortcuts lists them for the platform it runs on:
  what fits at the cursor (Ctrl+Space, on a Mac also ⌥I), go to a definition, rename, format, find and replace, the
  editing and moving keys, and how to leave the text with the keyboard. An empty text says how to start. Ctrl+F (⌘F)
  finds and replaces in the text, which the browser's find cannot (the editor draws only the lines in view): its code
  loads with the first search. On a phone the row over the keyboard has Suggest and Find.

### Patch Changes

- a538b85: Completion ranks by what the model already says. In a route, the stages an edge joins to the last one come first; the
  others come last and draw the edge they need when picked (in VS Code too, as an additional edit). `from:` offers the
  nodes that run no stage first, an edge leaves out what is drawn already and offers where a route goes next first, and
  `partitions`, `held` and a connection's `flows` offer the flows that pass there first. A box with one queue of another
  name is offered once, by its stage, and a subsystem never next to its own boxes. Completion's code is an entry of its
  own, which the editor loads the first time the text has the focus. The language server opens the list after `{` and `[` too.
- aca02dd: **`completions()` and `completionsAcross()` move to `@loadmap/dsl/completion`**: `import { completions } from
  '@loadmap/dsl/completion'`. The main entry no longer exports them (their types `Completion` and `Completions` stay):
  while it did, every bundler kept completion in the first load of a page that imports anything from `@loadmap/dsl`, and
  the editor, which now loads it with its first list, starts about 7 kB lighter.
- Updated dependencies [7bd53ff]
- Updated dependencies [bbf3d7a]
- Updated dependencies [ceaab31]
- Updated dependencies [a538b85]
- Updated dependencies [aca02dd]
  - @loadmap/core@0.38.0
  - @loadmap/dsl@0.38.0
  - @loadmap/react@0.38.0

## 0.37.0

### Minor Changes

- 894e762: The dot grid behind the diagram is the reader's own setting, kept in the browser: **View → Dot grid** no longer writes
  `grid: false` into the definition (language 1.5 dropped it; a file from before that says it still starts with it off).
  The templates are written in language 1.5.
- 1604f87: The files' explorer lists under each file the subsystems it declares, one in another indented under it, each by its
  name; a click (or Enter) opens the file at that subsystem's line. The board picks the box under the cursor there, as a
  click in the text does. A file shown already opens at a place in it too (go to definition within one file).

### Patch Changes

- Updated dependencies [894e762]
- Updated dependencies [10197af]
- Updated dependencies [10197af]
- Updated dependencies [2e0108e]
- Updated dependencies [9105983]
  - @loadmap/dsl@0.37.0
  - @loadmap/core@0.37.0
  - @loadmap/react@0.37.0

## 0.36.0

### Minor Changes

- 87500d1: The editor's files: snug tabs in one row for the open files (close one and the file stays, a dot marks a file with
  errors), and a files' explorer beside the text, a tree by folder that opens a file as a tab and adds, renames and
  removes files, the `include`, `import`, `part of` and `extends` lines following. A definition in several files now
  opens on its model alone. Fixed: the file tabs took no height in a filling editor.

### Patch Changes

- Updated dependencies [a5811ae]
  - @loadmap/dsl@0.36.0
  - @loadmap/react@0.36.0
  - @loadmap/core@0.36.0

## 0.35.0

### Patch Changes

- Updated dependencies [4122ae6]
- Updated dependencies [379e4b8]
- Updated dependencies [035f607]
- Updated dependencies [32d5683]
  - @loadmap/dsl@0.35.0
  - @loadmap/react@0.35.0
  - @loadmap/core@0.35.0

## 0.34.0

### Minor Changes

- d77314a: A definition in several files, from `loadmap 1.3`, which this opens: a new definition starts with `loadmap 1.3`, and
  the templates and examples say it. A file stamped `loadmap 1`, `1.1` or `1.2` reads as it did, and one file is still
  a whole definition.
  - **Parts:** a model says `include "./shop.story.loadmap"`, the part `part of "./shop.loadmap"`. Its statements are the
    model's; it says the model's version.
  - **Libraries:** `library "…"` holds values (`let`, `fit`, `metric`, `measure`, `tier`, `published`), boxes with
    inputs and subsystems; a model takes them by name, `import "./platform.loadmap" { postgres; pool: podPool }`.
  - **Inputs:** `input pods = 3` in a library's box or subsystem, set in `with { … }` by the box that is `like:` it;
    `input flow main` takes a flow's name.
  - **Subsystems:** `subsystem orderLine "Orders" { like: pipeline; with { … } }` is several boxes as one, each named
    `orderLine.<name>`; with a `route:` of its own, a flow's route and an edge may name the subsystem.
  - **Variants:** `extends "./shop.loadmap"` is a model with other defaults and values.
  - `compile(source, { path, files })`: the host gives the files, the compiler reads none. A diagnostic and a symbol in
    another file carry `file`. New: `imports`, `gather`, `flatten`, and `definitionAcross`, `referencesAcross`,
    `renameAcross`, `hoverAcross`, `completionsAcross`.
  - A share link with more than one file is `#v2.`; one file still makes `#v1.`.
  - `loadmap check`, `pull`, `drift` and `record` read a definition with its files, inside the project root;
    `--format json` adds `file` to a diagnostic of another file. `loadmap fmt` on a model sets its parts' versions.
    New: `loadmap bundle <model.loadmap>` writes the definition as one file.
  - The language server and the VS Code extension: problems in the file they are in, definition, references and rename
    across a model's files, completion of paths, imports and inputs, a quick fix that imports a name, and the preview
    of a part (its model) and of a library (its own boxes).
  - The editor shows each file as a tab; `<LoadmapSource>` takes `files` and `path`.
  - A name with a dot (`a.b`) that is no table is now read as one name: where it names nothing, the error says so
    as before.

### Patch Changes

- 00b4a76: Several files, what was left:
  - An input set with a formula is checked against its default: the same type (`wrong-type`), and where both say a
    unit, the same one (a `unit-mismatch` warning).
  - Hover on a box that is `like` another lists the inputs it sets. The inspector lists each line the box takes from
    the other, as written there; "Write here" puts it in the box, to change it there.
  - Rename in the editor reaches every file of the model: the other tabs change too.
- 8c9bc5d: Language 1.2 is open: a new definition starts with `loadmap 1.2`, and the templates and examples say it. A file stamped
  `loadmap 1` or `loadmap 1.1` reads as it did.
- b537430: Undo and redo of a rename that reached several files take it back, or make it again, in every one of them, from
  whichever tab it is undone in. A file edited since keeps the name it has, and the editor says so.
- 825b334: A new warning, `shadowed-name`: an id that names two kinds of thing (`param pods` beside `pool pods`, where `${pods}`
  reads the parameter and `focus: pods` the box), or that is also a keyword of the language (`param merge`,
  `pool workers`). A box, its stage and its component still share one id. It needs no language version, and nothing
  computes differently. The templates and examples have ids of their own now: `workerPool`, `readCache`, `rateLimit`, …
- c7822a5: A `view { … }` block, from `loadmap 1.2`, holds what only changes how the page looks and plays: `speed`, `transition`,
  `fullScreen`, `fullScreenMode`, `lanes` and `grid`. They stood at the top beside what the model computes from. In a 1.2
  file a setting at the top still works and warns (`deprecated`, with a quick fix), and `loadmap fmt` moves it into the
  block, a comment above it too; a file stamped before 1.2 keeps them at the top, silently. The editor's View menu
  writes into the block.
- Updated dependencies [4911a7c]
- Updated dependencies [ae1a0e3]
- Updated dependencies [59c1182]
- Updated dependencies [75ca614]
- Updated dependencies [00b4a76]
- Updated dependencies [d77314a]
- Updated dependencies [bc97bf4]
- Updated dependencies [8c9bc5d]
- Updated dependencies [47ab0ae]
- Updated dependencies [825b334]
- Updated dependencies [335c55d]
- Updated dependencies [c7822a5]
  - @loadmap/dsl@0.34.0
  - @loadmap/react@0.34.0
  - @loadmap/core@0.34.0

## 0.33.0

### Minor Changes

- 4cb38e2: The language checks units where the text says them. `flows.x` and `at.stage.x` are units a second, a number with a
  unit is what it says, a fit returns its y (`points rate cores` gives cores), and `demand: … as "cores"` declares the
  rest. A demand per second against a capacity that counts something (`"cores"`), the reverse, or two counts in different
  words (`"cores"` against `"connections"`) is a warning, and so is a component without a demand line whose capacity is
  not per second, an `as` its formula contradicts, and an empty unit. The schema gives the properties that are times,
  shares or rates their unit (`held`, `service`, `timeout`, `p99`, `olderThan`, `hit`, `share`, `rate`, …), so
  `held: 80%` warns too, and the reference says each one's. A bare number is any unit: every definition from before
  compiles as it did, without a new warning. The editor and the VS Code grammar colour `as` as a keyword.
- 5da4dd3: Numbers with units in the language. A number may carry its unit straight after it: `ms`, `s`, `min` and `h` count in
  seconds (`held: 20ms` is `held: 0.02`, `timeout: 5s` no longer fails), `%` makes a share (`hit: 80%`), and `×` (or
  `x`) marks a load multiple. A `%` is a share only where no value follows it, so `10 % 3` is still the remainder and
  `± 30%` means what it did. A word glued to a number that is not a unit (`5sec`) is one error that lists the units. The
  inspector changes such a number as written and keeps its unit; the editor and the VS Code grammar colour the unit as
  part of the number. The examples, the templates and the reference write durations and shares this way instead of
  saying the unit in a comment.

### Patch Changes

- af8d8d9: Every diagnostic has a code: the kind of problem (`unknown-name`, `missing-edge`, `unseen-loss`, …), which stays when
  its message is reworded. `Diagnostic` gains `code` and `data` (the names a quick fix needs), and `@loadmap/dsl` exports
  the list as `DIAGNOSTIC_CODES` (type `DiagnosticCode`); docs/dsl.md lists them under Errors. A host that builds its
  own `Diagnostic` now gives it a `code`. Quick fixes key on the code
  and read names from `data`, never from the message. The text output shows the code in brackets
  (`checkout.loadmap:24:17 error[unknown-name]: unknown flow "order"`); `loadmap check --format json` gives each
  diagnostic its `code`, `hint`, `endLine` and `endColumn`; a GitHub annotation is titled with the code, and `loadmap lsp`
  sends it. Ids in messages are quoted: `"orders" goes from "gateway" to "api", and no edge joins them`, `units of "o"
  too slow for their client at "a" vanish: …`.
- 31404e8: Language versions with a minor: `loadmap 1.1`. `loadmap 1` reads as 1.0, the language of @loadmap/dsl 0.32, and a
  file keeps compiling as it did under the version it names: a check a later version makes strict is a warning before it
  ("… (an error from loadmap 1.1)") and an error from it on, so a hop without its edge in a `loadmap 1` file warns and
  its dots cross straight, as they did. Something a version added (`lost` boxes, numbers with units, `as` after a
  demand: 1.1) needs that version on the first line, an error with a quick fix that writes it, so a loadmap too old for
  it says "update @loadmap/dsl" instead of "unknown statement" (one from before this release reads `loadmap 1.1` that
  way already). `loadmap fmt` raises the first line to the lowest version that has everything the file uses, and never
  lowers it; `1.10` comes after `1.9`. The reference says which version added a statement, and docs/dsl.md has the rule
  and a table of versions. `LANGUAGE_VERSION` is now a string, `'1.1'`. The templates, examples and docs' definitions
  say `loadmap 1.1`.
- bb279a9: New names for words that meant two things. In `expect`, `target: 7` and `full: 50` were load multiples while
  `thresholds` and `autoscale` use `target` for a utilization; they are now `underTarget: 7` and `notFull: 50`
  (`underTarget: 7×` reads well). A metric's `min` (a sample count) is `minSamples`, a workers stage's `fill` (a
  placement, not a colour) is `placement`, and a connection's `max` (a capacity) is `accepts`. The new names are from
  loadmap 1.1. In a `loadmap 1.1` file the old ones still work and warn ("target is now underTarget"), with a quick fix
  that renames them, and `loadmap fmt` rewrites them; in a `loadmap 1` file they are that version's spelling, read as
  before, with no warning. TypeScript follows: `Expectation.underTarget` and `notFull`, `ConnectionDef.accepts`,
  `workers(…, { placement })` and `PullRequest.minSamples`, with the old names kept as `@deprecated`; a resolved workers
  stage and `compile(…).measures` give `placement` and `minSamples`. A snapshot file still says `min` beside its
  `samples`. A stage without a label now takes its component's `short` when no other stage runs that component, so the
  sentences and meters say "the gateway" without a second `pass "the gateway"`.
- Updated dependencies [189d8db]
- Updated dependencies [af8d8d9]
- Updated dependencies [9065003]
- Updated dependencies [31404e8]
- Updated dependencies [91c3aad]
- Updated dependencies [8b8bfca]
- Updated dependencies [bb279a9]
- Updated dependencies [53b3f54]
- Updated dependencies [4cb38e2]
- Updated dependencies [5da4dd3]
- Updated dependencies [fcbf7ec]
  - @loadmap/dsl@0.33.0
  - @loadmap/core@0.33.0
  - @loadmap/react@0.33.0

## 0.32.0

### Patch Changes

- Updated dependencies [f2c3fd3]
- Updated dependencies [c302028]
- Updated dependencies [9cc0ccd]
- Updated dependencies [53b93be]
- Updated dependencies [7f55166]
- Updated dependencies [55c4e7f]
  - @loadmap/core@0.32.0
  - @loadmap/dsl@0.32.0
  - @loadmap/react@0.32.0

## 0.31.0

### Patch Changes

- Updated dependencies [11b78ee]
- Updated dependencies [0ab6855]
- Updated dependencies [717b95e]
- Updated dependencies [9cf2028]
- Updated dependencies [de327ef]
- Updated dependencies [0fb5d08]
- Updated dependencies [b9b71c3]
- Updated dependencies [0097fc9]
- Updated dependencies [ed5d6d2]
  - @loadmap/core@0.31.0
  - @loadmap/dsl@0.31.0
  - @loadmap/react@0.31.0

## 0.30.1

### Patch Changes

- 9bd542b: The VS Code extension tracks live changes and adds from the catalog, as the editor does: an eye over the preview
  (`loadmap.preview.trackChanges`) brings the boxes each edit changed into view and marks them, and **loadmap: Add from
  the Catalog…** (a command, a preview button, a code action in a box) picks a component and one of its published runs,
  then writes a `published` statement and a new box or the box's capacity. What an edit changed now comes from
  `@loadmap/dsl/internal`, which the editor and the extension share.
- Updated dependencies [9bd542b]
  - @loadmap/dsl@0.30.1
  - @loadmap/react@0.30.1
  - @loadmap/core@0.30.1

## 0.30.0

### Patch Changes

- Updated dependencies [1f11726]
  - @loadmap/core@0.30.0
  - @loadmap/react@0.30.0
  - @loadmap/dsl@0.30.0

## 0.29.0

### Minor Changes

- a71e332: Every tier lane is filled: the first, third… in the new theme token `--lm-tier-base`, the others in `--lm-tier`, with
  the lane shades and headers a step apart in both themes. `lanes: striped` (`lanes: 'striped'` in the view) brings back
  every other lane clear. A tier can have a colour of its own, `tier data "Data" { fill: "#e6f2ec"; fillDark: "#1c2b26" }`
  (`fill` and `fillDark` beside its `label` in TypeScript); without `fillDark`, dark keeps the colour's hue as dark as the
  theme's lanes, and `fillDark` alone leaves light the theme's. In a definition a colour is hex, `rgb()` or `hsl()`:
  `compile` refuses anything else, such as a `url(…)` that would fetch from a shared link, and now also what only looks
  like one (`"#12345"`, `"rgb(1)"`), for flows' colours too. Exports write a lane's own colours in rgb, as they write the
  theme's tokens.

  In the editor, **View** switches the lanes' fills and the canvas's dot grid (`grid: false`, read only by the editor),
  which now shows through the lanes; the model's tab gives each lane a light and a dark colour, and Reset takes them out.
  Each is one edit of the text: `setProperty` writes, changes or takes out a property of the definition or of a tier.

### Patch Changes

- Updated dependencies [a71e332]
  - @loadmap/react@0.29.0
  - @loadmap/dsl@0.29.0
  - @loadmap/core@0.29.0

## 0.28.0

### Minor Changes

- 4a9b36b: The editor adds from the catalog: New → Add → From the catalog picks a component, the conditions of one of its
  published runs and shows the figure they give, with its source, or says there is none. It writes text only: a
  `published` statement, and a new box or the selected box's capacity. `catalog={false}` leaves it out. In the reader layout, the inspector shows a
  published statement's conditions as the values its runs used. A constant `demand: 0` now compiles (it read as missing,
  and `demand: 5` failed to evaluate).

### Patch Changes

- Updated dependencies [4a9b36b]
  - @loadmap/dsl@0.28.0
  - @loadmap/react@0.28.0
  - @loadmap/core@0.28.0

## 0.27.0

### Patch Changes

- 4346ee1: The `.loadmap` language takes published figures: `published brokersRef kafka { edition: "2026-11"; brokers: 3; … }`
  names a component of the catalog and the conditions of its run, and `capacity: brokersRef` uses the figure. The
  checker names a component, condition, edition or figure that does not exist (and which component covers `redis`),
  warns when the conditions written match no published run, and says when a later edition has other figures;
  autocomplete offers the components, their conditions and the values their runs used, hover the figure with its
  conditions and source. The catalog loads only for a text that names it: `loadCatalog()` (and `needsCatalog(text)`)
  from `@loadmap/dsl`; `<LoadmapSource>`, the editor, the CLI and the language server load it themselves.
- Updated dependencies [6408be2]
- Updated dependencies [4346ee1]
  - @loadmap/core@0.27.0
  - @loadmap/react@0.27.0
  - @loadmap/dsl@0.27.0

## 0.26.1

### Patch Changes

- Updated dependencies [108ff09]
- Updated dependencies [0d5fa74]
- Updated dependencies [8aba396]
- Updated dependencies [08d4af1]
- Updated dependencies [42d7068]
- Updated dependencies [43a38f2]
  - @loadmap/react@0.26.1
  - @loadmap/core@0.26.1
  - @loadmap/dsl@0.26.1

## 0.26.0

### Minor Changes

- e4884f9: **Track live changes** in the editor: a button in the code panel (`track`, `onTrack` for a page to keep it). On, once
  an edit is drawn and the text rests half a second, the board brings the boxes it changed into view, at the same zoom
  and further out only as far as it takes, and marks them with a short glow: a box whose lines the edit is in, one a
  changed line names (an edge, a route), one that is new or another size, the ends of an edge that came or went. Off,
  the view stays where the reader left it. `LoadmapHandle.show(ids)` brings boxes into view on a board that zooms.

### Patch Changes

- Updated dependencies [e4884f9]
  - @loadmap/react@0.26.0
  - @loadmap/core@0.26.0
  - @loadmap/dsl@0.26.0

## 0.25.0

### Patch Changes

- 46b101d: A new model or view keeps the board: the diagram moves from what it drew to the new structure, as it does between
  scenarios, instead of starting again empty and fitted. The view the reader zoomed to stays, the box nearest its middle
  held still on the board while the rest moves around it (between phases too), and a view the reader never moved stays
  fitted. In the editor an edit keeps the zoom; a whole new text (a template, a shared link) still starts fitted.
- Updated dependencies [46b101d]
- Updated dependencies [1d0cc1f]
  - @loadmap/react@0.25.0
  - @loadmap/dsl@0.25.0
  - @loadmap/core@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [37f2425]
  - @loadmap/react@0.24.0
  - @loadmap/core@0.24.0
  - @loadmap/dsl@0.24.0

## 0.23.0

### Minor Changes

- be481d6: Snippets, quick fixes, go to definition, references and rename. A statement typed at the start of a line completes as
  a snippet built from the schema: its id and label, its required properties, and for a box a stage and a capacity.
  `quickFixes(source, diagnostics)` gives each diagnostic's fixes as text changes: the did-you-mean applied (a name, a
  property, a scenario), a missing required property added in the block's own layout, a bare number made
  `estimated(…)` or `measured(…)` in the file's unit, a stray ":" before an edge's block dropped. `definition` and
  `references(source, offset)` find where a name is declared and every place it is written, and `rename(source, offset,
  name)` renames it everywhere: a box's id with the stage and the component that take it, a scenario's label quoted
  where it must be; it refuses a name that is not one, is reserved or taken, and a result that would not compile.

  In the editor: a diagnostic's tooltip offers its fixes, F12 or a click with Cmd or Ctrl goes to the declaration, the
  other uses of the name under the cursor are marked, and F2 (or Rename over a phone's keyboard) opens a field to rename
  it. The editor's budget is 170 kB.

### Patch Changes

- Updated dependencies [d8fa10d]
- Updated dependencies [be481d6]
  - @loadmap/dsl@0.23.0
  - @loadmap/react@0.23.0
  - @loadmap/core@0.23.0

## 0.22.0

### Minor Changes

- ce0027b: Hover and signature help. `hover(source, offset, definition?)` says what a word is: a statement or a property (its
  doc from the schema), a builtin (its arguments), a name the definition declares, with its values at the defaults when
  given the compiled definition: a flow's rate and route, what of it reaches a stage, a component's utilization, demand
  against capacity, how sure the capacity is and where it reaches the target and runs out, a `let`'s value, a
  parameter's choices, a tier's boxes, what a scenario sets. The values come from the compiled model's own evaluation,
  never from evaluating text. `signatureHelp(source, offset)` names the arguments of the builtin or fit the cursor is
  in, and which one it is writing.

  The editor shows both: a hover over a word (while the text has an error, with the values of the last version without
  one, and a line that says so), and over the cursor inside a call its arguments, the one being written marked, on a
  phone too. Completion, hover and signature help are one entry of the packed dsl, so a page that only reads a
  definition never loads them.

### Patch Changes

- Updated dependencies [ce0027b]
  - @loadmap/dsl@0.22.0
  - @loadmap/react@0.22.0
  - @loadmap/core@0.22.0

## 0.21.0

### Minor Changes

- 2506c27: Completion knows where the cursor is. A capacity offers `measured`, `estimated` and `configured` first, as snippets
  that fill in value, unit and source field by field; after its value comes `± 30%`; its unit offers the units the file
  already uses. A box's `demand` offers the flows that reach it first, `at.<stage>.` only the flows that pass that stage,
  a route the stages next along an edge first, a `when` the switches. Nothing that reads itself is offered (a `let`'s own
  name, a component's own `util`), nor a property the block already sets, nor anything inside a comment or a plain text;
  a template's `${…}` completes by where the template is. A scenario, preset or step offers a parameter's options, and so does the parameter's own `default`; `tier:` offers the
  tiers, wherever they are declared.
  Builtins come with their arguments and a line of help. Completion reads the parse alone, never runs the model, so it
  costs a small part of a compile on every keystroke: `completions(source, offset)` no longer takes a compile result.

  A block left open while typing (`flow q {` without its `}`) ends at the next top-level line instead of taking the rest
  of the file, so the diagnostics and completions below it stay right; a file whose braces balance reads as before.

  The editor closes brackets and quotes as they are typed, and opens the list after `(`, `,`, an operator or a quote. Tab
  moves through a snippet's fields and then out of the call; on a phone the ⇥ key over the keyboard does the same. Where
  there is no room beside the list (a phone), its help goes under the list instead of over the options after the one
  selected.

### Patch Changes

- Updated dependencies [2506c27]
  - @loadmap/dsl@0.21.0
  - @loadmap/react@0.21.0
  - @loadmap/core@0.21.0

## 0.20.0

### Minor Changes

- 267b1e8: The code is a panel on the editor's left, built like the side panel on its right: the same header, frame and rail,
  each resized by its inner edge and folded onto a rail, the diagram's canvas in the room between them (Fit frames it
  there). The side panel resizes too (`panelWidth`, `onPanelWidth`), folds with › and unfolds from its rail with a
  click; only where it cannot pin does its rail open it over the canvas, on a hover as before. A folded code panel's
  rail counts the text's problems. Over the canvas, the scenarios and load, the story, the legend and the zoom share
  one surface; the load sits beside its label and the story beside its buttons in a narrow canvas. In the side panel
  each part drops its own box and heading for the section's, and the code's gutter takes the panel's surface.

### Patch Changes

- @loadmap/core@0.20.0
  - @loadmap/dsl@0.20.0
  - @loadmap/react@0.20.0

## 0.19.1

### Patch Changes

- 34be827: An editor in a narrow column (not `fill`, below 560 px of its own width) keeps its own controls on one row: Hide code, Format, New and Export fold into one ⋯ menu, under the headings View, Templates and Export; a page's `start` and `actions` stay in the bar. When the column hides the control the keyboard is on, the keyboard moves to the bar's next stop, and a menu whose button goes closes.
- @loadmap/core@0.19.1
  - @loadmap/dsl@0.19.1
  - @loadmap/react@0.19.1

## 0.19.0

### Minor Changes

- 5e43a04: A new top bar for the editor: one row of one height at every width, the model's title at its start, then **New** (the templates, now a menu with a line for each), **Export** (the `.loadmap` file) and **Share**, a split button whose menu has **Embed in a page…**. Its tools are one stop for Tab, with the arrow keys between them; each menu opens from the keyboard and Escape closes it. `newItems` and `exportItems` add a page's sections to the two menus. On a phone, the sheet behind ⋯ groups the same actions under headings, the templates on a page of their own. The template list, the phone's sheet and the inspector now load when first needed.

### Patch Changes

- @loadmap/core@0.19.0
  - @loadmap/dsl@0.19.0
  - @loadmap/react@0.19.0

## 0.18.0

### Minor Changes

- 6ea0ac4: The filling editor floats the load bar (the scenarios and the load) over the canvas's top, the diagram fitted under it, and its panel's "Load and design" is "Design". On a phone the sheet's peek keeps the slider, now with its coloured track and marks.

### Patch Changes

- Updated dependencies [49ca1e8]
- Updated dependencies [9fab44b]
  - @loadmap/react@0.18.0
  - @loadmap/core@0.18.0
  - @loadmap/dsl@0.18.0

## 0.17.1

### Patch Changes

- Updated dependencies [82906fb]
  - @loadmap/react@0.17.1
  - @loadmap/core@0.17.1
  - @loadmap/dsl@0.17.1

## 0.17.0

### Minor Changes

- 4d2870e: The filling editor on a phone (below 720 px wide, or 500 px high): the text or the diagram, switched by Diagram and Code at the bottom in thumb reach; the diagram a canvas a finger pans and two pinch, fitted above a sheet of panels that rests at peek (the verdict and the load slider), half or full, dragged, tapped or stepped with the arrow keys, the inspector in it while the text is hidden; ⋯ opens every other action in a sheet from the bottom; typing, the text is 16 px, the switch steps aside and a row of keys sits on top of the keyboard (Format, Undo, an indent, braces, quotes, Done); the bars clear the notch and the home bar, and every target is 44 px. The caret is drawn in the theme's text colour, light on a dark theme, where it was black. `LoadRange`, the load slider alone, is exported from `@loadmap/react`.

### Patch Changes

- Updated dependencies [4d2870e]
  - @loadmap/react@0.17.0
  - @loadmap/core@0.17.0
  - @loadmap/dsl@0.17.0

## 0.16.0

### Minor Changes

- f72ffed: The filling editor is a canvas. `<LoadmapEditor fill>` draws the diagram filling what the bar leaves, the reader panning and zooming it (Fit frames the whole diagram in the room left free), the text floating over its left in a card with its status, Format and ‹ to hide it, and the verdict, the controls, the limits, the headroom, the scenarios compared, the live meters and the assumptions in a side panel on its right, each folding; the scenarios float over the canvas's top and the story over its bottom. The card starts at 440 px and its edge resizes it from 360 px to 60 % of the width (dragged, the arrow keys, a double-click puts it back); `split` and `onSplit` are its share of the width now. Hidden, the text leaves a tab, and the inspector shows in the panel. The panel is pinned from 1280 px wide and on `auto` below: a rail with the verdict's tier and the first limit's multiple that opens it over the canvas on a hover, a click or a tap, and closes it once the pointer leaves, on Escape or on a press on the canvas. `panel` and `onPanel` keep the reader's choice, `onLayout` whether the text shows. Below 720 px it stays one pane at a time. The ten templates' texts load when one is picked, so the editor loads 4 kB less.

### Patch Changes

- @loadmap/core@0.16.0
  - @loadmap/dsl@0.16.0
  - @loadmap/react@0.16.0

## 0.15.0

### Patch Changes

- 1405fc9: A diagram the reader pans and zooms. `<Loadmap zoom>` (and `useLoadmap`, `<LoadmapSource>`) puts the zoom buttons on the board (− · the zoom · + · Fit): a drag pans, with a hand to hold it by, and a press that hardly moves is still a click on a box; a pinch zooms about its middle; the keys + − 0 and the arrows work while the board or a box has the focus, and a box the keyboard reaches outside the view comes into it. The wheel zooms about the pointer with Ctrl or ⌘ held (a trackpad's pinch too), so a page that scrolls keeps its wheel, and one finger scrolls the page until the reader zooms in. The zoom goes from 10 % to 400 % of one pixel a scene unit, a large diagram down to half its fit, and a diagram can never be dragged out of sight. `<Diagram canvas>` makes the board fill its container, as a canvas the wheel alone zooms, with no Full screen button; `canvas={{ left: 420, right: 340 }}` names the pixels the page floats over it, and Fit frames the whole diagram in what they leave. Play starts from the reader's view and flies out to the whole diagram; a drag while the story plays stops it where it is, and it ends fitted. With reduced motion the buttons and the keys jump. The code that pans and zooms loads with the first board that does: a page without `zoom` loads nothing more. Pictures, posters, GIFs and videos show what the camera frames, never the reader's view, as before. Full screen's compact panels and a box's detail now load when the reader first asks for them, so a `<Loadmap>` page loads less than before. The editor's diagram pans and zooms.
- Updated dependencies [1405fc9]
  - @loadmap/react@0.15.0
  - @loadmap/core@0.15.0
  - @loadmap/dsl@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [7886094]
  - @loadmap/react@0.14.0
  - @loadmap/dsl@0.14.0
  - @loadmap/core@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [2d8c547]
  - @loadmap/dsl@0.13.0
  - @loadmap/react@0.13.0
  - @loadmap/core@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [497f671]
  - @loadmap/core@0.12.0
  - @loadmap/dsl@0.12.0
  - @loadmap/react@0.12.0

## 0.11.0

### Minor Changes

- 6561c3d: A loadmap made to be framed. `<Loadmap fill>` (and `<LoadmapSource fill>`) fills its container laid out as full screen is, in `fullScreenMode`, for good: no full screen button, nothing scrolls; for a page of its own in an iframe, whose layout follows the frame as full screen follows the screen. `sharedValues(model, values)` in `@loadmap/dsl` reads a shared link's values by each parameter's kind and keeps only what still fits the model, as the editor does. `<LoadmapEditor embedLink={(hash, o) => url}>` puts "Copy embed link" beside "Share link": a menu that picks what the embed shows (`EmbedOptions`: the diagram, the default, or the panels too, the theme, the story played when it comes into view) and copies the link, or an `<iframe>` with it. The docs site has the page those links open, at `/embed/`, and a page on embedding in ClickUp and any page.

### Patch Changes

- Updated dependencies [6561c3d]
- Updated dependencies [6561c3d]
  - @loadmap/react@0.11.0
  - @loadmap/dsl@0.11.0
  - @loadmap/core@0.11.0

## 0.10.0

### Minor Changes

- ad0835d: `<LoadmapEditor fill>` fills its container, as a page of its own: the bar, then the text and the diagram side by side
  with a divider to drag (or move with the arrow keys; a double-click puts it back), each side scrolling on its own.
  Below 720 px wide, tabs switch between the text and the diagram, and the buttons other than Share fold into a menu.
  `start` puts controls at the bar's start (a way back, a name), and `split` with `onSplit` let a page keep where the
  divider was left. Without `fill` nothing changes.

### Patch Changes

- Updated dependencies [4e60946]
  - @loadmap/react@0.10.0
  - @loadmap/core@0.10.0
  - @loadmap/dsl@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [7c5d7b3]
  - @loadmap/core@0.9.0
  - @loadmap/dsl@0.9.0
  - @loadmap/react@0.9.0

## 0.8.0

### Minor Changes

- 0fb1d62: `theme="inherit"` follows the page's own light and dark switch, `data-theme="dark"` or a `dark` class on `<html>`,
  as it changes (the dots and the meters too), and the system's while the page sets none; `usePageTheme(theme)` gives
  the theme it resolves to. `<LoadmapEditor theme="inherit">` does the same. Two tokens fit the root into a card that
  has its own: `--lm-pad` (its padding, 16px) and `--lm-root-bg` (its background); full screen keeps both.

### Patch Changes

- Updated dependencies [25a0575]
- Updated dependencies [25a0575]
- Updated dependencies [68bc952]
- Updated dependencies [0fb1d62]
  - @loadmap/dsl@0.8.0
  - @loadmap/react@0.8.0
  - @loadmap/core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [1ad72b9]
- Updated dependencies [414f759]
  - @loadmap/dsl@0.7.0
  - @loadmap/react@0.7.0
  - @loadmap/core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [1640a0e]
- Updated dependencies [9fe4c1a]
  - @loadmap/dsl@0.6.0
  - @loadmap/core@0.6.0
  - @loadmap/react@0.6.0

## 0.5.0

### Patch Changes

- c1651c6: Full screen fits the screen without scrolling. The diagram stays on top, as wide as the screen; under it the verdict in
  one line (the load, how far the target holds, the first limit, how sure its capacity is) and the panels `fullScreen`
  lists in a compact form, side by side in a box the screen sizes: Live as small meters, where it runs out a line per
  component, the controls a line each, headroom as a sparkline, compare its first table, the assumptions a count. Rows
  that do not fit are left out whole and counted; each compact panel, "Why" and the assumptions open the panel whole over
  the diagram (its button closes it, and Esc in the overlay; the browser's own full screen takes Esc for itself). A phone
  shows one panel at a time under tabs, and pans the diagram in its own box. Nothing the load changes moves the board.

  A switch beside Close, or the F key, turns full screen into focus: the diagram, the story under it, and the verdict and
  the load slider when `fullScreen` lists them. `<Loadmap fullScreenMode="focus">` and `fullScreenMode: focus` in a
  `.loadmap` open full screen there (type `FullScreenMode`, default `'panels'`); the editor, the docs and the CLI viewer
  pass it on. The story bar gets Play: each step for its `seconds`, as `loadmap record --story` plays it, until the last
  or a value of the reader's own; its text keeps the room of the longest step.

  The controller has the state: `fullScreen`, `toggleFullScreen()`, `fullScreenMode`, `setFullScreenMode()`,
  `storyPlaying`, `setStoryPlaying()`. `<Loadmap>`'s `.lm-side` is now also `.lm-drawer`; a page of its own keeps its
  `.lm-side` under the board, in a box that scrolls on its own. `.lm-corner` is gone: nothing scrolls Close away.
- Updated dependencies [c1651c6]
- Updated dependencies [9280b78]
  - @loadmap/react@0.5.0
  - @loadmap/dsl@0.5.0
  - @loadmap/core@0.5.0

## 0.4.0

### Patch Changes

- bca623f: Full screen shows the diagram as wide as the screen, and below it every panel of the page: the verdict, Live and
  where it runs out beside the controls, then the headroom chart, the scenarios compared and what it assumes; the whole
  view scrolls, and the diagram never moves with the load. `<Loadmap fullScreen={['verdict', 'live', 'controls']}>`
  keeps only the panels it lists (`LOADMAP_PANELS`, type `LoadmapPanel`), and `fullScreen: [verdict, live, controls]`
  in a `.loadmap` does the same in the editor, the docs and `loadmap record`. A diagram in a narrow column turns to run
  left to right in full screen. Scrolled down to the panels, Close waits in the corner. `<Loadmap>` now wraps each
  panel in a `div.lm-panel` (`data-panel` names it), and `.lm-more` is gone: CSS that selected a panel as a child of
  `.lm-side` needs `.lm-panel` in between.
- Updated dependencies [bca623f]
  - @loadmap/react@0.4.0
  - @loadmap/dsl@0.4.0
  - @loadmap/core@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [60b542e]
  - @loadmap/react@0.3.1
  - @loadmap/core@0.3.1
  - @loadmap/dsl@0.3.1

## 0.3.0

### Minor Changes

- 294378d: Light editing for readers: `<LoadmapEditor layout="reader">` shows the diagram with an inspector (a box's label,
  capacity and parameters; the model's load, growth and flows), each change a small edit of the text, and a shared link
  opens that way on the docs site. `format()` and `loadmap fmt` (`--check` for CI) lay a definition out the one way.
  `<Loadmap onNodeClick selected>`; in the editor a click on a box selects its lines, and **Format** (Shift+Alt+F).

### Patch Changes

- Updated dependencies [294378d]
  - @loadmap/core@0.3.0
  - @loadmap/react@0.3.0
  - @loadmap/dsl@0.3.0

## 0.2.0

### Minor Changes

- 2a8118b: Building blocks: a cache stage (hits answered and sent back), an autoscaled workers pool (min, max, target; a pods
  meter), a rate limiter (`limit` with a `configured` capacity) and retries that settle past capacity (`retry` with a
  budget). `at.<stage>.<flow>` reads what reaches a stage, a component without a demand takes it, and four new
  templates show each block.

### Patch Changes

- Updated dependencies [2a8118b]
  - @loadmap/core@0.2.0
  - @loadmap/react@0.2.0
  - @loadmap/dsl@0.2.0

## 0.1.1

### Patch Changes

- Published from GitHub Actions with npm trusted publishing: every package now carries a provenance statement that ties
  it to its commit and workflow.
- Updated dependencies
  - @loadmap/core@0.1.1
  - @loadmap/react@0.1.1
  - @loadmap/dsl@0.1.1
