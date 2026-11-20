// An example from the repository, as TypeScript draws it, with the buttons that export it and a link that opens its
// .loadmap in the editor at the values the reader set, or downloads it. The reader pans and zooms it.
import type { ParamValue } from '@loadmap/core'
import { Alerts, alertsSource } from '@loadmap/example-alerts'
import { Checkout, checkoutSource } from '@loadmap/example-checkout'
import { Regions, regionsFiles, regionsOne } from '@loadmap/example-regions'
import { Search, searchSource } from '@loadmap/example-search'
import type { LoadmapHandle } from '@loadmap/react'
import { type MouseEvent, StrictMode, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Actions } from './actions'
import { useRecorder } from './recorder'

const EXAMPLES = { checkout: Checkout, alerts: Alerts, search: Search, regions: Regions } as const
// what the download gives: one file, those in several written as one (`loadmap bundle`)
const SOURCES = { checkout: checkoutSource, alerts: alertsSource, search: searchSource, regions: regionsOne } as const
/** The examples in several files: a share link carries them all, and the editor opens each as a tab. */
const FILES: Partial<Record<Name, typeof regionsFiles>> = { regions: regionsFiles }
type Name = keyof typeof EXAMPLES

function Example({ name, editor }: { name: Name; editor?: string }) {
  const handle = useRef<LoadmapHandle>(null)
  const [get] = useState(() => () => handle.current)
  const { png, poster, svg, record } = useRecorder(name, get)
  const Shown = EXAMPLES[name]
  // the link opens the example's text; a plain click carries the values set here too, in a share link
  const edit = async (e: MouseEvent<HTMLAnchorElement>) => {
    const h = handle.current
    if (!editor || !h || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    const plain = e.currentTarget.href
    const values: Record<string, ParamValue> = {}
    for (const [k, v] of Object.entries(h.values() as Record<string, unknown>))
      if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') values[k] = v
    try {
      const { encodeShare } = await import('@loadmap/dsl')
      const files = FILES[name]
      const hash = files
        ? await encodeShare(files.files[files.path as keyof typeof files.files], values, files)
        : await encodeShare(SOURCES[name], values)
      location.href = `${editor}?code#${hash}`
    } catch {
      // the example's text without the values, rather than a link that does nothing
      location.href = plain
    }
  }
  return (
    <>
      <Actions name={name} source={SOURCES[name]} edit={editor && `${editor}?example=${name}`} onEdit={edit}>
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
      </Actions>
      <Shown ref={handle} theme="inherit" />
    </>
  )
}

export function mount(el: HTMLElement) {
  const name = el.dataset.name as Name
  if (!(name in EXAMPLES)) throw new Error(`no example "${name}"`)
  createRoot(el).render(
    <StrictMode>
      <Example name={name} editor={el.dataset.editor} />
    </StrictMode>,
  )
}
