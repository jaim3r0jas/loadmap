// The editor, with the reader's draft kept in this browser. A shared link (#v1.…) or a template (?template=…) opens
// instead of the draft; editing it makes it the draft, and the earlier draft stays one click away.
import { decodeShare, type Shared } from '@loadmap/dsl'
import { LoadmapEditor, type LoadmapEditorHandle, TEMPLATES } from '@loadmap/editor'
import { alertsSource } from '@loadmap/example-alerts'
import { checkoutSource } from '@loadmap/example-checkout'
import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import uploadsSource from '../uploads.loadmap?raw'
import { useRecorder } from './recorder'

const SOURCES = { uploads: uploadsSource, checkout: checkoutSource, alerts: alertsSource } as const
const DRAFT = 'loadmap-editor-draft'
/** The reader's draft as it was before another text took its place. */
const EARLIER = 'loadmap-editor-draft-earlier'

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

/** Texts that come whole from the site: replacing a draft with one of them keeps the draft aside. */
const WHOLE = new Set<string>([...TEMPLATES.map((t) => t.source), ...Object.values(SOURCES)])

const readDraft = () => read(DRAFT)
const fromLink = () => location.hash.startsWith('#v1.')
const template = () => TEMPLATES.find((t) => t.id === new URLSearchParams(location.search).get('template'))

function Editor() {
  const editor = useRef<LoadmapEditorHandle>(null)
  const [get] = useState(() => () => editor.current?.loadmap())
  const { png, poster, record } = useRecorder('editor', get)
  // a link's definition wins over the draft; reading it is async, so the editor waits for it
  const [start, setStart] = useState<Shared | null>(() =>
    fromLink() ? null : { source: template()?.source ?? readDraft() ?? SOURCES.uploads, values: {} },
  )
  useEffect(() => {
    if (!start) decodeShare(location.hash).then(setStart)
  }, [start])
  // editing what came from outside makes it the draft: the earlier draft is kept aside, and the address loses the
  // link or the template, so a reload shows the edits
  const outside = useRef(fromLink() || !!template())
  const [earlier, setEarlier] = useState(() => read(EARLIER))
  const save = (s: string) => {
    // a whole new text (an example, a template, the first edit of a link) takes the draft's place: the reader's own
    // draft is kept aside, one click away
    const draft = readDraft()
    if ((outside.current || WHOLE.has(s)) && draft != null && draft !== s && !WHOLE.has(draft)) {
      write(EARLIER, draft)
      setEarlier(draft)
    }
    if (outside.current) {
      outside.current = false
      history.replaceState(null, '', location.pathname)
    }
    write(DRAFT, s)
  }
  if (!start) return <p className="note">Opening the link…</p>
  return (
    <>
      <div className="actions">
        {'error' in start && <span className="error">{start.error}; showing your draft instead.</span>}
        <span>Open</span>
        {(Object.keys(SOURCES) as (keyof typeof SOURCES)[]).map((n) => (
          <button type="button" key={n} onClick={() => editor.current?.setSource(SOURCES[n])}>
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
              GIF
            </button>
          </>
        }
      />
    </>
  )
}

export function mount(el: HTMLElement) {
  createRoot(el).render(
    <StrictMode>
      <Editor />
    </StrictMode>,
  )
}
