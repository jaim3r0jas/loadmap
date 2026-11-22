# The editor component

`@loadmap/editor` is `<LoadmapEditor>`: a `.loadmap` definition in CodeMirror next to its live diagram, with errors
under the line, completion, hover, rename, a formatter, share links, the starters and the catalog picker. It is the
editor at [/editor/](/editor/), as a component for a page of your own; [Using the editor](/using-the-editor/) has what a
reader does in it. React 19 is a peer; CodeMirror comes with the package.

## LoadmapEditor

```tsx
import { LoadmapEditor } from '@loadmap/editor'

// a draft the page keeps
<LoadmapEditor initial={draft ?? starter} onChange={saveDraft} />

// a shared link, opened on the diagram with an inspector
<LoadmapEditor initial={shared.source} values={shared.values} layout="reader" />
```

`initial` is the one required prop: the text to start from. A new `initial` does not replace the text; give the
editor a new `key`, or call `setSource` on its handle.

| Prop          | What                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `initial`     | The text to start from (required)                                                                                         |
| `values`      | Values to start the preview at; texts from a share link are read by each parameter's kind                                 |
| `functions`   | `HostFunctions`: what formulas may call beyond the built-in ones                                                          |
| `theme`       | `'auto'` (the default), `'light'`, `'dark'`, or `'inherit'` to follow the page's own switch                               |
| `onChange`    | `(source) => void`: every change of the text, for a page that keeps a draft                                               |
| `onShare`     | `(hash) => void \| Promise<void>`: called with a share hash; by default it goes in the address bar and the link is copied |
| `embedLink`   | `(hash, options) => string`: with it, Share has **Embed in a page…** (see below)                                          |
| `layout`      | How it opens: `'code'` (the default) or `'reader'`                                                                        |
| `onLayout`    | `(layout) => void`: the reader showed or hid the code; a page can keep it                                                 |
| `fill`        | It fills its container as a canvas between two panels (see below)                                                         |
| `track`       | Track live changes, on at the start; default off                                                                          |
| `onTrack`     | `(on) => void`: the reader turned tracking on or off                                                                      |
| `files`       | A definition in several files: `{ path, files }` (see below)                                                              |
| `onFiles`     | `(files) => void`: every change of any file, a file added or removed                                                      |
| `onSave`      | `(files) => void \| Promise<void>`: ⌘S or Ctrl+S in the editor saves every file                                           |
| `templates`   | The starters in New: `Template[]`, or `false` to leave them out; default the twelve in `TEMPLATES`                        |
| `catalog`     | **Add → From the catalog** in New; default true, `false` leaves it out                                                    |
| `newItems`    | `BarSection[]`: more sections in the New menu, after the templates                                                        |
| `exportItems` | `BarSection[]`: more sections in the Export menu, after the download                                                      |
| `start`       | Controls at the start of the bar, before the name: a way back, a brand                                                    |
| `actions`     | Controls in the bar before Share: a theme, help. On a phone they go in the sheet of actions                               |
| `fileName`    | The name the downloaded file takes, without `.loadmap`; default the model's title                                         |
| `fonts`       | The fonts View offers for the code: `CodeFont[]`; default `CODE_FONTS`, `[]` for the system's alone                       |
| `history`     | A Timeline of versions, each a commit: `true`, or `{ key }` to keep it in this tab (see below)                            |
| `assist`      | An Ask panel: a model the reader picks, its changes as proposals they accept (see below)                                  |
| `ref`         | A `LoadmapEditorHandle`                                                                                                   |

In `'code'` layout a click on a box selects its lines in the text. In `'reader'` layout the text is hidden: a click on
a box opens an inspector with its label, its capacity and its parameters, each change a small edit of the text, so a
share link carries it. **Show code** switches.

**Track live changes** (the code panel's button, `track` and `onTrack`): once an edit is drawn and the text rests a
moment, the board brings the boxes it changed into view, at the same zoom or only as far out as it takes, and marks
them. Off, the view stays where the reader left it.

Without `onSave`, ⌘S only says what keeps the text: `onChange` or `onFiles` (a draft), or nothing (Share does). Either
way the browser's Save Page never opens over the editor.

## History

With `history`, the editor keeps every version of the files as a commit, as git writes one (the same ids): what the
reader keeps (**Keep this version** in the Timeline, with a few words), every change accepted from the assistant, every
⌘S, and each whole definition loaded. The **Timeline** panel lists the versions of the branch, newest first, with who
made each and, for the assistant, the request, the model and the operations. **Back** and **Forward** draw an older
version in the canvas while the text stays as it is; **Restore this version** makes it the files again, as a new
version on top; **Branch from here** tries another design from any version, and the branch's menu goes back. Nothing
is rewritten. `history={{ key }}` mirrors the versions to this tab's storage (sessionStorage): a reload keeps them,
closing the tab drops them. The handle's `history()` gives them as plain data (`HistoryData`). The Timeline's
**Download** saves them as a git bundle: `git clone model.bundle` gives every version as a commit and every branch.

## Ask

With `assist`, the canvas has an **Ask** panel: a conversation about the diagram with a model, a box's question about
that box first. The reader picks a provider (Anthropic, DeepSeek, OpenAI, OpenRouter, Groq, Mistral, Gemini, or a local
Ollama or LM Studio) and a model, and pastes their own key: it stays in this page's memory, or in this tab with **Keep
for this tab**, and **Forget** drops it. The model reads `reference` (the site's `llms-full.txt`), the files and what
the engine computes from them, and answers with operations by name. A change arrives as a proposal the compiler has
checked: what it does, a diff per file, the capacities it wrote (a number nobody gave is marked as the assistant's
guess), and what moves; the canvas draws it, the boxes it adds dashed and those it changes outlined, and **Before** and
**After** switch between the files and the proposal. **Accept** puts it in the text, one undo step per file and, with
`history`, a version that keeps the request, the model and the operations; **Reject** drops it. A proposal about a text
that changed since is refused.

With a box selected, **Explain it**, **What runs through it**, **Is a flow missing?** and **Critique it** ask about it
in one press. The model gets what the engine computes for the box: its use, demand and capacity, where the capacity
came from, and what reaches it per flow. An answer in words alone offers **Draft this**, which asks for the change it
advised.

```tsx
<LoadmapEditor
  initial={source}
  history
  assist={{ reference: () => fetch('/llms-full.txt').then((r) => r.text()), providers: ['anthropic', 'deepseek'] }}
/>
```

`assist.model` gives the panel a model of the page's own (behind its server, or `recorded` in a test) and hides the
provider and the key. `assist.confirmSend` is asked before each request, with the provider: a page says there what
leaves it. The page's Content-Security-Policy must allow the providers' origins
(`PROVIDER_ORIGINS` of `@loadmap/dsl/assist`); the docs' editor lists them, with Ollama's and LM Studio's local ports.

`assist.data` (an `EditorData`) gives the panel the reader's metrics. Nothing is asked of it before the reader presses
**Connect** (`connect()` names the stores). Then the model may ask to look in them before it writes a metric: each
round of looks waits on a card for **Run**, or **Run, and allow for this session**, and `explore(calls)` answers. What
they read goes back to the model as data, and a capacity taken from it is marked as read from the metrics. With
`pull(measures)`, a measure an accepted change adds is read at once and the canvas draws the files with it ("Drawn
with your metrics"); **Draw with them** reads every measure again. The text stays as written. The docs' editor reaches
the metrics through `loadmap bridge`.

## The handle

```tsx
const editor = useRef<LoadmapEditorHandle>(null)
<LoadmapEditor ref={editor} initial={source} />

editor.current?.setSource(example)
const hash = await editor.current?.shareHash()
```

| Method            | What                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `source()`        | The text                                                                                        |
| `setSource(text)` | Replaces the whole text, e.g. with an example                                                   |
| `loadmap()`       | The preview's `LoadmapHandle` once a version has compiled, else `null`                          |
| `shareHash()`     | `Promise<string>`: the hash of a link to this definition at the current values (`v1.…&load=30`) |
| `format()`        | Lays the text out the one way; `false` when it has a syntax error                               |
| `files()`         | `EditorFiles`: every file by its path, and the path of its model; one entry for one file        |
| `setFiles(files)` | Replaces the whole definition with one in several files; its model shows first                  |
| `history()`       | `HistoryData` of the versions with `history`, else `null`                                       |

`loadmap()` is what export and recording drive: [React and the page](/api/react/#the-handle) has its methods.

## As a page of its own

```tsx
<div style={{ height: '100dvh' }}>
  <LoadmapEditor fill initial={source} start={<a href="/">← Back</a>} split={0.3} onSplit={keepSplit} />
</div>
```

`fill` makes the editor the whole of its container, which gives it a height: the bar, the code in a panel on the left,
and beside it the diagram as [`<Loadmap fill>`](/api/react/#the-canvas) draws it: a canvas the reader pans and zooms,
the scenarios over it, the load and the verdict under it, and the rest in panels that open from their tabs. The bar
shows the model's title. The code panel resizes by its inner edge and folds onto a rail. While the code is hidden, the
inspector is the first of the canvas's panels, **Inspect**, and a click on a box opens it.

| Prop      | What (with `fill`)                                                                       |
| --------- | ---------------------------------------------------------------------------------------- |
| `split`   | The code panel's share of the width, `0.3` for 30 %: from 360 px to 60 %. Default 440 px |
| `onSplit` | `(share) => void`: the code panel was resized; a page can keep it                        |

A double-click on the code panel's edge puts it back at `split`. The canvas arranges its panels by its own width, as
any loadmap's does: there is no side panel to pin or resize (`panel`, `onPanel`, `panelWidth` and `onPanelWidth` are
gone). On a phone (below 720 px wide, or 500 px high) the editor shows the text or the diagram, switched at the bottom,
and the actions other than Share in a sheet of their own. The root carries `data-narrow` on a phone and `data-short`
below 1000 px wide, for a page's own controls in the bar to follow.

## Several files

```tsx
<LoadmapEditor
  initial={files['models/shop.loadmap']}
  files={{ path: 'models/shop.loadmap', files }}
  onFiles={saveFiles}
/>
```

`files` is `EditorFiles`, `{ path, files }`: the path of the model (the file the diagram draws) and every file by its
path from the project root. The model opens in the editor; the others open from the files' explorer, each a tab over
the text. With one file there are no tabs. A `#v2.` share link's `decodeShare` result gives both (`shared.path`,
`shared.files`). [Several files](/language/several-files/) has how a model is split.

## Menus of your own

```tsx
<LoadmapEditor
  initial={source}
  newItems={[{ label: 'Examples', items: examples.map((e) => ({ label: e.title, onSelect: () => open(e) })) }]}
  exportItems={[{ label: 'Image', items: [{ label: 'PNG', hint: 'The board as it is now', onSelect: savePng }] }]}
/>
```

A `BarSection` is `{ label, items }`, a heading and its items; a `BarItem` is `{ label, onSelect, hint? }`, `hint` a
line under the name. New lists them after the templates, Export after the download.

## Embed links

```tsx
import type { EmbedOptions } from '@loadmap/editor'

function embedLink(hash: string, o: EmbedOptions): string {
  const url = new URL('/embed/', location.href)
  url.searchParams.set('mode', o.mode)
  if (o.theme !== 'auto') url.searchParams.set('theme', o.theme)
  if (o.play) url.searchParams.set('play', '1')
  return `${url.href}#${hash}`
}

<LoadmapEditor initial={source} embedLink={embedLink} />
```

`embedLink` is a prop, not an export: the page says where its embed page lives. With it, Share has **Embed in a
page…**: the link, or an `<iframe>` with it, built from the share hash and what the reader picked. `EmbedOptions` is
`{ mode, theme, play }`: `mode` is `'focus'` (the diagram first) or `'panels'`, `theme` is `'auto'`, `'light'` or
`'dark'`, and `play` plays the story once, when the frame comes into view. The link carries the whole definition, as a
share link does. [Embedding](/embedding/) has a page that reads it.

## Fonts

`fonts` is the list View offers for the code, beside the system's monospace. A `CodeFont` is `{ name, url }`, `url` a
woff2 file of its Latin letters, loaded only when a reader picks it. `CODE_FONTS` is Fira Code, JetBrains Mono and
Cascadia Code from jsDelivr at a pinned version. A page that keeps its own copies, or allows no other origin, gives its
own URLs; `[]` offers none. The reader's font, size and ligatures are kept in the browser.

## Starters

```ts
import { TEMPLATES } from '@loadmap/editor/templates'
```

`TEMPLATES` lists the starters: each a `Template`, `{ id, title, summary, source }`, which compiles, keeps its
expectations and lays out without collisions. `@loadmap/editor/templates` is an entry without CodeMirror, for a
gallery of starters. `TEMPLATES` is also exported from `@loadmap/editor`.

## Styles

The editor injects its styles on first render. `EDITOR_CSS` is the stylesheet as text, and
`injectEditorStyles(doc?)` adds it to a document's head once (`document` by default), for server rendering or a
document of your own. The editor sits inside `.lm`, so it takes loadmap's theme tokens: [Styling](/api/styling/) has
them.

## CodeMirror of your own

```ts
import { loadmapLanguage } from '@loadmap/editor'
import { EditorView } from '@codemirror/view'

new EditorView({ doc: source, extensions: [loadmapLanguage({ onResult: (source, r) => draw(r) })], parent })
```

`loadmapLanguage(options?)` is the whole language as one CodeMirror extension: highlighting, inline errors with their
quick fixes, completion, hover, signature help, go to definition (F12, or a click with ⌘ or Ctrl), the other uses of a
name marked, and rename (F2). It takes `CompileOptions` (`functions`, `catalog`, `snapshot`, `path`, `files`) and:

| Option        | What                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `onResult`    | `(source, result) => void`: every compile the linter runs, so a preview follows without compiling twice               |
| `delay`       | Milliseconds of rest in typing before it compiles; default 150                                                        |
| `around`      | `() => { path, files, version } \| undefined`: the other files, read on every compile; `version` counts their changes |
| `onOpen`      | `(at: Located) => void`: go to definition found the name in another file, for the host to show                        |
| `onElsewhere` | A rename changed other files of the definition, for the host to apply there                                           |

`loadmapStream` (a `StreamLanguage`) with `loadmapHighlight` (a `HighlightStyle`) is the highlighting alone.
