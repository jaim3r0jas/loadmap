// The editor, the whole window, with the reader's draft kept in this browser. A shared link (#v1.…), a template
// (?template=…) or an example (?example=…) opens instead of the draft; editing it makes it the draft, and the earlier
// draft stays one click away. A link opens for readers: the diagram with the inspector, the text one click away
// (?code opens it with the text, as the docs' Edit links do). Close goes back to the docs.
import { decodeShare, type Shared } from '@loadmap/dsl'
import {
  type EditorLayout,
  type EmbedOptions,
  LoadmapEditor,
  type LoadmapEditorHandle,
  type PanelMode,
  TEMPLATES,
} from '@loadmap/editor'
import { alertsSource } from '@loadmap/example-alerts'
import { checkoutSource } from '@loadmap/example-checkout'
import { type MouseEvent, StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { themeSwitch } from '../theme-switch'
import uploadsSource from '../uploads.loadmap?raw'
import { useRecorder } from './recorder'

const SOURCES = { uploads: uploadsSource, checkout: checkoutSource, alerts: alertsSource } as const
const NAMES: Record<keyof typeof SOURCES, string> = { uploads: 'Photo uploads', checkout: 'Checkout', alerts: 'Alerts' }
const DRAFT = 'loadmap-editor-draft'
/** The reader's draft as it was before another text took its place. */
const EARLIER = 'loadmap-editor-draft-earlier'
/** The code card's share of the width, as the reader left it (the divider's old share is not one). */
const SPLIT = 'loadmap-editor-card'
/** Whether the reader hid the code, and pinned the side panel. */
const LAYOUT = 'loadmap-editor-layout'
const PANEL = 'loadmap-editor-panel'

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
const query = () => new URLSearchParams(location.search)

/** The site's embed page for a share hash, with what the reader picked: the page ClickUp's /embed frames. */
function embedLink(hash: string, o: EmbedOptions): string {
  const url = new URL('../embed/', location.href)
  url.searchParams.set('mode', o.mode)
  if (o.theme !== 'auto') url.searchParams.set('theme', o.theme)
  if (o.play) url.searchParams.set('play', '1')
  return `${url.href}#${hash}`
}
const fromLink = () => location.hash.startsWith('#v1.')
const template = () => TEMPLATES.find((t) => t.id === query().get('template'))
const example = () => {
  const name = query().get('example')
  return name && Object.hasOwn(SOURCES, name) ? SOURCES[name as keyof typeof SOURCES] : undefined
}

/**
 * Where Close leads: the page of this site the reader came from, or the site's home. Never anything a link could set:
 * only the referrer, and only when it is on this site and not the editor itself.
 */
function closeTo(root: URL): { href: string; back: boolean } {
  try {
    const from = new URL(document.referrer)
    if (from.origin === root.origin && from.pathname.startsWith(root.pathname) && from.pathname !== location.pathname)
      return { href: from.href, back: true }
  } catch {
    // no referrer: opened cold
  }
  return { href: root.href, back: false }
}

/** The site's light and dark switch: in the bar when it is wide, in its menu when it is narrow. */
function ThemeSwitch() {
  // client.tsx makes it work, and marks it as the choice changes; the page's choice is on <html> already (theme.ts
  // stays out of the editor's chunk, or every page would load a chunk more)
  const t = document.documentElement.dataset.theme
  const html = themeSwitch('theme-editor', t === 'light' || t === 'dark' ? t : 'system')
  // biome-ignore lint/security/noDangerouslySetInnerHtml: the site's own markup, with nothing from the reader
  return <span className="app-theme" dangerouslySetInnerHTML={{ __html: html }} />
}

/** The help is static HTML on the page (from editor.md): the ? opens it, ✕ and Escape close it. */
function useHelp(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const help = document.getElementById('help')
    if (!help) return
    help.hidden = !open
    if (!open) return
    const close = help.querySelector<HTMLButtonElement>('.help-close')
    const shut = () => setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && shut()
    close?.addEventListener('click', shut)
    document.addEventListener('keydown', key)
    return () => {
      close?.removeEventListener('click', shut)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  return [open, setOpen]
}

function Editor({ root }: { root: URL }) {
  const editor = useRef<LoadmapEditorHandle>(null)
  const [get] = useState(() => () => editor.current?.loadmap())
  const { png, poster, record } = useRecorder('editor', get)
  const [help, setHelp] = useHelp()
  const [close] = useState(() => closeTo(root))
  // a link's definition wins over the draft; reading it is async, so the editor waits for it
  const [start, setStart] = useState<Shared | null>(() =>
    fromLink() ? null : { source: template()?.source ?? example() ?? readDraft() ?? SOURCES.uploads, values: {} },
  )
  useEffect(() => {
    if (!start) decodeShare(location.hash).then(setStart)
  }, [start])
  // editing what came from outside makes it the draft: the earlier draft is kept aside, and the address loses the
  // link, the template or the example, so a reload shows the edits
  const outside = useRef(fromLink() || !!template() || !!example())
  // a link opens for readers (the code with ?code); else the code shows or hides as the reader left it
  const [layout] = useState<EditorLayout>(() =>
    fromLink() ? (query().has('code') ? 'code' : 'reader') : read(LAYOUT) === 'reader' ? 'reader' : 'code',
  )
  const [linked] = useState(fromLink)
  const [panel] = useState<PanelMode | undefined>(() => {
    const p = read(PANEL)
    return p === 'pinned' || p === 'auto' ? p : undefined
  })
  const [earlier, setEarlier] = useState(() => read(EARLIER))
  const [split] = useState(() => Number(read(SPLIT) ?? Number.NaN))
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
  // the draft is written on every change, so leaving loses nothing; with a page of the docs behind, Close goes back
  // to it, where the reader was
  const leave = (e: MouseEvent) => {
    if (!close.back || history.length < 2 || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    history.back()
  }
  if (!start) return <p className="app-note">Opening the link…</p>

  // in the bar when it is wide, in its menu when it is narrow: the editor's data-narrow decides (docs.css)
  const examples = (where: 'wide' | 'narrow') => (
    <select
      className={`lm-btn app-${where}`}
      aria-label="Open an example"
      value=""
      onChange={(e) => {
        const v = e.target.value
        const text = v === 'earlier' ? earlier : SOURCES[v as keyof typeof SOURCES]
        if (text != null) editor.current?.setSource(text)
      }}
    >
      <option value="">Examples…</option>
      {(Object.keys(SOURCES) as (keyof typeof SOURCES)[]).map((n) => (
        <option key={n} value={n}>
          {NAMES[n]}
        </option>
      ))}
      {earlier != null && <option value="earlier">Your earlier draft</option>}
    </select>
  )
  const image = (
    <select
      className="lm-btn"
      aria-label="Save an image"
      value=""
      onChange={(e) => {
        const v = e.target.value
        if (v === 'png') png()
        if (v === 'poster') poster()
        if (v === 'gif') record('gif')
      }}
    >
      <option value="">Image…</option>
      <option value="png">PNG</option>
      <option value="poster">Poster</option>
      <option value="gif">GIF</option>
    </select>
  )
  return (
    <LoadmapEditor
      ref={editor}
      fill
      theme="inherit"
      initial={'source' in start ? start.source : (readDraft() ?? SOURCES.uploads)}
      values={'values' in start ? start.values : undefined}
      layout={layout}
      onChange={save}
      embedLink={embedLink}
      split={split}
      onSplit={(n) => write(SPLIT, String(n))}
      panel={panel}
      onPanel={(p) => write(PANEL, p)}
      // a link opens as its sender meant it: what the reader does with it is not how they leave their own editor
      onLayout={(l) => !linked && write(LAYOUT, l)}
      start={
        <>
          <a className="lm-btn app-close" href={close.href} onClick={leave} title="Back to the docs">
            <span aria-hidden="true">←</span> Docs
          </a>
          <a className="app-brand" href={root.href}>
            loadmap
          </a>
          {examples('wide')}
          {'error' in start && <span className="app-error">{start.error}; showing your draft instead.</span>}
        </>
      }
      actions={
        <>
          {examples('narrow')}
          {image}
          <button
            type="button"
            className="lm-btn"
            aria-label="Help"
            aria-expanded={help}
            aria-controls="help"
            onClick={() => setHelp(!help)}
          >
            <span className="app-wide">?</span>
            <span className="app-narrow">Help</span>
          </button>
          <ThemeSwitch />
        </>
      }
    />
  )
}

export function mount(el: HTMLElement) {
  const root = new URL(document.body.dataset.root ?? './', location.href)
  createRoot(el).render(
    <StrictMode>
      <Editor root={root} />
    </StrictMode>,
  )
}
