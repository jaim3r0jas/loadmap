// An example from the repository, as TypeScript draws it, with the buttons that export it.
import { Alerts } from '@loadmap/example-alerts'
import { Checkout } from '@loadmap/example-checkout'
import type { LoadmapHandle } from '@loadmap/react'
import { StrictMode, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useRecorder } from './recorder'

const EXAMPLES = { checkout: Checkout, alerts: Alerts } as const
type Name = keyof typeof EXAMPLES

function Example({ name, exports }: { name: Name; exports: boolean }) {
  const handle = useRef<LoadmapHandle>(null)
  const [get] = useState(() => () => handle.current)
  const { png, poster, svg, record } = useRecorder(name, get)
  const Shown = EXAMPLES[name]
  return (
    <>
      {exports && (
        <div className="actions">
          <button type="button" onClick={png}>
            PNG
          </button>
          <button type="button" onClick={poster}>
            Poster
          </button>
          <button type="button" onClick={svg}>
            SVG
          </button>
          <button type="button" onClick={() => record('webm')}>
            WebM
          </button>
        </div>
      )}
      <Shown ref={handle} />
    </>
  )
}

export function mount(el: HTMLElement) {
  const name = el.dataset.name as Name
  if (!(name in EXAMPLES)) throw new Error(`no example "${name}"`)
  createRoot(el).render(
    <StrictMode>
      <Example name={name} exports={el.dataset.exports !== 'false'} />
    </StrictMode>,
  )
}
