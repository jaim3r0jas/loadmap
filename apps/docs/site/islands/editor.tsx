// The editor, the whole window, with the reader's draft kept in this browser. A shared link (#v1.…), a template
// (?template=…) or an example (?example=…) opens instead of the draft; editing it makes it the draft, and the earlier
// draft stays one click away. A link opens for readers: the diagram with the inspector, the text one click away
// (?code opens it with the text, as the docs' Edit links do). A repository (?repo=owner/name&ref=…&path=…) opens its
// model and the files it reaches from GitHub, as New → Open from GitHub does; the GitHub code loads only then.
// Close goes back to the docs.
import { decodeShare, type Shared } from '@loadmap/dsl'
import {
  type BarSection,
  type CodeFont,
  type ConversationStore,
  type EditorLayout,
  type EmbedOptions,
  LoadmapEditor,
  type LoadmapEditorHandle,
  type ModelSettings,
  TEMPLATES,
} from '@loadmap/editor'
import { Icon, isSaveKey, Menu, MenuItem } from '@loadmap/editor/internal'
import { alertsSource } from '@loadmap/example-alerts'
import { checkoutSource } from '@loadmap/example-checkout'
import { regionsFiles } from '@loadmap/example-regions'
import { searchSource } from '@loadmap/example-search'
import { lazy, type MouseEvent, StrictMode, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import platformSource from '../../../../docs/multi-file/platform.loadmap?raw'
import shopSource from '../../../../docs/multi-file/shop.loadmap?raw'
import storySource from '../../../../docs/multi-file/shop.story.loadmap?raw'
import cascadiaCode from '../fonts/cascadia-code.woff2?url'
import firaCode from '../fonts/fira-code.woff2?url'
import jetbrainsMono from '../fonts/jetbrains-mono.woff2?url'
import { CHOICES, ICONS, themeSwitch } from '../theme-switch'
import uploadsSource from '../uploads.loadmap?raw'
import { bridge } from './bridge'
import AccountButton from './github/AccountButton'
import { account } from './github/account'
import { changedCount, changedText, changes } from './github/changes'
import { allVersions, endingWith, type Version, versionsSince } from './github/commits'
import type { Listing, Opened } from './github/load'
import type { RepoTarget } from './github/parse'
import { clearAside, leave as leaveTab, type RepoTab, readAside, readTab, writeTab } from './github/tab'
import type { Saved } from './github/write'
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
/** One definition in several files: a model, its part and the library it imports, each a tab. */
const SHOP = {
  path: 'shop.loadmap',
  files: { 'shop.loadmap': shopSource, 'shop.story.loadmap': storySource, 'platform.loadmap': platformSource },
}
/** The examples in several files, by name: `?example=` opens each file as a tab. */
const SEVERAL: Readonly<Record<string, typeof regionsFiles>> = { regions: regionsFiles }
/** The code's fonts from the site's own files (OFL, beside them), not a CDN: fetched only when the reader picks one. */
const FONTS: readonly CodeFont[] = [
  { name: 'Fira Code', url: firaCode },
  { name: 'JetBrains Mono', url: jetbrainsMono },
  { name: 'Cascadia Code', url: cascadiaCode },
]

const DRAFT = 'loadmap-editor-draft'
/** The draft's files when it has several: `{ path, files }`, the model's text also under the key above. */
const DRAFT_FILES = 'loadmap-editor-draft-files'
/** The reader's draft as it was before another text took its place. */
const EARLIER = 'loadmap-editor-draft-earlier'
/** The code panel's share of the width, as the reader left it (the divider's old share is not one). */
const SPLIT = 'loadmap-editor-card'
/** Whether the reader hid the code. */
const LAYOUT = 'loadmap-editor-layout'
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
const WHOLE = new Set<string>([
  ...TEMPLATES.map((t) => t.source),
  ...Object.values(SOURCES),
  ...Object.values(SEVERAL).map((s) => s.files[s.path as keyof typeof s.files]),
])

const readDraft = () => read(DRAFT)

/** The draft's files, when it was left in several and they still read as files. */
function readDraftFiles(): { path: string; files: Record<string, string> } | undefined {
  try {
    const d = JSON.parse(read(DRAFT_FILES) ?? 'null') as { path?: unknown; files?: unknown } | null
    if (!d || typeof d.path !== 'string' || typeof d.files !== 'object' || d.files === null) return undefined
    const files: Record<string, string> = {}
    for (const [p, text] of Object.entries(d.files)) {
      if (typeof text !== 'string' || !p.endsWith('.loadmap')) return undefined
      files[p] = text
    }
    return Object.hasOwn(files, d.path) && Object.keys(files).length > 1 ? { path: d.path, files } : undefined
  } catch {
    return undefined
  }
}
const query = () => new URLSearchParams(location.search)

/** The site's embed page for a share hash, with what the reader picked: the page ClickUp's /embed frames. */
function embedLink(hash: string, o: EmbedOptions): string {
  const url = new URL('../embed/', location.href)
  url.searchParams.set('mode', o.mode)
  if (o.theme !== 'auto') url.searchParams.set('theme', o.theme)
  if (o.play) url.searchParams.set('play', '1')
  return `${url.href}#${hash}`
}
const fromLink = () => location.hash.startsWith('#v1.') || location.hash.startsWith('#v2.')
const fromRepo = () => !fromLink() && query().has('repo')
/** The GitHub dialog, loaded the first time it opens. */
const OpenDialog = lazy(() => import('./github').then((m) => ({ default: m.OpenDialog })))
const ChangesDialog = lazy(() => import('./github').then((m) => ({ default: m.ChangesDialog })))
const SaveDialog = lazy(() => import('./github').then((m) => ({ default: m.SaveDialog })))
const NewRepoDialog = lazy(() => import('./github').then((m) => ({ default: m.NewRepoDialog })))
const ConnectDialog = lazy(() => import('./github').then((m) => ({ default: m.ConnectDialog })))
/** The button's own rules, with it: docs.css is every page's first load. */
const REPO_CSS = `
.app-repo { max-width: 260px; font-family: var(--lm-mono); font-size: .78rem; }
.app-repo .app-label { overflow: hidden; text-overflow: ellipsis; }
.app-changed { min-width: 18px; padding: 0 5px; border-radius: 999px; color: var(--lm-accent); background: var(--lm-accent-soft); font: 600 .72rem var(--lm-font); text-align: center; }
`
/** A branch, for the button that says which repository the files came from. */
const BRANCH =
  'M5 4v6.5M11 6c0 3-6 2.5-6 5M6.5 2.75a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM12.5 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM6.5 12.75a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z'
const template = () => TEMPLATES.find((t) => t.id === query().get('template'))
const example = () => {
  const name = query().get('example')
  if (name && Object.hasOwn(SEVERAL, name)) return SEVERAL[name]!.files[SEVERAL[name]!.path as 'regions.loadmap']
  return name && Object.hasOwn(SOURCES, name) ? SOURCES[name as keyof typeof SOURCES] : undefined
}
const exampleFiles = () => {
  const name = query().get('example')
  return name && Object.hasOwn(SEVERAL, name) ? SEVERAL[name] : undefined
}
/** What the editor opens with when no link says: a template, an example, else the draft when it is in several files. */
const startFrom = (): Shared | undefined => {
  const several = exampleFiles()
  if (several) return { source: example()!, values: {}, ...several }
  const whole = template()?.source ?? example()
  if (whole != null) return { source: whole, values: {} }
  const files = readDraftFiles()
  return files ? { source: files.files[files.path]!, values: {}, ...files } : undefined
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
  /** What a new repository starts with, worked out when its dialog opens: every version, then the files as they are. */
  const [newRepo, setNewRepo] = useState<Version[] | null>(null)
  const allNow = (): Version[] => {
    const h = editor.current?.history()
    const live = editor.current?.files().files ?? {}
    const v = h ? allVersions(h) : []
    return endingWith(v, live, null, v.length ? 'Edited' : 'A loadmap model')
  }
  /** The editor's versions since the repository's files were opened, the files as they are now the last. */
  const versionsNow = (): Version[] | undefined => {
    const h = editor.current?.history()
    const t = repo.current
    if (!h || !t) return undefined
    const v = versionsSince(h, t.origin.originals)
    return v && endingWith(v, editor.current!.files().files, t.origin.originals)
  }
  // a private repository's files leave this page only once the reader says so, once per session
  const assist = useMemo(
    () => ({
      reference: loadReference,
      smallReference: loadSmallReference,
      data: bridge,
      signIn: { openrouter: () => import('./openrouter').then((m) => m.openRouterSignIn()) },
      settings: settingsFor(() => repo.current),
      conversations: conversationsFor(() => repo.current),
      confirmSend: (p: { name: string }) => {
        const o = repo.current?.origin
        if (!o?.private) return true
        const at = `${o.owner}/${o.name}`
        if (allowed.has(at)) return true
        const yes = window.confirm(`These files come from the private repository ${at}. Send them to ${p.name}?`)
        if (yes) allowed.add(at)
        return yes
      },
    }),
    [],
  )
  const [get] = useState(() => () => editor.current?.loadmap())
  const { png, poster, record } = useRecorder('editor', get, () => editor.current?.tidy())
  const [help, setHelp] = useHelp()
  const [close] = useState(() => closeTo(root))
  // what this tab opened from GitHub, as the reader left it: it opens again on a reload, unless the address asks for
  // something else, which takes its place (a private repository with edits is kept aside)
  const [tab] = useState(() => {
    const t = readTab()
    if (!t || !(fromLink() || fromRepo() || template() || example())) return t
    leaveTab(t)
    return undefined
  })
  const repo = useRef<RepoTab | undefined>(tab)
  const [aside, setAside] = useState(readAside)
  // the repository the files came from, and how many the reader changed: the bar's button says both
  const [from, setFrom] = useState(() => tab && `${tab.origin.owner}/${tab.origin.name}`)
  const [changed, setChanged] = useState(() => (tab ? changedCount(tab) : 0))
  const [showChanges, setShowChanges] = useState(false)
  const [showSave, setShowSave] = useState(false)
  // worked out once as the save opens, not on every draw while it is open
  // biome-ignore lint/correctness/useExhaustiveDependencies: read as the dialog opens; the editor is read through a ref
  const saveVersions = useMemo(() => (showSave ? versionsNow() : undefined), [showSave])
  // the tab could not keep a private repository's files: a reload would lose the edits, and the page says so
  const [unkept, setUnkept] = useState(false)
  const keep = (t: RepoTab) => {
    repo.current = t
    setFrom(`${t.origin.owner}/${t.origin.name}`)
    setChanged(changedCount(t))
    if (!writeTab(t) && t.origin.private) setUnkept(true)
  }
  // the start from an address hears of a repository after the first render
  const keeping = useRef(keep)
  keeping.current = keep
  const leaveRepo = () => {
    if (repo.current && leaveTab(repo.current)) setAside(readAside())
    repo.current = undefined
    setFrom(undefined)
    setChanged(0)
    setShowChanges(false)
    setShowSave(false)
    settle(new Error('the repository was left'))
    setUnkept(false)
  }
  // a file, or every file, back as the commit holds it
  const undo = (path?: string) => {
    const t = repo.current
    if (!t) return
    // each change undone takes the file back to what the commit holds: an added file goes, a removed one comes back
    const files = { ...t.files }
    for (const c of changes(t).filter((c) => path == null || c.path === path))
      if (c.before === undefined) delete files[c.path]
      else files[c.path] = c.before
    const model = Object.hasOwn(files, t.path) ? t.path : t.origin.model
    keep({ ...t, path: model, files })
    // an edit, not a new definition: the diagram keeps its view, what is open and the values
    void editor.current?.changeFiles({ path: model, files })
  }
  // saved: the files are now what the new commit holds, on the branch this tab made
  // ⌘S waits for the dialog: the editor says "Saved" only once GitHub has the commit, "Not saved" when it closes first
  const pending = useRef<{ resolve: () => void; reject: (e: Error) => void } | null>(null)
  const settle = (e?: Error) => {
    if (e) pending.current?.reject(e)
    else pending.current?.resolve()
    pending.current = null
  }
  const saveKey = () =>
    new Promise<void>((resolve, reject) => {
      pending.current = { resolve, reject }
      setShowSave(true)
    })
  const saved = (s: Saved) => {
    settle()
    const t = repo.current
    if (!t) return
    const origin = { ...t.origin, ref: s.branch, made: true, sha: s.commit, tree: s.tree, model: t.path }
    keep({ ...t, origin: { ...origin, originals: { ...t.files } } })
  }
  /** A menu's own text in the editor's place: the repository is left first. */
  const leaving = (put: () => void) => () => {
    leaveRepo()
    put()
  }
  // a link's definition (or a repository's) wins over the draft; reading it is async, so the editor waits for it
  const [start, setStart] = useState<Start | null>(() =>
    fromLink() || fromRepo()
      ? null
      : tab
        ? { source: tab.files[tab.path] ?? '', values: {}, path: tab.path, files: tab.files }
        : draftStart(),
  )
  const [github, setGithub] = useState<{ target?: RepoTarget; listing?: Listing; ask?: string } | null>(null)
  // the bar's Connect to GitHub, when it needs a word: no app in this build, a pasted token chosen, a blocked popup
  const [connecting, setConnecting] = useState<{ paste?: boolean; error?: string } | null>(null)
  useEffect(() => {
    if (start) return
    if (!fromRepo()) {
      decodeShare(location.hash).then(setStart)
      return
    }
    let gone = false
    import('./github')
      .then((m) => m.fromQuery(query()))
      .catch(() => ({ error: 'The GitHub part of the page could not load' }))
      .then((r) => {
        if (gone) return
        if ('opened' in r) {
          keeping.current(tabOf(r.opened))
          setStart(fromOpened(r.opened))
        }
        // the draft as it would open without the address, in all its files; the error said above it
        else if ('error' in r) setStart({ ...draftStart(), error: r.error })
        else {
          // several models and none named, or a token to give first: the dialog, the draft behind
          setStart(draftStart())
          setGithub('ask' in r ? { target: r.target, ask: r.ask } : { listing: r.listing, target: r.target })
        }
      })
    return () => {
      gone = true
    }
  }, [start])
  // the page is the editor: ⌘S from habit never opens the browser's Save Page, wherever the focus is (the editor says
  // what keeps the text when it holds the focus)
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => isSaveKey(e) && e.preventDefault()
    addEventListener('keydown', keydown)
    return () => removeEventListener('keydown', keydown)
  }, [])
  // editing what came from outside makes it the draft: the earlier draft is kept aside, and the address loses the
  // link, the template or the example, so a reload shows the edits
  const outside = useRef(fromLink() || fromRepo() || !!template() || !!example())
  // a link opens for readers (the code with ?code); else the code shows or hides as the reader left it
  const [layout] = useState<EditorLayout>(() =>
    fromLink() ? (query().has('code') ? 'code' : 'reader') : read(LAYOUT) === 'reader' ? 'reader' : 'code',
  )
  const [linked] = useState(fromLink)
  const [earlier, setEarlier] = useState(() => read(EARLIER))
  const [split] = useState(() => Number(read(SPLIT) ?? Number.NaN))
  const save = (s: string) => {
    // a template in its place: the repository is left
    if (repo.current && WHOLE.has(s)) leaveRepo()
    // a private repository's text stays in this tab (tab.ts), never in the draft: the reader's own is left as it was
    if (repo.current?.origin.private) {
      if (outside.current) {
        outside.current = false
        history.replaceState(null, '', location.pathname)
      }
      return
    }
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
  // a draft in several files: all of them, and its model under the draft's own key, where one file is read
  const saveFiles = (all: { path: string; files: Readonly<Record<string, string>> }) => {
    if (repo.current) {
      keep({ ...repo.current, path: all.path, files: { ...all.files } })
      if (repo.current.origin.private) return
    }
    if (Object.keys(all.files).length > 1) {
      write(DRAFT_FILES, JSON.stringify(all))
      write(DRAFT, all.files[all.path] ?? '')
    } else if (read(DRAFT_FILES) != null) {
      try {
        localStorage.removeItem(DRAFT_FILES)
      } catch {
        // as for writing: a convenience
      }
    }
  }
  // the draft is written on every change, so leaving loses nothing; with a page of the docs behind, Close goes back
  // to it, where the reader was
  const leave = (e: MouseEvent) => {
    if (!close.back || history.length < 2 || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    history.back()
  }
  if (!start) return <p className="app-note">{fromRepo() ? 'Opening the repository…' : 'Opening the link…'}</p>
  // a repository's files take the draft's place as an example does: the draft is kept aside on the first edit
  const opened = (o: Opened) => {
    leaveRepo()
    outside.current = true
    keep(tabOf(o))
    editor.current?.setFiles({ path: o.path, files: o.files })
  }
  // a private repository left with edits, back where it was
  const back = (t: RepoTab) => {
    clearAside()
    setAside(undefined)
    // what is open now goes aside in its turn, when it is a private repository with edits
    leaveRepo()
    keep(t)
    editor.current?.setFiles({ path: t.path, files: t.files })
  }

  const examples: BarSection[] = [
    {
      label: 'Examples',
      items: [
        ...(Object.keys(SOURCES) as (keyof typeof SOURCES)[]).map((n) => ({
          label: NAMES[n],
          onSelect: leaving(() => editor.current?.setSource(SOURCES[n])),
        })),
        { label: 'A shop in several files', onSelect: leaving(() => editor.current?.setFiles(SHOP)) },
        { label: 'Two regions, in several files', onSelect: leaving(() => editor.current?.setFiles(regionsFiles)) },
        ...(earlier != null
          ? [{ label: 'Your earlier draft', onSelect: leaving(() => editor.current?.setSource(earlier)) }]
          : []),
      ],
    },
  ]
  const repos: BarSection[] = [
    {
      label: 'GitHub',
      items: [
        { label: 'Open from GitHub…', onSelect: () => setGithub({}) },
        {
          label: 'Save to a new repository…',
          hint: 'In your account, private unless you choose; every version a commit',
          onSelect: () => setNewRepo(allNow()),
        },
        ...(aside
          ? [
              {
                label: `Your edits to ${aside.origin.owner}/${aside.origin.name}`,
                hint: 'Kept in this tab when another text took their place',
                onSelect: () => back(aside),
              },
            ]
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
    <>
      {github && (
        <Suspense fallback={null}>
          <OpenDialog start={github} onOpen={opened} onClose={() => setGithub(null)} />
        </Suspense>
      )}
      {connecting && (
        <Suspense fallback={null}>
          <ConnectDialog {...connecting} onClose={() => setConnecting(null)} />
        </Suspense>
      )}
      {from && <style>{REPO_CSS}</style>}
      {newRepo && (
        <Suspense fallback={null}>
          <NewRepoDialog
            versions={newRepo}
            starters={STARTERS}
            name={(editor.current?.files().path.split('/').pop() ?? 'model').replace(/\.loadmap$/, '')}
            onClose={() => setNewRepo(null)}
          />
        </Suspense>
      )}
      {showChanges && repo.current && (
        <Suspense fallback={null}>
          <ChangesDialog
            tab={repo.current}
            list={changes(repo.current)}
            onUndo={undo}
            onSave={() => {
              setShowChanges(false)
              setShowSave(true)
            }}
            onClose={() => setShowChanges(false)}
          />
        </Suspense>
      )}
      {showSave && repo.current && (
        <Suspense fallback={null}>
          <SaveDialog
            origin={repo.current.origin}
            path={repo.current.path}
            list={changes(repo.current)}
            versions={saveVersions}
            onSaved={saved}
            onClose={() => {
              setShowSave(false)
              settle(new Error(changed ? 'the dialog closed first' : 'nothing changed'))
            }}
          />
        </Suspense>
      )}
      <LoadmapEditor
        ref={editor}
        fill
        fonts={FONTS}
        theme="inherit"
        initial={'source' in start ? start.source : (readDraft() ?? SOURCES.uploads)}
        values={'values' in start ? start.values : undefined}
        files={
          'files' in start && start.files && start.path != null ? { path: start.path, files: start.files } : undefined
        }
        onFiles={saveFiles}
        // ⌘S with a repository open saves to it; without one the editor says the draft is kept
        onSave={from ? saveKey : undefined}
        layout={layout}
        onChange={save}
        embedLink={embedLink}
        split={split}
        onSplit={(n) => write(SPLIT, String(n))}
        // a link opens as its sender meant it: what the reader does with it is not how they leave their own editor
        onLayout={(l) => !linked && write(LAYOUT, l)}
        track={read(TRACK) === 'on'}
        onTrack={(on) => write(TRACK, on ? 'on' : 'off')}
        // every version of this tab's files, gone with the tab, as the repository's files are
        history={HISTORY}
        // the Ask panel: the reader's own key and model; the model reads the site's llms-full.txt
        assist={assist}
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
            {unkept && (
              <span className="app-error">
                This tab could not keep the repository's files: a reload would lose your edits.
              </span>
            )}
          </>
        }
        newItems={[...examples, ...repos]}
        exportItems={images}
        actions={
          <>
            {from && (
              <button
                type="button"
                className="lm-btn lme-quiet app-repo"
                aria-label={`${from}: ${changed ? changedText(changed) : 'nothing changed'}`}
                title={`Opened from ${from}: what changed`}
                onClick={() => setShowChanges(true)}
              >
                <Icon d={BRANCH} />
                <span className="app-label">{from}</span>
                {changed > 0 && <span className="app-changed">{changed}</span>}
              </button>
            )}
            <AccountButton
              onOpen={() => setGithub({})}
              onNewRepo={() => setNewRepo(allNow())}
              onDialog={setConnecting}
            />
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
    </>
  )
}

const HISTORY = { key: 'loadmap-editor-history' }

/** A new repository can start from a template, in place of the model in the editor: one commit, its one file. */
const STARTERS = TEMPLATES.map((t) => ({
  label: `The ${t.title} template`,
  name: t.id,
  versions: [{ message: `Start from loadmap's ${t.title} template`, files: { [`${t.id}.loadmap`]: t.source } }],
}))

/** A text of the site, fetched once; tried again on the next question when it did not load. */
function once(file: string): () => Promise<string> {
  let text: Promise<string> | undefined
  return () =>
    (text ??= fetch(new URL(`../${file}`, location.href))
      .then((r) => {
        if (!r.ok) throw new Error('the reference did not load')
        return r.text()
      })
      .catch((err: unknown) => {
        text = undefined
        throw err
      }))
}

/** The reference the Ask panel's model reads: the whole one, or the short one for a model with a small window. */
const loadReference = once('llms-full.txt')
const loadSmallReference = once('llms-small.txt')

/**
 * The reader's model and keys, remembered by the site's Worker for a reader connected through the app, and the open
 * repository's own (filed under GitHub's id of it). Its code loads only for such a reader: anyone else gets nothing to
 * remember with, without a request.
 */
function settingsFor(open: () => RepoTab | undefined): ModelSettings {
  const code = () => import('./github/settings').then((m) => m.settings)
  return {
    where: "this site's service",
    repository: () => {
      const o = open()?.origin
      return o?.id != null ? { id: String(o.id), name: `${o.owner}/${o.name}` } : undefined
    },
    load: async (repo) => {
      const a = account()
      if (!a.login || a.via !== 'app') return null
      return (await code()).load(repo)
    },
    key: async (provider, repo) => (await code()).key(provider, repo),
    save: async (choice) => (await code()).save(choice),
    remove: async (what) => (await code()).remove(what),
  }
}

/**
 * The Ask panel's conversations, kept across reloads by what the editor holds: a repository (by GitHub's id when the
 * page read one), or the draft. A private repository's stay in the tab, as its files do.
 */
function conversationsFor(open: () => RepoTab | undefined): ConversationStore {
  const code = () => import('./conversations')
  return {
    scope: () => {
      const o = open()?.origin
      if (!o) return 'draft'
      const id = `repo:${o.id ?? `${o.owner}/${o.name}`}`
      return o.private ? `private:${id}` : id
    },
    load: async (scope) => (await code()).load(scope),
    save: async (scope, kept) => (await code()).save(scope, kept),
  }
}

/** The private repositories whose files the reader said may go to a model, this page's session. */
const allowed = new Set<string>()

/** What the editor opens with: a link's, a repository's or the draft's; a draft can come with why the rest did not. */
type Start = Shared | (Extract<Shared, { source: string }> & { error: string })

/** The reader's draft, as the editor opens without an address: a template, an example, the draft in all its files. */
const draftStart = (): Shared => startFrom() ?? { source: readDraft() ?? SOURCES.uploads, values: {} }

/** A repository's model as this tab keeps it: where it came from, and its files, as they came and as they are. */
function tabOf(o: Opened): RepoTab {
  const { owner, name, ref, sha, tree, private: shut, branch, id } = o.listing
  return {
    origin: {
      owner,
      name,
      ref,
      base: ref,
      pullable: branch,
      made: false,
      sha,
      tree,
      private: shut,
      id,
      originals: o.files,
      model: o.path,
      crlf: o.crlf,
      exec: o.exec,
    },
    path: o.path,
    files: o.files,
  }
}

/** What the editor opens with for a repository's model: its files, the model's text first. */
const fromOpened = (o: Opened): Shared => ({ source: o.files[o.path] ?? '', values: {}, path: o.path, files: o.files })

export function mount(el: HTMLElement) {
  const root = new URL(document.body.dataset.root ?? './', location.href)
  createRoot(el).render(
    <StrictMode>
      <Editor root={root} />
    </StrictMode>,
  )
}
