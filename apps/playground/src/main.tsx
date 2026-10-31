import { decodeShare, type Shared } from '@loadmap/dsl'
import { LoadmapEditor, type LoadmapEditorHandle } from '@loadmap/editor'
import { Alerts, alertsSource } from '@loadmap/example-alerts'
import { Checkout, checkoutSource } from '@loadmap/example-checkout'
import { download, exportPng, exportSvg, expose, recordPoster, recordVideo, type ScriptStep } from '@loadmap/export'
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
/** The draft as it was before a shared link was edited: the link's text takes the draft's place. */
const EARLIER = 'loadmap-editor-draft-earlier'

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
  const poster = async () => {
    const h = get()
    if (h) download(await recordPoster(h), `${name}-poster.png`)
  }
  const svg = async () => {
    const h = get()
    if (h) download(new Blob([await exportSvg(h, { caption: true })], { type: 'image/svg+xml' }), `${name}.svg`)
  }
  // the load rises, then the second scenario takes over, if there is one: a captioned 6 s
  const record = async (format: 'webm' | 'gif') => {
    const h = get()
    if (!h) return
    const next = h.engine.model.scenarios[1]?.label
    const script: ScriptStep[] = [
      { at: 0, set: { load: 5 } },
      { at: 2, set: { load: 30 } },
      ...(next ? [{ at: 4, scenario: next }] : []),
    ]
    download(await recordVideo(h, { seconds: 6, format, script, caption: true }), `${name}.${format}`)
  }
  return { png, poster, svg, record }
}

function Example({ name }: { name: Name }) {
  const handle = useRef<LoadmapHandle>(null)
  const [get] = useState(() => () => handle.current)
  const { png, poster, svg, record } = useRecorder(name, get)
  const Shown = EXAMPLES[name]
  return (
    <>
      <div className="pg-actions">
        <button type="button" onClick={png}>
          Export PNG
        </button>
        <button type="button" onClick={poster}>
          Poster
        </button>
        <button type="button" onClick={svg}>
          SVG
        </button>
        <button type="button" onClick={() => record('webm')}>
          Record 6 s WebM
        </button>
      </div>
      <Shown ref={handle} />
    </>
  )
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // private windows refuse storage; the draft is a convenience
  }
}

const readDraft = () => read(DRAFT)

function Editor() {
  const editor = useRef<LoadmapEditorHandle>(null)
  const [get] = useState(() => () => editor.current?.loadmap())
  const { png, poster, record } = useRecorder('editor', get)
  // a link's definition wins over the draft; reading it is async, so the editor waits for it
  const [start, setStart] = useState<Shared | null>(() =>
    location.hash.startsWith('#v1.') ? null : { source: readDraft() ?? SOURCES.uploads, values: {} },
  )
  useEffect(() => {
    if (!start) decodeShare(location.hash).then(setStart)
  }, [start])
  // editing a link makes it the draft: the earlier draft is kept aside, and the hash goes so a reload shows the edits
  const fromLink = useRef(location.hash.startsWith('#v1.'))
  const [earlier, setEarlier] = useState(() => read(EARLIER))
  const save = (s: string) => {
    if (fromLink.current) {
      fromLink.current = false
      const draft = readDraft()
      if (draft != null && draft !== s) {
        write(EARLIER, draft)
        setEarlier(draft)
      }
      history.replaceState(null, '', `${location.pathname}${location.search}`)
    }
    write(DRAFT, s)
  }
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
        {earlier != null && (
          <button type="button" onClick={() => editor.current?.setSource(earlier)}>
            your earlier draft
          </button>
        )}
      </div>
      <LoadmapEditor
        ref={editor}
        initial={'source' in start ? start.source : (readDraft() ?? SOURCES.uploads)}
        values={'values' in start ? start.values : undefined}
        onChange={save}
        actions={
          <>
            <button type="button" className="lm-btn" onClick={png}>
              PNG
            </button>
            <button type="button" className="lm-btn" onClick={poster}>
              Poster
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
