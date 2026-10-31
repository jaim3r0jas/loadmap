import { decodeShare, type Shared } from '@loadmap/dsl'
import { LoadmapEditor, type LoadmapEditorHandle } from '@loadmap/editor'
import { Alerts, alertsSource } from '@loadmap/example-alerts'
import { Checkout, checkoutSource } from '@loadmap/example-checkout'
import { download, exportPng, expose, recordVideo } from '@loadmap/export'
import type { LoadmapHandle } from '@loadmap/react'
import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import uploadsSource from './uploads.loadmap?raw'

const EXAMPLES = { checkout: Checkout, alerts: Alerts } as const
type Name = keyof typeof EXAMPLES
type Tab = Name | 'editor'
const TABS: Tab[] = ['checkout', 'alerts', 'editor']
/** What the editor can start from. */
const SOURCES = { uploads: uploadsSource, checkout: checkoutSource, alerts: alertsSource } as const
const DRAFT = 'loadmap-editor-draft'

const initial = (): Tab => {
  if (location.hash.startsWith('#v1.')) return 'editor'
  const q = new URLSearchParams(location.search).get('example')
  return q && (TABS as string[]).includes(q) ? (q as Tab) : 'checkout'
}

/** Records the shown board: buttons for the playground, and `expose` for `loadmap record`. */
function useRecorder(name: string, get: () => LoadmapHandle | null | undefined) {
  useEffect(() => {
    // a stand-in that always reaches the current board: the editor's changes with every version
    const live = new Proxy({} as LoadmapHandle, {
      get: (_, k) => {
        const h = get() as Record<PropertyKey, unknown> | null | undefined
        const v = h?.[k]
        return typeof v === 'function' ? v.bind(h) : v
      },
    })
    const off = [expose(live), expose(live, name)]
    return () => {
      for (const f of off) f()
    }
  }, [name, get])
  const png = async () => {
    const h = get()
    if (h) download(await exportPng(h), `${name}.png`)
  }
  const record = async (format: 'webm' | 'gif') => {
    const h = get()
    if (!h) return
    const script = [
      { at: 0, set: { load: 5 } },
      { at: 2, set: { load: 30 } },
    ]
    download(await recordVideo(h, { seconds: 6, format, script }), `${name}.${format}`)
  }
  return { png, record }
}

function Example({ name }: { name: Name }) {
  const handle = useRef<LoadmapHandle>(null)
  const [get] = useState(() => () => handle.current)
  const { png, record } = useRecorder(name, get)
  const Shown = EXAMPLES[name]
  return (
    <>
      <div className="pg-actions">
        <button type="button" onClick={png}>
          Export PNG
        </button>
        <button type="button" onClick={() => record('webm')}>
          Record 6 s WebM
        </button>
      </div>
      <Shown ref={handle} />
    </>
  )
}

function readDraft(): string | null {
  try {
    return localStorage.getItem(DRAFT)
  } catch {
    return null
  }
}

function Editor() {
  const editor = useRef<LoadmapEditorHandle>(null)
  const [get] = useState(() => () => editor.current?.loadmap())
  const { png, record } = useRecorder('editor', get)
  // a link's definition wins over the draft; reading it is async, so the editor waits for it
  const [start, setStart] = useState<Shared | null>(() =>
    location.hash.startsWith('#v1.') ? null : { source: readDraft() ?? SOURCES.uploads, values: {} },
  )
  useEffect(() => {
    if (!start) decodeShare(location.hash).then(setStart)
  }, [start])
  if (!start) return <p className="pg-note">Opening the link…</p>
  const load = (n: keyof typeof SOURCES) => editor.current?.setSource(SOURCES[n])
  return (
    <>
      <div className="pg-actions">
        {'error' in start && <span className="pg-error">{start.error}; showing your draft instead.</span>}
        <span>Start from</span>
        {(Object.keys(SOURCES) as (keyof typeof SOURCES)[]).map((n) => (
          <button type="button" key={n} onClick={() => load(n)}>
            {n}
          </button>
        ))}
      </div>
      <LoadmapEditor
        ref={editor}
        initial={'source' in start ? start.source : (readDraft() ?? SOURCES.uploads)}
        values={'values' in start ? start.values : undefined}
        onChange={(s) => {
          try {
            localStorage.setItem(DRAFT, s)
          } catch {
            // private windows refuse storage; the draft is a convenience
          }
        }}
        actions={
          <>
            <button type="button" className="lm-btn" onClick={png}>
              PNG
            </button>
            <button type="button" className="lm-btn" onClick={() => record('gif')}>
              6 s GIF
            </button>
          </>
        }
      />
    </>
  )
}

function App() {
  const [tab, setTab] = useState<Tab>(initial)
  const pick = (t: Tab) => {
    setTab(t)
    history.replaceState(null, '', `?example=${t}`)
  }
  return (
    <>
      <nav className="pg-nav">
        {TABS.map((t) => (
          <button type="button" key={t} aria-pressed={t === tab} onClick={() => pick(t)}>
            {t}
          </button>
        ))}
      </nav>
      {tab === 'editor' ? <Editor /> : <Example key={tab} name={tab} />}
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
