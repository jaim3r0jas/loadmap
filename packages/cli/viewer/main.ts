// The page `loadmap record x.loadmap` records: it draws the definition the command serves next to it and exposes
// the board. The command has already compiled it in Node, so errors here are only a safety net.
import { compile, formatDiagnostic, loadCatalogFor } from '@loadmap/dsl'
import { pageOptions } from '@loadmap/dsl/internal'
import { expose } from '@loadmap/export'
import { Loadmap, type LoadmapHandle } from '@loadmap/react'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'

const source = await (await fetch('definition.loadmap')).text()
// the other files of the definition, when it has any: its parts and libraries, by their paths
const bundle: { path: string; files: Record<string, string> } | null = await fetch('definition.files.json')
  .then((res) => (res.ok ? res.json() : null))
  .catch(() => null)
const root = document.getElementById('root')!
for (const text of bundle ? Object.values(bundle.files) : [source]) await loadCatalogFor(text)
const r = compile(source, bundle ? { path: bundle.path, files: bundle.files } : {})
if (!r.ok || !r.definition) {
  const pre = document.createElement('pre')
  pre.textContent = r.diagnostics
    .map((d) =>
      d.file == null
        ? formatDiagnostic(d, source, 'definition.loadmap')
        : formatDiagnostic(d, bundle?.files[d.file] ?? '', d.file),
    )
    .join('\n')
  root.replaceChildren(pre)
} else {
  const { model, view, options } = r.definition
  document.title = model.title ?? 'loadmap'
  let off: (() => void) | null = null
  createRoot(root).render(
    createElement(Loadmap, {
      model,
      view,
      ...pageOptions(options),
      ref: (h: LoadmapHandle | null) => {
        off?.()
        off = h ? expose(h) : null
      },
    }),
  )
}
