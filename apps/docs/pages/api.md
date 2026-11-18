# API

Most pages install only `@loadmap/react`: it re-exports the model and view API, so one install draws a model. The
other packages add the language, the editor, media, measured data and the command line. Everything is ESM with
TypeScript types; React is a peer (19). An entry named `./internal` is for loadmap's own packages and promises nothing
between versions; it is left out here.

| Package or entry          | What                                                                     | Page                                       |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------------------------ |
| `@loadmap/core`           | The model: `defineModel`, stages, capacities, `check`, `compare`         | [The model in TypeScript](/api/model/)     |
| `@loadmap/core/calibrate` | `fitLinear`: a cost from measurements                                    | [Media, simulation and layout](/api/more/) |
| `@loadmap/core/format`    | The number formats the verdict uses                                      | [Media, simulation and layout](/api/more/) |
| `@loadmap/core/measure`   | Snapshots of measured data                                               | [Media, simulation and layout](/api/more/) |
| `@loadmap/core/drift`     | The tests behind `loadmap drift`                                         | [Media, simulation and layout](/api/more/) |
| `@loadmap/core/catalog`   | The published figures                                                    | [Media, simulation and layout](/api/more/) |
| `@loadmap/layout`         | The view (`defineView`, `node`, `edge`, …) and its ELK layout            | [The model](/api/model/#the-view), [more](/api/more/) |
| `@loadmap/react`          | `<Loadmap>`, `useLoadmap`, the panels, plus everything from core and the view | [React and the page](/api/react/)     |
| `@loadmap/react/source`   | `<LoadmapSource>`: a `.loadmap` text drawn; `useCatalog`                 | [React and the page](/api/react/)          |
| `@loadmap/react/catalog`  | `@loadmap/core/catalog`, for a page that installs only react             | [React and the page](/api/react/)          |
| the styles                | The `--lm-*` tokens, light and dark, a shadow root, full screen          | [Styling](/api/styling/)                   |
| `@loadmap/dsl`            | The `.loadmap` language: `compile`, `format`, hover, rename, share links | [The language in code](/api/language/)     |
| `@loadmap/dsl/completion` | What may be typed at a place, loaded with the first list                 | [The language in code](/api/language/)     |
| `@loadmap/dsl/add`        | Adding boxes from code, for loadmap's own editors                        | [The language in code](/api/language/)     |
| `@loadmap/editor`         | `<LoadmapEditor>`, the CodeMirror language, the styles                   | [The editor component](/api/editor/)       |
| `@loadmap/editor/templates` | The starters, without CodeMirror                                       | [The editor component](/api/editor/)       |
| `@loadmap/export`         | PNG, SVG, GIF, WebM, MP4, and `expose()` for `loadmap record`            | [Media, simulation and layout](/api/more/) |
| `@loadmap/sim`            | The simulation behind the dots                                           | [Media, simulation and layout](/api/more/) |
| `@loadmap/providers`      | Measured data from Prometheus and Elasticsearch, into a snapshot         | [Media, simulation and layout](/api/more/) |
| `@loadmap/cli`            | `loadmap check`, `fmt`, `pull`, `drift`, `record`, `bundle` and `lsp`    | [The command line](/recording/)            |

The VS Code extension (`jaim3r0jas.loadmap`, in the Marketplace and Open VSX) is not a library:
[In your editor](/in-your-editor/) has what it does.
