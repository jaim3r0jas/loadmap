// The templates: a card each, the picked one drawn below (the reader pans and zooms it), and a link that opens it in
// the editor.
import { compile } from '@loadmap/dsl'
import { pageOptions } from '@loadmap/dsl/internal'
import { TEMPLATES } from '@loadmap/editor/templates'
import { Loadmap } from '@loadmap/react'
import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

function Gallery({ editor }: { editor: string }) {
  const [id, setId] = useState(TEMPLATES[0]!.id)
  const t = TEMPLATES.find((x) => x.id === id)!
  const def = useMemo(() => compile(t.source).definition, [t])
  return (
    <>
      <ul className="cards">
        {TEMPLATES.map((x) => (
          <li key={x.id}>
            <button type="button" aria-pressed={x.id === id} onClick={() => setId(x.id)}>
              <b>{x.title}</b>
              <span>{x.summary}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="actions">
        <a className="button" href={`${editor}?template=${t.id}`}>
          Open “{t.title}” in the editor
        </a>
      </p>
      {def && (
        <Loadmap key={t.id} model={def.model} view={def.view} theme="inherit" zoom {...pageOptions(def.options)} />
      )}
    </>
  )
}

export function mount(el: HTMLElement) {
  createRoot(el).render(<Gallery editor={el.dataset.editor ?? '../editor/'} />)
}
