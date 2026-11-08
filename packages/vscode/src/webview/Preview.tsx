import type { LoadmapHandle } from '@loadmap/react'
import { LoadmapSource, type LoadmapSourceProps } from '@loadmap/react/source'
import { useEffect, useRef, useState } from 'react'
import type { FromPreview, ParamValue, PreviewState, ToPreview } from '../protocol'

/** What the webview gets from VS Code (`acquireVsCodeApi()`), or a test in its place. */
export interface Host {
  postMessage(m: FromPreview): void
  getState(): PreviewState | undefined
  setState(s: PreviewState): void
}

type Values = Record<string, ParamValue>

/**
 * The open `.loadmap` drawn live, as the docs' embed draws a link: filling the panel, zoomable, with the definition's
 * own options (its `fullScreenMode` too: the diagram first, or the panels). While the text has an error, its problems
 * above the last version that compiled. The values (the load, a scenario, the controls) stay across edits, each file
 * keeps its own while the preview follows another, and the file shown keeps them across a reload.
 */
export function Preview({ host, elk }: { host: Host; elk?: LoadmapSourceProps['elk'] }) {
  const [doc, setDoc] = useState<Omit<PreviewState, 'values'> | undefined>(() => host.getState())
  const [selected, setSelected] = useState<string | null>(null)
  const ref = useRef<LoadmapHandle>(null)
  const current = useRef(doc)
  current.current = doc
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  // the values of each file the preview has shown, for when it comes back to one
  const [memory] = useState(() => {
    const s = host.getState()
    return new Map<string, Values>(s?.values ? [[s.uri, s.values]] : [])
  })

  useEffect(() => {
    /** The values that differ from the model's defaults: what a share link carries. */
    const changed = () => {
      const h = ref.current
      const out: Values = {}
      if (!h) return out
      const defaults = h.engine.model.defaults() as Values
      for (const [k, v] of Object.entries(h.values() as Values)) if (defaults[k] !== v) out[k] = v
      return out
    }
    /** A file's values: the board's, or the ones remembered while none is drawn (a text that has never compiled). */
    const valuesOf = (uri: string) => (ref.current ? changed() : (memory.get(uri) ?? {}))
    // what a reload brings back: kept as each text arrives, and as the tab hides with the values set since
    const keep = () => {
      if (current.current) host.setState({ ...current.current, values: valuesOf(current.current.uri) })
    }
    const receive = ({ data: m }: MessageEvent<ToPreview>) => {
      if (m.type === 'source') {
        const was = current.current
        if (was && was.uri !== m.uri) memory.set(was.uri, valuesOf(was.uri))
        const next = { uri: m.uri, source: m.source, name: m.name }
        current.current = next
        setDoc(next)
        host.setState({ ...next, values: was?.uri === m.uri ? valuesOf(m.uri) : (memory.get(m.uri) ?? {}) })
      } else if (m.type === 'select') setSelected(m.id)
      else if (m.type === 'state?') {
        const svg = ref.current?.board()?.svg
        const boxes = [...(svg?.querySelectorAll<SVGElement>('[data-node]') ?? [])].map((b) => b.dataset.node!)
        host.postMessage({ type: 'state', request: m.request, values: changed(), boxes, selected: selectedRef.current })
      }
    }
    addEventListener('message', receive)
    addEventListener('pagehide', keep)
    document.addEventListener('visibilitychange', keep)
    host.postMessage({ type: 'ready' })
    return () => {
      removeEventListener('message', receive)
      removeEventListener('pagehide', keep)
      document.removeEventListener('visibilitychange', keep)
    }
  }, [host, memory])

  if (!doc) return <p className="lmv-empty">Open a .loadmap file to see its diagram here.</p>
  return (
    <LoadmapSource
      // each file on a board of its own, from its own values
      key={doc.uri}
      ref={ref}
      source={doc.source}
      name={doc.name}
      fill
      zoom
      theme="inherit"
      initial={memory.get(doc.uri)}
      selected={selected}
      onNodeClick={(id) => host.postMessage({ type: 'reveal', id })}
      elk={elk}
    />
  )
}
