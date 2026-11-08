// The editor, the whole window, with the reader's draft kept in this browser. A shared link (#v1.…), a template
// (?template=…) or an example (?example=…) opens instead of the draft; editing it makes it the draft, and the earlier
// draft stays one click away. A link opens for readers: the diagram with the inspector, the text one click away
// (?code opens it with the text, as the docs' Edit links do). Close goes back to the docs.
import { decodeShare, type Shared } from '@loadmap/dsl'
import {
  type BarSection,
  type EditorLayout,
  type EmbedOptions,
  LoadmapEditor,
  type LoadmapEditorHandle,
  type PanelMode,
  TEMPLATES,
} from '@loadmap/editor'
import { Icon, Menu, MenuItem } from '@loadmap/editor/internal'
import { alertsSource } from '@loadmap/example-alerts'
import { checkoutSource } from '@loadmap/example-checkout'
import { searchSource } from '@loadmap/example-search'
import { type MouseEvent, StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CHOICES, ICONS, themeSwitch } from '../theme-switch'
import uploadsSource from '../uploads.loadmap?raw'
import { useRecorder } from './recorder'

const SOURCES = {
  uploads: uploadsSource,
  checkout: checkoutSource,
  alerts: alertsSource,
  search: searchSource,
} as const
const NAMES: Record<keyof typeof SOURCES, string> = {
  uploads: 'Photo uploads',
  checkout: 'Checkout',
  alerts: 'Alerts',
  search: 'Search',
}
const DRAFT = 'loadmap-editor-draft'
/** The reader's draft as it was before another text took its place. */
const EARLIER = 'loadmap-editor-draft-earlier'
/** The code panel's share of the width, as the reader left it (the divider's old share is not one). */
const SPLIT = 'loadmap-editor-card'
/** Whether the reader hid the code, and pinned the side panel, and how wide they left it. */
const LAYOUT = 'loadmap-editor-layout'
const PANEL = 'loadmap-editor-panel'
const PANEL_WIDTH = 'loadmap-editor-panel-width'
/** Whether the reader tracks live changes. */
const TRACK = 'loadmap-editor-track'

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

type Choice = keyof typeof ICONS
const choice = (): Choice => {
  const t = document.documentElement.dataset.theme
  return t === 'light' || t === 'dark' ? t : 'system'
}

/** The site's light and dark switch, as the phone's sheet of actions shows it: three radios. */
function ThemeSwitch() {
  // client.tsx makes it work, and marks it as the choice changes; the page's choice is on <html> already (theme.ts
  // stays out of the editor's chunk, or every page would load a chunk more)
  return (
    <span
      className="app-theme app-narrow"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the site's own markup, with nothing from the reader
      dangerouslySetInnerHTML={{ __html: themeSwitch('theme-editor', choice()) }}
    />
  )
}

/** The same choice in the wide bar: one icon showing it, a menu of the three. theme.ts hears the pick. */
function ThemeMenu() {
  const [now, setNow] = useState(choice)
  useEffect(() => {
    const mo = new MutationObserver(() => setNow(choice()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])
  return (
    <Menu
      label="Theme"
      title="Theme"
      className="lme-quiet lme-icon app-wide"
      icon={
        <svg
          className="lme-svg"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          aria-hidden="true"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: the site's own icon
          dangerouslySetInnerHTML={{ __html: ICONS[now] }}
        />
      }
    >
      {() =>
        (Object.keys(ICONS) as Choice[]).map((c) => (
          <MenuItem
            key={c}
            checked={now === c}
            onSelect={() => document.dispatchEvent(new CustomEvent('loadmap:theme', { detail: c }))}
          >
            {CHOICES[c]}
          </MenuItem>
        ))
      }
    </Menu>
  )
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
  const [panelWidth] = useState(() => Number(read(PANEL_WIDTH)) || undefined)
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

  const examples: BarSection[] = [
    {
      label: 'Examples',
      items: [
        ...(Object.keys(SOURCES) as (keyof typeof SOURCES)[]).map((n) => ({
          label: NAMES[n],
          onSelect: () => editor.current?.setSource(SOURCES[n]),
        })),
        ...(earlier != null
          ? [{ label: 'Your earlier draft', onSelect: () => editor.current?.setSource(earlier) }]
          : []),
      ],
    },
  ]
  const images: BarSection[] = [
    {
      label: 'Image',
      items: [
        { label: 'PNG', onSelect: png },
        { label: 'Poster', hint: 'The board, its limits and the scenarios', onSelect: poster },
        { label: 'GIF', hint: 'The diagram moving, a few seconds', onSelect: () => record('gif') },
      ],
    },
  ]
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
      panelWidth={panelWidth}
      onPanelWidth={(n) => write(PANEL_WIDTH, String(n))}
      // a link opens as its sender meant it: what the reader does with it is not how they leave their own editor
      onLayout={(l) => !linked && write(LAYOUT, l)}
      track={read(TRACK) === 'on'}
      onTrack={(on) => write(TRACK, on ? 'on' : 'off')}
      start={
        <>
          <a
            className="lm-btn lme-quiet app-close"
            href={close.href}
            onClick={leave}
            aria-label="Docs"
            title="Back to the docs"
          >
            <Icon d="M13 8H3M7 4 3 8l4 4" />
            <span className="app-label">Docs</span>
          </a>
          <a className="app-brand" href={root.href}>
            loadmap
          </a>
          {'error' in start && <span className="app-error">{start.error}; showing your draft instead.</span>}
        </>
      }
      newItems={examples}
      exportItems={images}
      actions={
        <>
          <ThemeMenu />
          <button
            type="button"
            className="lm-btn lme-quiet lme-icon app-wide"
            aria-label="Help"
            title="Help"
            aria-expanded={help}
            aria-controls="help"
            onClick={() => setHelp(!help)}
          >
            <Icon d="M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8zM6.3 6.2a1.8 1.8 0 1 1 2.5 1.7c-.5.2-.8.6-.8 1.1v.4M8 11.6v.1" />
          </button>
          <ThemeSwitch />
          <button
            type="button"
            className="lme-item app-narrow"
            aria-expanded={help}
            aria-controls="help"
            onClick={() => setHelp(!help)}
          >
            Help
          </button>
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
