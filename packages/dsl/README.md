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
`encodeShare`/`decodeShare` for links.

## Test a model

`expect` lines say what must keep holding, on the pessimistic edge (every capacity at its low bound):

```
expect "Today keeps 7×" { target: 7 }
expect "Proposed keeps 14×" { scenario: Proposed; target: 14 }
expect "The database lasts to 10×" { component: db; full: 10 }
```

`npx @loadmap/cli check shop.loadmap` compiles the file and tests them: exit 1 on an error or a failed expectation,
with annotations on the lines under GitHub Actions. For a check of your own, evaluate the model:

```ts
import { readFileSync } from 'node:fs'
import { compile, formatDiagnostic } from '@loadmap/dsl'

const source = readFileSync('shop.loadmap', 'utf8')
const r = compile(source)
if (!r.ok || !r.definition) throw new Error(r.diagnostics.map((d) => formatDiagnostic(d, source)).join('\n'))
for (const load of [1, 5, 20]) {
  const ev = r.definition.model.evaluate({ load })
  console.log(`${load}×: ${ev.verdict.text}`)
  for (const c of ev.ranked) console.log(`  ${c.name}: ${c.util == null ? 'off' : `${Math.round(c.util * 100)} %`}`)
}
```

## The reference

The language guide and the whole reference ship with the package: `node_modules/@loadmap/dsl/dist/REFERENCE.md`, the
same text as https://jaim3r0jas.github.io/loadmap/language/ and `/reference/`. For a language model,
https://jaim3r0jas.github.io/loadmap/llms-full.txt holds it in one file with a model that uses every statement. MIT
