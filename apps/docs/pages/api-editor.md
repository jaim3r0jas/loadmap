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
| `ref`         | A `LoadmapEditorHandle`                                                                                                   |

In `'code'` layout a click on a box selects its lines in the text. In `'reader'` layout the text is hidden: a click on
a box opens an inspector with its label, its capacity and its parameters, each change a small edit of the text, so a
share link carries it. **Show code** switches.

**Track live changes** (the code panel's button, `track` and `onTrack`): once an edit is drawn and the text rests a
moment, the board brings the boxes it changed into view, at the same zoom or only as far out as it takes, and marks
them. Off, the view stays where the reader left it.

Without `onSave`, ⌘S only says what keeps the text: `onChange` or `onFiles` (a draft), or nothing (Share does). Either
way the browser's Save Page never opens over the editor.

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

`loadmap()` is what export and recording drive: [React and the page](/api/react/#the-handle) has its methods.

## As a page of its own

```tsx
<div style={{ height: '100dvh' }}>
  <LoadmapEditor fill initial={source} start={<a href="/">← Back</a>} split={0.3} onSplit={keepSplit} />
</div>
```

`fill` makes the editor the whole of its container, which gives it a height: the bar, the code in a panel on the left,
the diagram as a canvas the reader pans and zooms between, and the verdict and the rest in a panel on the right. The
bar shows the model's title. Each panel resizes by its inner edge and folds onto a rail.

| Prop           | What (with `fill`)                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `split`        | The code panel's share of the width, `0.3` for 30 %: from 360 px to 60 %. Default 440 px                         |
| `onSplit`      | `(share) => void`: the code panel was resized; a page can keep it                                                |
| `panel`        | The side panel `'pinned'` beside the canvas, or `'auto'`, folded onto its rail. Default pinned from 1280 px wide |
| `onPanel`      | `(mode) => void`: the reader pinned or folded it                                                                 |
| `panelWidth`   | The side panel's width, 300 px to 480 px. Default 340 px                                                         |
| `onPanelWidth` | `(px) => void`: the side panel was resized                                                                       |

A double-click on the code panel's edge puts it back at `split`. The side panel cannot pin below 1024 px wide. On a
phone (below 720 px wide, or 500 px high) the editor shows the text or the diagram, switched at the bottom, the panels
in a sheet over the diagram, and the actions other than Share in a sheet of their own. The root carries `data-narrow`
on a phone and `data-short` below 1000 px wide, for a page's own controls in the bar to follow.

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
