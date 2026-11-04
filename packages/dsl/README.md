# @loadmap/dsl

The `.loadmap` language: a capacity model and its diagram as text, compiled to the `model` and `view` that
`<Loadmap>` takes. Formulas are a small subset of TypeScript expressions, parsed and run without `eval`, so a
definition can travel in a link.

```ts
import { compile, formatDiagnostic } from '@loadmap/dsl'

const r = compile(source)
if (!r.ok) console.error(r.diagnostics.map((d) => formatDiagnostic(d, source, 'shop.loadmap')).join('\n'))
else render(<Loadmap model={r.definition.model} view={r.definition.view} />)
```

Also: `format()` lays a definition out the one way (what `loadmap fmt` runs), `completions()` for an editor,
`encodeShare`/`decodeShare` for links. The language guide and the reference:
https://jaim3r0jas.github.io/loadmap/ · MIT
