import { hasNextSnippetField, nextSnippetField, startCompletion } from '@codemirror/autocomplete'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentMore,
  indentWithTab,
  isolateHistory,
  redo,
  undo,
  undoDepth,
} from '@codemirror/commands'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { forceLinting } from '@codemirror/lint'
import { EditorState, type Extension, Transaction } from '@codemirror/state'
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view'
import type { ParamValue } from '@loadmap/core'
import { published } from '@loadmap/core'
import { fmt } from '@loadmap/core/format'
import { conditionText } from '@loadmap/core/internal'
import {
  type CompileResult,
  compile,
  type Definition,
  type Diagnostic,
  type DslSymbol,
  encodeShare,
  format,
  type HostFunctions,
  imports,
  LANGUAGE_VERSION,
  type Located,
  loadCatalog,
  loadCatalogFor,
  loadedCatalog,
  needsCatalog,
  problems,
  sharedValues,
} from '@loadmap/dsl'
import type { AddResult } from '@loadmap/dsl/add'
import {
  boxPath,
  changedBoxes,
  type Drawn,
  type EditResult,
  type EditValue,
  edit,
  fingerprint,
  inspect,
  inspectCopy,
  latestEdition,
  MAX_FILES,
  pageOptions,
  parse,
  type Range,
  relativePath,
  resolvePath,
  setProperty,
  takeLine,
  writeInput,
} from '@loadmap/dsl/internal'
import { Canvas, Loadmap, type LoadmapHandle, type Theme, useCanvasPanels, usePageTheme } from '@loadmap/react'
import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { CatalogApi } from './CatalogPicker'
import type { TemplateEntry } from './catalog'
import { Embed, type EmbedHandle, type EmbedOptions } from './Embed'
import type { ExplorerProps } from './Explorer'
import type { FileTabsProps } from './FileTabs'
import type { FileMark } from './filenames'
import type { Dsl, NewKind } from './fileops'
import { CODE_FONTS, CODE_SIZE, CODE_SIZES, type CodeFont, fontStack, loadFont } from './fonts'
import type { Author, HistoryData } from './history'
import type { InspectorProps, InspectorTab } from './Inspector'
import { editorKeys, isSaveKey } from './keys'
import { type Around, loadmapLanguage, renameMark, startRename } from './language'
import { type BarSection, barItems, ICON, Icon, later, Menu, MenuGroup, MenuItem, sections, useToolbar } from './Menu'
import { PanelHead, RAIL, Rail, Resize } from './Panel'
import { plusMinusSigns, redrawMarks } from './plusMinus'
import type { FileHost } from './reshape'
import { lazySearch, openSearch } from './search'
import type { Studio, StudioHost } from './studio'
import { injectEditorStyles } from './styles'
import type { Template } from './templates'

/** What a page can drive from outside. */
export interface LoadmapEditorHandle {
  source(): string
  /** Replaces the whole text, e.g. with an example. */
  setSource(source: string): void
  /** The preview, once a version has compiled. */
  loadmap(): LoadmapHandle | null
  /** The hash of a link to this definition at the current values: `v1.…&load=30`. */
  shareHash(): Promise<string>
  /** Lays the text out the one way (`format()`); false when it has a syntax error. */
  format(): boolean
  /** Every file of the definition by its path, and the path of its model: one entry for a definition in one file. */
  files(): EditorFiles
  /** Replaces the whole definition with one in several files; its model shows first. */
  setFiles(files: EditorFiles): void
  /** The history of the files as plain data, when the editor keeps one (`history`): what a save pushes. */
  history(): HistoryData | null
}

/** A definition in several files: the path of its model (the file the diagram draws) and every file by its path. */
export interface EditorFiles {
  path: string
  files: Readonly<Record<string, string>>
}

/** The path a text has when nothing says another: a definition in one file. */
const ONE = 'input.loadmap'
/** Where this browser keeps the reader's choice of the canvas's dot grid. */
const GRID_KEY = 'loadmap:editor:grid'
/** The least size of the code on a phone: below it, iOS zooms the page as the text takes the keyboard. */
const PHONE_SIZE = 16
/** And of the code's font, its size and its ligatures. */
const FONT_KEY = 'loadmap:editor:font'
const SIZE_KEY = 'loadmap:editor:fontSize'
const LIGATURES_KEY = 'loadmap:editor:ligatures'

/** A setting this browser keeps for the reader; null when it has none, or keeps nothing (a private window). */
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Keeps a setting (null takes it out): in a private window it lasts as long as the page. */
function keep(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // a private window
  }
}

/**
 * What ⌘S does on a page: its own save, or nothing but saying what keeps the text (a draft the page keeps, or none).
 * `note` is the bar's word as the key is pressed, `sheet` the row in View → Keyboard shortcuts.
 */
function saveSays(saves: boolean, keeps: boolean): { note: string; sheet: string } {
  if (saves) return { note: 'Saving…', sheet: 'Save' }
  const why = keeps ? 'kept as you type' : 'this page keeps no copy, Share does'
  return { note: why[0]!.toUpperCase() + why.slice(1), sheet: `Nothing to save: ${why}` }
}

/** `code`: the text beside the diagram. `reader`: the diagram with an inspector, the text hidden. */
export type EditorLayout = 'code' | 'reader'

export interface LoadmapEditorProps {
  /** The text to start from. */
  initial: string
  /** Values to start the preview at; texts (from a shared link) are read by each parameter's kind. */
  values?: Readonly<Record<string, ParamValue>>
  /** Functions formulas may call beyond the built-in ones. */
  functions?: HostFunctions
  theme?: Theme
  /** Every change of the text: a page can keep a draft. */
  onChange?: (source: string) => void
  /**
   * A definition in several files (from a `#v2.` link): the path of `initial`, its model, and every file by its path.
   * The model opens in the editor; the others open from the files' explorer, each a tab over the text. With one file
   * there are no tabs.
   */
  files?: EditorFiles
  /** Every change of any file, a file added or removed: all of them, for a page that keeps a draft. */
  onFiles?: (files: EditorFiles) => void
  /**
   * ⌘S (Ctrl+S, with or without ⇧) while the editor holds the focus: the page saves every file of the definition, a
   * branch or a file of its own. Without it the keys only say what keeps the text (`onChange` or `onFiles`, or nothing).
   * Either way the browser's Save Page never opens over the editor.
   */
  onSave?: (files: EditorFiles) => void | Promise<void>
  /** Called with a share hash. Default: puts it in the address bar and copies the link. */
  onShare?: (hash: string) => void | Promise<void>
  /**
   * The link to a page that frames a definition (an embed), from its share hash and the options picked. With it,
   * Share's menu has "Embed in a page…": the link, or an `<iframe>` with it, for ClickUp's /embed or any page.
   */
  embedLink?: (hash: string, o: EmbedOptions) => string
  /** More in the New menu, after the templates: each section a heading and its items (examples, a draft). */
  newItems?: readonly BarSection[]
  /** More in the Export menu, after the download: each section a heading and its items (images, a recording). */
  exportItems?: readonly BarSection[]
  /** More controls for the bar, before Share: a theme, help. On a phone they go in the sheet of actions. */
  actions?: ReactNode
  /** Controls at the start of the bar, before the name: a way back, a brand. */
  start?: ReactNode
  /**
   * The editor fills its container, which gives it a height: the bar, then the code in a panel on the left, which
   * resizes by its inner edge and folds onto a rail, and beside it the diagram as `<Loadmap fill>` draws it: a canvas
   * the reader pans and zooms, the scenarios over it, the load and the verdict under it, and the rest in panels that
   * open from their tabs. The bar shows the model's title. On a phone (below 720 px wide, or a phone on its side) the
   * text or the diagram, switched at the bottom, and the actions other than Share in a sheet of their own. The root
   * carries `data-narrow` on a phone and `data-short` below 1000 px, for a page's own controls to follow.
   */
  fill?: boolean
  /** With `fill`: the code panel's share of the width (360 px to 60 % of it), and where a double-click on its edge puts it back. Default: 440 px. */
  split?: number
  /** With `fill`: the code panel was resized, to this share; a page can keep it. */
  onSplit?: (share: number) => void
  /** The reader showed or hid the code; a page can keep it. */
  onLayout?: (layout: EditorLayout) => void
  /**
   * Track live changes: once an edit is drawn and the text rests a moment, the board brings the boxes it changed into
   * view (at the same zoom, further out only as far as it takes) and marks them. Off, the view stays where the reader
   * left it. Default off.
   */
  track?: boolean
  /** The reader turned tracking on or off; a page can keep it. */
  onTrack?: (on: boolean) => void
  /**
   * The starters in the New menu; false leaves them out. Default: the twelve that come with the editor (`TEMPLATES`),
   * the list loaded when the menu first opens, each one's text when the reader picks it.
   */
  templates?: readonly Template[] | false
  /**
   * Add → From the catalog in the New menu: a component's published figure, as a new box or the capacity of the box
   * selected. Default true; false leaves it out.
   */
  catalog?: boolean
  /**
   * The fonts the reader can pick for the code in View, beside the system's monospace. Default `CODE_FONTS`: Fira
   * Code, JetBrains Mono and Cascadia Code from jsDelivr, each loaded only when picked; `[]` offers none.
   */
  fonts?: readonly CodeFont[]
  /** The name the downloaded file takes, without ".loadmap". Default: the title. */
  fileName?: string
  /**
   * How it opens. `reader` shows the diagram with an inspector beside it: a click on a box shows its label, its
   * capacity and its parameters to change, each change a small edit of the text. "Show code" switches. Default `code`,
   * where a click on a box selects its lines in the text.
   */
  layout?: EditorLayout
  /**
   * Keep a history of the files: each version the reader keeps, each save and each definition loaded is a commit, as
   * git writes one. A Timeline panel shows them: Back and Forward draw an older version, Restore makes it the files
   * again with a new version on top, "Branch from here" tries another design. With `key` it is mirrored to this tab's
   * storage (sessionStorage) under that key: a reload keeps it, closing the tab drops it. Loaded on first use; off by
   * default.
   */
  history?: boolean | { key?: string }
  ref?: Ref<LoadmapEditorHandle>
}

interface Compiled {
  source: string
  result: CompileResult
  /** The last version that compiled; it stays on screen while the text has errors. */
  good: Definition | null
  /** Its tokens: an edit that leaves them alone (a comment, spacing) keeps the same model and view. */
  goodKey: string
  /** Counts the whole texts loaded (a template, a shared link): each starts a new diagram, fitted; an edit keeps it. */
  doc: number
  /** The file the result is about: a problem that names no file is in this one. */
  given: string
  /** The file `source` is the text of: the one in the editor when it was compiled. */
  file: string
}

/** A text editor for a `.loadmap` definition next to its live diagram. */
export function LoadmapEditor({
  initial,
  values,
  functions,
  theme,
  onChange,
  files: initialFiles,
  onFiles,
  onSave,
  onShare,
  embedLink,
  newItems,
  exportItems,
  actions,
  start,
  fill = false,
  split,
  onSplit,
  onLayout,
  track: initialTrack = false,
  onTrack,
  fileName,
  fonts = CODE_FONTS,
  templates,
  catalog = true,
  layout: initialLayout = 'code',
  history: keepHistory = false,
  ref,
}: LoadmapEditorProps) {
  useEffect(() => injectEditorStyles(), [])
  // the files of a definition in several: the one in the editor (`active`), the model the diagram draws (`entry`) and
  // the text of every other. With one file there are no others, and the editor is what it is without this
  const set = useRef<{ entry: string; active: string; others: Record<string, string>; version: number }>(null!)
  if (!set.current) {
    const entry = initialFiles?.path ?? ONE
    const others = Object.fromEntries(Object.entries(initialFiles?.files ?? {}).filter(([p]) => p !== entry))
    set.current = { entry, active: entry, others, version: 0 }
  }
  /** What the language reads beside the open text; nothing for a definition in one file. */
  const around = (): Around | undefined => {
    const f = set.current
    return Object.keys(f.others).length ? { path: f.active, files: f.others, version: f.version } : undefined
  }
  const aroundRef = useRef(around)
  aroundRef.current = around
  /** The same, as compile(), edit() and the catalog take it. */
  const beside = () => {
    const a = around()
    return a ? { path: a.path, files: a.files } : {}
  }
  const [gridChoice, setGridChoice] = useState<boolean | null>(() => {
    const said = stored(GRID_KEY)
    return said == null ? null : said !== 'off'
  })
  // the code's look, the reader's own, kept in this browser: a font of `fonts` (null: the system's), a size, ligatures
  const [fontName, setFontName] = useState(() => stored(FONT_KEY))
  const [fontSize, setFontSize] = useState(() => {
    const said = Number(stored(SIZE_KEY))
    return CODE_SIZES.includes(said) ? said : CODE_SIZE
  })
  const [ligatures, setLigatures] = useState(() => stored(LIGATURES_KEY) !== 'off')
  // the text's extensions are made once: they read the ligatures through this
  const ligaturesOn = useRef(ligatures)
  ligaturesOn.current = ligatures
  // a font the page no longer offers is the system's
  const codeFont = fonts.find((f) => f.name === fontName)
  const [tabs, setTabs] = useState(() => [set.current.entry, ...Object.keys(set.current.others).sort()])
  const [active, setActive] = useState(set.current.entry)
  // the files with a tab, in the order they were opened: what shows, never what the definition is. The model's is
  // always there
  const [open, setOpen] = useState(() => [set.current.entry])
  // the files' explorer beside the text, and a new file it asks the name of as it opens
  const [explorer, setExplorer] = useState(false)
  const [startNew, setStartNew] = useState<NewKind | null>(null)
  const panelId = useId()
  // each file's own editor state while another is in the editor: its text, its cursor, its undo history
  const states = useRef(new Map<string, EditorState>())
  const exts = useRef<Extension[]>([])
  const [state, setState] = useState<Compiled>(() => {
    const result = compile(initial, { functions, ...beside() })
    return {
      source: initial,
      result,
      good: result.definition ?? null,
      goodKey: modelKey([
        [set.current.entry, fingerprint(initial)],
        ...Object.entries(set.current.others).map(([p, text]) => [p, fingerprint(text)] as const),
      ]),
      doc: 0,
      given: set.current.entry,
      file: set.current.entry,
    }
  })
  // a first text with a published statement: compiled again once the catalog has loaded
  // biome-ignore lint/correctness/useExhaustiveDependencies: the first text only, as the state above
  useEffect(() => {
    if (!needsCatalog(initial) || loadedCatalog()) return
    void loadCatalogFor(initial).then(() =>
      setState((s) => {
        if (s.source !== initial) return s
        const result = compile(initial, { functions, ...beside() })
        return { ...s, result, good: result.definition ?? s.good }
      }),
    )
  }, [])
  const [note, setNoteText] = useState('')
  // each note shows its full time, the same word again too
  const [noted, setNoted] = useState(0)
  const setNote = useCallback((text: string) => {
    setNoteText(text)
    setNoted((n) => n + 1)
  }, [])
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // a font is fetched once a reader picks it; the text measures its lines again once it draws in it. One that does
  // not load gives way to the system's: picked just now, it is not kept either (a font kept from before is tried again
  // on the next visit, as the network may be back)
  const fontUrl = codeFont?.url
  const pickedNow = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the font's file, not the object a page may write anew
  useEffect(() => {
    if (!codeFont) return
    let live = true
    loadFont(codeFont).then((ok) => {
      if (!live) return
      if (ok) return view.current?.requestMeasure()
      setNote(`${codeFont.name} did not load: the system's font stands in`)
      setFontName(null)
      if (pickedNow.current) keep(FONT_KEY, null)
    })
    return () => {
      live = false
    }
  }, [fontUrl])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new size or ligatures change every line's measure
  useEffect(() => view.current?.requestMeasure(), [fontSize, ligatures])
  // the signs drawn again when the reader turns ligatures on or off; a new text draws its own
  const drawnWith = useRef(ligatures)
  useEffect(() => {
    if (drawnWith.current === ligatures) return
    drawnWith.current = ligatures
    view.current?.dispatch({ effects: redrawMarks.of(null) })
  }, [ligatures])
  const preview = useRef<LoadmapHandle>(null)
  // the values the preview shows, carried across versions so an edit does not reset the sliders
  const shown = useRef<Readonly<Record<string, unknown>>>(values ?? {})
  // setSource starts the new text from its own defaults: the next compile must not carry the old values over
  const fresh = useRef(false)
  const [track, setTrackState] = useState(initialTrack)
  const tracking = useRef(track)
  tracking.current = track
  const setTrack = (on: boolean) => {
    setTrackState(on)
    onTrack?.(on)
    before.current = null
    edits.current = []
  }
  // for tracking: what the board drew before the edits it has not followed yet, where they changed the text (in its
  // offsets now), and when the reader last typed
  const before = useRef<Drawn | null>(null)
  const edits = useRef<Range[]>([])
  const typed = useRef(0)
  // the boxes marked last, and when the mark goes: a new mark takes over from it
  const marked = useRef<{ els: Element[]; timer: number }>({ els: [], timer: 0 })
  const [unmark] = useState(() => () => {
    clearTimeout(marked.current.timer)
    for (const el of marked.current.els) el.removeAttribute('data-changed')
  })
  useEffect(() => unmark, [unmark])
  // the text last loaded whole (the initial one or a template): replacing anything else asks first
  const loaded = useRef(initial)
  const latest = useRef({ onChange, onFiles, onSave, functions })
  latest.current = { onChange, onFiles, onSave, functions }
  const [layout, setLayoutState] = useState<EditorLayout>(initialLayout)
  const setLayout = (l: EditorLayout) => {
    setLayoutState(l)
    onLayout?.(l)
  }
  // the update listener is made once: it reads the layout through this
  const shownLayout = useRef(layout)
  shownLayout.current = layout
  const root = useRef<HTMLDivElement>(null)
  // the code panel's share of the width; NaN until the reader resizes it, for its own width
  const [ratio, setRatio] = useState(() => split ?? Number.NaN)
  // with fill: its size; below 720 px wide, or 500 px high (a phone on its side), one pane at a time
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)
  // a short window is a phone on its side, not a tablet whose keyboard took half its height
  const narrow = width > 0 && (width < NARROW || (height < SHORT_HEIGHT && width < SIDEWAYS))
  const [pane, setPane] = useState<'text' | 'diagram'>('text')
  useLayoutEffect(() => {
    const el = root.current
    if (!fill || !el) return
    const measure = (w: number, h: number) => {
      setWidth(w)
      setHeight(h)
    }
    const r = el.getBoundingClientRect()
    measure(r.width, r.height)
    const ro = new ResizeObserver(([e]) => e && measure(e.contentRect.width, e.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [fill])
  const textHidden = layout === 'reader' || (fill && narrow && pane === 'diagram')
  // the text as it is now (the compile follows a moment later), and whether there is a change to undo
  const [text, setText] = useState(initial)
  const [canUndo, setCanUndo] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<InspectorTab>('box')
  // where each box is written, from the last compile: the cursor in a box's lines selects it
  const symbols = useRef<DslSymbol[]>(state.result.symbols.filter((s) => s.file == null))
  // and every box of the definition, with the file that declares it: a click on one opens it there
  const everywhere = useRef({ symbols: state.result.symbols, given: state.given })
  everywhere.current = { symbols: state.result.symbols, given: state.given }
  const formatRef = useRef<() => boolean>(() => false)
  const tools = useRef<HTMLDivElement>(null)
  // the phone's sheet of actions, drawn while it is open
  const [sheet, setSheet] = useState(false)
  const [picking, setPicking] = useState(false)
  const [shortcuts, setShortcuts] = useState(false)
  const shareGroup = useRef<HTMLSpanElement>(null)
  const embed = useRef<EmbedHandle>(null)

  /** Every file as it is now, the open one from the editor. */
  const filesNow = (): EditorFiles => {
    const f = set.current
    const open = view.current?.state.doc.toString() ?? state.source
    return { path: f.entry, files: { ...f.others, [f.active]: open } }
  }
  // the history and its panel (studio.tsx), loaded once the editor is up when the page asks for them
  const studio = useRef<Studio | null>(null)
  const [, setStudioVersion] = useState(0)
  /** An older version drawn in the canvas instead of the files. */
  const [shownVersion, setShownVersion] = useState<{ id: string; def: Definition } | null>(null)
  const shownRef = useRef(shownVersion)
  const showDef = (id: string | null, def?: Definition) => {
    shownRef.current = id && def ? { id, def } : null
    setShownVersion(shownRef.current)
  }
  const keepVersion = (author: Author, message: string) => void studio.current?.keep(author, message)
  // ⌘S from habit: the page's own save, or a word on what keeps the text; never the browser's Save Page
  // one save at a time: a second ⌘S while the page saves would race it with older files
  const saving = useRef(false)
  const pressedSave = useRef(() => {})
  pressedSave.current = () => {
    const { onSave: own, onChange: change, onFiles: files } = latest.current
    setNote(saveSays(!!own, !!(change || files)).note)
    keepVersion('you', 'Saved')
    if (!own || saving.current) return
    saving.current = true
    Promise.resolve()
      .then(() => own(filesNow()))
      .then(
        () => setNote('Saved'),
        (e: unknown) => setNote(e instanceof Error && e.message ? `Not saved: ${e.message}` : 'Not saved'),
      )
      .finally(() => {
        saving.current = false
      })
  }
  useEffect(() => {
    const el = root.current
    if (!el) return
    // in the capture: before anything in the editor takes the key, wherever the focus is in it
    const keydown = (e: KeyboardEvent) => {
      if (!isSaveKey(e)) return
      e.preventDefault()
      if (!e.repeat) pressedSave.current()
    }
    el.addEventListener('keydown', keydown, true)
    return () => el.removeEventListener('keydown', keydown, true)
  }, [])
  // the other files' tokens, once per change of them: with the open text's they say whether the model is the same
  const othersKey = useRef<{ version: number; prints: (readonly [string, string])[] }>({ version: -1, prints: [] })
  const accept = (source: string, own: CompileResult) => {
    const f = set.current
    symbols.current = own.symbols.filter((s) => s.file == null)
    // the diagram is the model's, whichever file is in the editor: a part is read through it anyway, a library is not
    const through = f.active === f.entry || (own.role === 'part' && own.files[0] === f.entry)
    const result = through
      ? own
      : compile(f.others[f.entry] ?? '', {
          functions: latest.current.functions,
          path: f.entry,
          files: { ...f.others, [f.active]: source },
        })
    const given = through ? f.active : f.entry
    if (othersKey.current.version !== f.version)
      othersKey.current = {
        version: f.version,
        prints: Object.keys(f.others).map((p) => [p, fingerprint(f.others[p]!)] as const),
      }
    const key = modelKey([...othersKey.current.prints, [f.active, fingerprint(source)]])
    const h = shownRef.current ? null : preview.current
    if (shownRef.current) showDef(null)
    // a whole new text stays one until a version of it compiles: fixing its errors starts it fitted, from its defaults
    const whole = fresh.current
    if (whole) fresh.current = !result.definition
    else if (h) shown.current = h.values()
    const e = h?.engine
    if (whole) {
      before.current = null
      edits.current = []
    } else if (tracking.current && !before.current && e?.scene) before.current = { scene: e.scene, ev: e.ev }
    setState((prev) => {
      if (prev.source === source && prev.result === result) return prev
      const file = f.active
      if (!result.definition) return { ...prev, source, result, given, file }
      if (key === prev.goodKey && prev.good) return { ...prev, source, result, given, file }
      return { source, result, good: result.definition, goodKey: key, doc: prev.doc + (whole ? 1 : 0), given, file }
    })
  }
  const acceptRef = useRef(accept)
  acceptRef.current = accept

  // biome-ignore lint/correctness/useExhaustiveDependencies: created once; a new text comes in through setSource
  useEffect(() => {
    if (!host.current) return
    // the same for every file's state: each has its own text and history, and the one language
    exts.current = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      indentOnInput(),
      bracketMatching(),
      keymap.of([
        {
          key: 'Shift-Alt-f',
          run: () => {
            formatRef.current()
            return true
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      lazySearch,
      editorKeys,
      // a capacity's +- drawn as ±, while the reader's ligatures are on
      plusMinusSigns(() => ligaturesOn.current),
      // an empty text says how to start, and where the keys are
      placeholder(`${MAC ? '⌘I' : 'Ctrl+Space'}: what can go here. View → Keyboard shortcuts: the rest.`),
      EditorState.tabSize.of(2),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': 'loadmap definition' }),
      loadmapLanguage({
        functions: latest.current.functions,
        around: () => aroundRef.current(),
        onOpen: (at) => openRef.current(at),
        onElsewhere: (changes, alone, id) => elsewhereRef.current(changes, alone, id),
        onResult: (source, result) => acceptRef.current(source, result),
      }),
      EditorView.updateListener.of((u) => {
        // an undo or a redo that crosses a rename made in several files says which: the other files follow that one
        for (const tr of u.transactions)
          if (tr.isUserEvent('undo') || tr.isUserEvent('redo'))
            for (const e of tr.effects) if (e.is(renameMark)) followRef.current(e.value.id, e.value.forward)
        if (u.docChanged) {
          typed.current = performance.now()
          // what tracking follows: an edit's own lines, never what Format re-indents
          if (tracking.current) {
            const moved = edits.current.map((r) => ({
              from: u.changes.mapPos(r.from, -1),
              to: u.changes.mapPos(r.to, 1),
            }))
            if (!u.transactions.some((t) => t.isUserEvent('format')))
              u.changes.iterChangedRanges((_a, _b, from, to) => moved.push({ from, to }))
            edits.current = moved
          }
          const doc = u.state.doc.toString()
          // only the inspector reads it: typing in the code layout re-renders nothing
          if (shownLayout.current === 'reader') setText(doc)
          latest.current.onChange?.(doc)
          if (latest.current.onFiles) {
            const f = set.current
            latest.current.onFiles({ path: f.entry, files: { ...f.others, [f.active]: doc } })
          }
        }
        setCanUndo(undoDepth(u.state) > 0)
        // the cursor in a box's lines selects the box
        if (u.selectionSet && u.view.hasFocus) {
          const at = u.state.selection.main.head
          const box = symbols.current.find((s) => s.kind === 'node' && s.decl.from <= at && at <= s.decl.to)
          if (box) setSelected(box.id)
        }
      }),
    ]
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: initial, extensions: exts.current }),
    })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
  }, [])

  const def = state.good

  // tracking: once a new version is drawn, its move done and the text at rest a moment, the board shows what it
  // changed. A version that comes meanwhile takes over, from the same drawing before
  // biome-ignore lint/correctness/useExhaustiveDependencies: each version drawn; the rest is read through refs
  useEffect(() => {
    const was = before.current
    const h = preview.current
    if (!was || !h) return
    let live = true
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    ;(async () => {
      try {
        await h.ready()
      } catch {
        return
      }
      const e = h.engine
      while (live && (e.frame !== e.scene || performance.now() - typed.current < REST)) await wait(100)
      const text = view.current?.state.doc.toString()
      if (!live || !e.scene || text == null || !tracking.current) return
      const ids = changedBoxes(was, { scene: e.scene, ev: e.ev }, text, edits.current, symbols.current)
      before.current = null
      edits.current = []
      h.show(ids)
      unmark()
      const els = [...(root.current?.querySelectorAll('.lme-preview [data-node]') ?? [])].filter((el) =>
        ids.includes(el.getAttribute('data-node')!),
      )
      // read between, so a box still marked glows again from the start
      for (const el of els) el.getBoundingClientRect()
      for (const el of els) el.setAttribute('data-changed', '')
      marked.current = { els, timer: window.setTimeout(unmark, MARK) }
    })()
    return () => {
      live = false
    }
  }, [state.good])

  /** The file at `path` in the editor, its own state back: where it was left, or new from its text. */
  const switchTo = (path: string) => {
    const v = view.current
    const f = set.current
    if (!v || (path !== f.active && !Object.hasOwn(f.others, path))) return false
    setOpen((o) => (o.includes(path) ? o : [...o, path]))
    if (path === f.active) return false
    states.current.set(f.active, v.state)
    const next = states.current.get(path) ?? EditorState.create({ doc: f.others[path]!, extensions: exts.current })
    const others = { ...f.others, [f.active]: v.state.doc.toString() }
    delete others[path]
    states.current.delete(path)
    set.current = { ...f, active: path, others, version: f.version + 1 }
    // what tracking and the cursor read are about the file that was open
    before.current = null
    edits.current = []
    v.setState(next)
    forceLinting(v)
    setActive(path)
    setText(next.doc.toString())
    setCanUndo(undoDepth(next) > 0)
    return true
  }
  /** A place go to definition found in another file: that file, at the place. */
  const openAt = (at: Located) => {
    // the file shown already is a place in it all the same
    if (at.file != null && at.file !== set.current.active && !switchTo(at.file)) return
    const v = view.current
    if (!v) return
    const end = v.state.doc.length
    v.dispatch({ selection: { anchor: Math.min(at.from, end), head: Math.min(at.to, end) }, scrollIntoView: true })
    v.focus()
  }
  const openRef = useRef(openAt)
  openRef.current = openAt
  // the files each rename across several reached, the last few: for the note when one of them cannot follow an undo
  const renamed = useRef(new Map<number, Set<string>>())
  /** Changes to files that are not in the editor (a rename reaches every file of the model): each in its own state. */
  const changeElsewhere = (
    changes: readonly { file: string; from: number; to: number; insert: string }[],
    alone: boolean,
    id: number,
  ) => {
    const others = { ...set.current.others }
    const reached = new Set<string>(alone ? [] : [set.current.active])
    for (const file of new Set(changes.map((c) => c.file))) {
      if (!Object.hasOwn(others, file)) continue
      const mine = changes.filter((c) => c.file === file).map(({ from, to, insert }) => ({ from, to, insert }))
      // a file never opened gets its state now: the rename is then a step of its history, as in any other
      const kept = states.current.get(file) ?? EditorState.create({ doc: others[file]!, extensions: exts.current })
      // a step of its own, marked with the rename it is: an undo that crosses it anywhere finds it here
      const next = kept.update({
        changes: mine,
        effects: renameMark.of({ id, forward: true }),
        annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.rename')],
      }).state
      states.current.set(file, next)
      others[file] = next.doc.toString()
      reached.add(file)
    }
    renamed.current.set(id, reached)
    for (const old of [...renamed.current.keys()].slice(0, -50)) renamed.current.delete(old)
    set.current = { ...set.current, others, version: set.current.version + 1 }
    // with a change to the open text, the page hears of all the files once, after it: never half a rename
    if (alone) {
      latest.current.onFiles?.(filesNow())
      if (view.current) forceLinting(view.current)
    }
  }
  /**
   * An undo (`forward` false) or a redo in the open file crossed the rename `id`: the same in every other file whose
   * next step back, or forward, is that rename. A file where something else comes first was edited since: it keeps
   * what it has, and a note says so.
   */
  const followRename = (id: number, forward: boolean) => {
    const others = { ...set.current.others }
    const followed = new Set<string>([set.current.active])
    for (const [path, was] of states.current) {
      if (!Object.hasOwn(others, path)) continue
      let step: Transaction | undefined
      ;(forward ? redo : undo)({
        state: was,
        dispatch: (tr) => {
          step = tr
        },
      })
      // only where the step is this rename's own: anything else is that file's, and stays
      const crossed = (step as Transaction | undefined)?.effects.some(
        (e) => e.is(renameMark) && e.value.id === id && e.value.forward === forward,
      )
      if (!step || !crossed) continue
      const now = (step as Transaction).state
      states.current.set(path, now)
      others[path] = now.doc.toString()
      followed.add(path)
    }
    set.current = { ...set.current, others, version: set.current.version + 1 }
    const left = [...(renamed.current.get(id) ?? [])].filter((p) => !followed.has(p) && Object.hasOwn(others, p))
    if (left.length)
      setNote(`${left.map((p) => p.split('/').at(-1)).join(', ')} changed since the rename: it keeps its name`)
  }
  const followRef = useRef(followRename)
  followRef.current = followRename
  const elsewhereRef = useRef(changeElsewhere)
  elsewhereRef.current = changeElsewhere
  /** The files changed as a whole (one added, removed, all replaced): the tabs, the next compile, the page's draft. */
  const filesChanged = () => {
    const f = set.current
    setTabs([
      f.entry,
      ...Object.keys({ ...f.others, [f.active]: '' })
        .filter((p) => p !== f.entry)
        .sort(),
    ])
    setActive(f.active)
    setOpen((o) => o.filter((p) => p === f.active || p === f.entry || Object.hasOwn(f.others, p)))
    if (view.current) forceLinting(view.current)
    latest.current.onFiles?.(filesNow())
  }
  // what the explorer's operations reach of the editor (reshape.ts applies them, in the explorer's chunk)
  const fileHost: FileHost = {
    view,
    set,
    states,
    renamed,
    setOpen,
    setNote,
    state: (doc) => EditorState.create({ doc, extensions: exts.current }),
    // never a step of the history: an undo could bring a line back, not the file it names
    edit: (was, text) => ({ changes: between(was, text), annotations: Transaction.addToHistory.of(false) }),
    show: (next) => {
      // what tracking and the cursor read are about the file that was open
      before.current = null
      edits.current = []
      view.current?.setState(next)
      setText(next.doc.toString())
      setCanUndo(undoDepth(next) > 0)
    },
    changed: () => filesChanged(),
    open: (path) => switchTo(path),
  }
  /** A new file: the explorer opens and asks its name. */
  const addFile = (kind: NewKind) => {
    if (layout === 'reader') setLayout('code')
    setPane('text')
    setExplorer(true)
    setStartNew(kind)
  }
  /** A tab closed: the file stays one of the definition's, in the explorer. The model's tab stays. */
  const closeTab = (path: string) => {
    const f = set.current
    if (path === f.entry) return
    if (f.active === path) {
      const i = open.indexOf(path)
      switchTo(open[i + 1] ?? open[i - 1] ?? f.entry)
    }
    setOpen((o) => o.filter((p) => p !== path))
  }

  /** A whole new text, from its own defaults. One transaction: undo brings the old text back. */
  const replace = (source: string, files?: EditorFiles, quiet = false) => {
    const v = view.current
    if (!v) return
    // the reader's unkept edits first, then the new definition: each a version (the history keeps their order)
    if (!quiet) keepVersion('you', 'Edited')
    showDef(null)
    // one file, unless it comes with others: the tabs go with the definition they were of
    const entry = files?.path ?? ONE
    const others = Object.fromEntries(Object.entries(files?.files ?? {}).filter(([p]) => p !== entry))
    states.current.clear()
    renamed.current.clear()
    set.current = { entry, active: entry, others, version: set.current.version + 1 }
    setTabs([entry, ...Object.keys(others).sort()])
    setActive(entry)
    setOpen([entry])
    loaded.current = source
    shown.current = {}
    fresh.current = true
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: source },
      selection: { anchor: 0 },
      // its own undo step, never merged with the typing just before it
      annotations: isolateHistory.of('full'),
    })
    if (!quiet) keepVersion('opened', 'Opened')
  }
  const startFrom = async (t: Template | TemplateEntry) => {
    const text = view.current?.state.doc.toString()
    if (text != null && text !== loaded.current && !window.confirm(`Replace your text with “${t.title}”?`)) return
    // the editor's own starters bring their text when picked: a page that never starts from one does not load them
    let source: string | undefined
    try {
      source = 'source' in t ? t.source : (await import('./templates')).TEMPLATES.find((x) => x.id === t.id)?.source
    } catch {
      // offline, or a new version of the site took the old chunk away
    }
    if (source == null) {
      setNote(`“${t.title}” did not load`)
      return
    }
    replace(source)
    setNote(`New from “${t.title}”`)
  }
  const shareHash = async () => {
    const h = preview.current
    const changed: Record<string, ParamValue> = {}
    if (h && def) {
      const defaults = def.model.defaults() as Record<string, ParamValue>
      for (const [k, v] of Object.entries(h.values() as Record<string, ParamValue>))
        if (defaults[k] !== v) changed[k] = v
    }
    const all = filesNow()
    // one file makes the link every page out there reads; several go together
    return Object.keys(all.files).length > 1
      ? encodeShare(all.files[all.path]!, changed, all)
      : encodeShare(view.current?.state.doc.toString() ?? state.source, changed)
  }

  /**
   * One change from the inspector, in `file` (else the file in the editor): that file comes into the editor, and the
   * change is the smallest edit of its text, its own undo step there.
   */
  const inspectorEdit = (file: string | undefined, make: (source: string) => EditResult): string | null => {
    if (file && file !== set.current.active && !switchTo(file)) return `"${file}" is not a file of this definition`
    const v = view.current
    if (!v) return 'the editor is not ready'
    const r = make(v.state.doc.toString())
    if ('error' in r) return r.error
    if (r.changes.length)
      v.dispatch({
        changes: r.changes,
        annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.inspector')],
      })
    return null
  }
  const change = (key: string, value: EditValue, file?: string) =>
    inspectorEdit(file, (source) => edit(source, key, value, { functions, ...beside() }))
  /** A line the box takes from the box it is like, written into the box: its own from then on. One undo step. */
  const take = (box: string, name: string, file?: string) =>
    inspectorEdit(file, (source) => takeLine(source, box, name, { functions, ...beside() }, target?.path))
  /** An input of a copy written in its `with` as its default was: from then on this copy's own. */
  const write = (key: string, text: string, file?: string) =>
    inspectorEdit(file, (source) => writeInput(source, key, text, { functions, ...beside() }))
  /** What the catalog picker reads and writes through: the catalog, the figure for a pick, its text. */
  const catalogApi: CatalogApi = {
    components: () => loadCatalog().then((e) => Object.values(e[latestEdition(e)]!.components)),
    figure: published,
    condition: conditionText,
    number: fmt,
    source: () => view.current?.state.doc.toString() ?? '',
    options: () => ({ functions, ...beside() }),
  }
  /** A pick from the catalog: its text added (a published statement, a box or its capacity), the box selected. */
  const addFromCatalog = (r: Extract<AddResult, { box: string }>, note: string) => {
    view.current?.dispatch({
      changes: r.changes,
      annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.catalog')],
    })
    setSelected(r.box)
    setNote(note)
  }
  /**
   * Properties of the definition (`path` '') or of a tier written, changed or taken out (null), as one undo step;
   * nothing changes when one of them is refused.
   */
  const setOwn = (...steps: [path: string, name: string, value: string | boolean | null][]): string | null => {
    const v = view.current
    if (!v) return 'the editor is not ready'
    let source = v.state.doc.toString()
    const changes = []
    for (const [path, name, value] of steps) {
      const r = setProperty(source, path, name, value, { functions, ...beside() })
      if ('error' in r) return r.error
      source = r.source
      changes.push(r.changes)
    }
    v.dispatch(
      ...changes.map((c) => ({
        changes: c,
        sequential: true,
        annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.inspector')],
      })),
    )
    return null
  }
  const formatText = () => {
    const v = view.current
    if (!v) return false
    const doc = v.state.doc.toString()
    const r = format(doc)
    if (!r.ok) {
      setNote('Fix the syntax errors first')
      return false
    }
    if (r.text !== doc) {
      v.dispatch({
        changes: between(doc, r.text),
        annotations: [isolateHistory.of('full'), Transaction.userEvent.of('format')],
      })
    }
    setNote('Formatted')
    return true
  }
  formatRef.current = formatText
  /**
   * The keys a phone lacks: `open` and `close` around the selection (the cursor between them when there is none), and
   * the text keeps its focus, and so the keyboard.
   */
  const wrap = (open: string, close = '') => {
    const v = view.current
    if (!v) return
    const r = v.state.selection.main
    const inner = v.state.sliceDoc(r.from, r.to)
    v.dispatch({
      changes: { from: r.from, to: r.to, insert: open + inner + close },
      selection: r.empty
        ? { anchor: r.from + open.length }
        : { anchor: r.from, head: r.from + open.length + inner.length + close.length },
      scrollIntoView: true,
      annotations: Transaction.userEvent.of('input.type'),
    })
    v.focus()
  }
  /** In a snippet, its next field (a phone has no Tab key); else indents the selected lines, or types an indent. */
  const indent = () => {
    const v = view.current
    if (!v) return
    if (hasNextSnippetField(v.state)) {
      nextSnippetField(v)
      v.focus()
    } else if (v.state.selection.main.empty) wrap('  ')
    else {
      indentMore(v)
      v.focus()
    }
  }
  /** A key on the row over the keyboard: what it does, then the text's focus back. */
  const key = (f: () => unknown) => () => {
    f()
    view.current?.focus()
  }
  /** A click on a box: its lines in the text, or its fields in the inspector. */
  const clickNode = (id: string) => {
    setSelected(id)
    setTab('box')
    const v = view.current
    const all = everywhere.current
    const box = all.symbols.find((s) => s.kind === 'node' && s.id === id)
    // a box another file declares: that file comes into the editor, for its lines and for the inspector's fields
    if (box) switchTo(box.file ?? all.given)
    // in full screen, or on the diagram's tab, the text is out of sight: the keyboard must not go into it. A canvas
    // that fills the editor for good is no full screen
    const full = preview.current?.board()?.svg.closest('[data-full]:not([data-full="fill"])')
    if (textHidden || !v || !box || full) return
    const end = Math.min(box.decl.to, v.state.doc.length)
    v.dispatch({
      selection: { anchor: box.decl.from, head: end },
      effects: EditorView.scrollIntoView(box.decl.from, { y: 'start', yMargin: 24 }),
    })
    v.focus()
  }
  // the text was hidden: CodeMirror measures it again once it shows; the inspector starts from the text as it is
  useEffect(() => {
    if (!textHidden) view.current?.requestMeasure()
    else if (layout === 'reader' && view.current) setText(view.current.state.doc.toString())
  }, [textHidden, layout])

  const studioHost = useRef<StudioHost>(null!)
  studioHost.current = {
    fileHost,
    files: filesNow,
    show: showDef,
    changed: () => setStudioVersion((n) => n + 1),
    functions,
    replace: (f) => replace(f.files[f.path] ?? '', f, true),
  }
  const histKey = typeof keepHistory === 'object' ? keepHistory.key : undefined
  // biome-ignore lint/correctness/useExhaustiveDependencies: started once a page asks; the host is read through a ref
  useEffect(() => {
    if (!keepHistory) return
    let gone = false
    void import('./studio')
      .then((m) => new m.Studio(() => studioHost.current, histKey).open())
      .then((s) => {
        if (!gone) studio.current = s
      })
    return () => {
      gone = true
      studio.current = null
    }
  }, [!!keepHistory, histKey])

  useImperativeHandle(ref, () => ({
    source: () => view.current?.state.doc.toString() ?? state.source,
    setSource: (source) => replace(source),
    loadmap: () => preview.current,
    shareHash,
    format: formatText,
    files: filesNow,
    setFiles: (files) => replace(files.files[files.path] ?? '', files),
    history: () => studio.current?.history?.toData() ?? null,
  }))

  const shareLink = async () => {
    const hash = await shareHash()
    if (onShare) await onShare(hash)
    else {
      window.history.replaceState(null, '', `#${hash}`)
      try {
        await navigator.clipboard.writeText(location.href)
        setNote('Link copied')
      } catch {
        setNote('Link in the address bar')
      }
    }
  }
  const save = () => {
    const text = view.current?.state.doc.toString() ?? state.source
    // of several files, the one in the editor under its own name
    const own =
      tabs.length > 1
        ? active
            .split('/')
            .at(-1)!
            .replace(/\.loadmap$/, '')
        : undefined
    const name = own ?? fileName ?? slug(def?.model.title ?? '') ?? 'diagram'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    a.download = `${name || 'diagram'}.loadmap`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const goTo = (d: Diagnostic) => {
    // a problem in another file: that file first
    switchTo(d.file ?? state.given)
    const v = view.current
    if (!v) return
    v.dispatch({ selection: { anchor: Math.min(d.from, v.state.doc.length) }, scrollIntoView: true })
    v.focus()
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: `noted` restarts the time for the same note shown again
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNoteText(''), 2500)
    return () => clearTimeout(t)
  }, [note, noted])

  /**
   * The code panel's width in pixels: from 360 px to 60 % of the editor, as far as the canvas keeps `CODE.room` (below
   * about 720 px, its least wins).
   */
  const reader = layout === 'reader'
  const codeMost = Math.max(CODE.min, Math.min(CODE.max * width, width - CODE.room))
  const codePx = (share: number) =>
    Math.round(Math.max(CODE.min, Math.min(codeMost, Number.isFinite(share) ? share * width : CODE.start)))
  // the explorer's column is added to the code's panel, as far as the canvas keeps its room: the text keeps its width
  const filesPx = explorer && !reader ? Math.max(0, Math.min(FILES, Math.round(width - CODE.room - codePx(ratio)))) : 0
  const resizeCode = (all: number, done: boolean) => {
    const px = all - filesPx
    setRatio(px / width)
    if (done) onSplit?.(px / width)
  }

  const list = problems(state.result)
  const several = tabs.length > 1
  // the worst each file has, for its tab and its row in the explorer
  const marks = new Map<string, FileMark>()
  for (const d of list) {
    const p = d.file ?? state.given
    if (d.severity === 'error' || !marks.has(p)) marks.set(p, d.severity === 'error' ? 'error' : 'warning')
  }
  /** The explorer hidden; the keyboard, which may be in it, goes to its button on the tabs' row, or to the text. */
  const hideFiles = () => {
    setExplorer(false)
    requestAnimationFrame(() =>
      (root.current?.querySelector<HTMLElement>('.lme-ftoggle') ?? view.current?.contentDOM)?.focus(),
    )
  }
  const errors = list.filter((d) => d.severity === 'error').length
  const warnings = list.length - errors
  const stale = !state.result.ok && !!def
  // `inherit` follows the page's own switch, for the editor's frame and the diagram alike
  const look = usePageTheme(theme)
  // The selected box as the text writes it. One inside a subsystem has no statement under its id: `eu.api` is the
  // `api` of the subsystem `eu` is like, written once for every subsystem like it, perhaps in a library. Its place is
  // found where the compiler's offsets are true, in the text it read, and holds while the text changes
  const target = useMemo(() => {
    if (!reader || !selected) return null
    // each file as it is now, and as the last compile read it: its places are in those
    const now: Record<string, string> = { ...set.current.others, [active]: text }
    const read = { ...now, [state.file]: state.source }
    const node = (s: DslSymbol) => s.kind === 'node'
    const drawn = state.result.symbols.filter(node).map((s) => ({ ...s, file: s.file ?? state.given }))
    // a library in the editor has boxes the model does not draw: its own compile names them
    const own = symbols.current.filter(node).map((s) => ({ ...s, file: state.file }))
    const box = drawn.find((s) => s.id === selected) ?? own.find((s) => s.id === selected)
    // one the compile does not know yet (a pick from the catalog) is looked for at the top of the file in the editor
    if (!box) return { node: selected, file: active, text, shared: [], copy: null }
    const file = box.file
    const source = read[file]
    if (source == null) return null
    const path = boxPath(source, box.decl.from)
    const shared = drawn.filter((s) => s.id !== selected && s.file === file && s.decl.from === box.decl.from)
    // a box written once for several: what its copy alone sets
    const copy =
      shared.length && tab === 'box' ? inspectCopy(state.result, selected, { path: state.given, read, now }) : null
    return {
      node: selected,
      ...(path ? { path } : {}),
      file,
      text: now[file] ?? source,
      shared: shared.map((s) => s.id),
      copy,
    }
  }, [reader, selected, state, active, text, tab])
  const inspection = useMemo(() => {
    if (!reader) return null
    if (tab === 'model') return inspect(text, 'model')
    const i = target && inspect(target.text, target)
    // each section says its file: a change there goes to it
    return i && { ...i, sections: i.sections.map((s) => ({ ...s, file: target.file })) }
  }, [reader, text, tab, target])

  // a phone: the text or the diagram, one at a time; typing, the keyboard takes the bottom
  const phone = fill && narrow
  // a filling editor wide enough: the code's panel, and the diagram's canvas in the room beside it
  const canvas = fill && width > 0 && !narrow
  const typing = usePhoneTyping(phone, root)
  // below this the page's own controls in the bar take their short form
  const short = canvas && width < SHORT
  const status = (
    <output className="lme-status" data-ok={errors === 0}>
      {errors === 0 && warnings === 0
        ? 'No problems'
        : [count(errors, 'error'), count(warnings, 'warning')].filter(Boolean).join(' · ')}
    </output>
  )
  // beside the diagram it loads as the code hides, before the reader picks a box; in a canvas, with its panel
  const inspector = reader && (
    <Suspense fallback={null}>
      <Inspector
        inspection={inspection}
        tab={tab}
        onTab={(t) => {
          // the model's own lines are in its file
          if (t === 'model') switchTo(set.current.entry)
          setTab(t)
        }}
        onEdit={change}
        onTake={take}
        onWrite={write}
        copy={tab === 'box' ? target?.copy : null}
        box={target?.node}
        lanes={Object.entries(def?.view.def.tiers ?? {}).map(([id, t]) => ({ id, ...t }))}
        onLane={(id, key, value) =>
          key
            ? setOwn([`tier:${id}`, key, value])
            : setOwn([`tier:${id}`, 'fill', null], [`tier:${id}`, 'fillDark', null])
        }
        blocked={errors ? 'The text has errors: show the code to fix them.' : undefined}
        gone={tab === 'box' && !!target && !inspection}
        shared={tab === 'box' ? target?.shared : undefined}
        onClose={() => setSelected(null)}
      />
    </Suspense>
  )
  const staleNote = stale && <p className="lme-stale">Showing the last version without errors.</p>
  const title = def?.model.title ?? 'Untitled'
  const hasTemplates = templates == null || (templates !== false && templates.length > 0)
  const embedOn = !!embedLink && !!def
  useToolbar(tools, `${phone} ${canvas} ${reader} ${embedOn} ${hasTemplates || catalog || !!newItems?.length}`)
  /** The embed's options, under what asked for them, once the menu or the sheet that asked has closed. */
  const showEmbed = (anchor: Element | null | undefined) =>
    requestAnimationFrame(() => anchor && embed.current?.show(anchor))
  const toggleCode = () => {
    setLayout(reader ? 'code' : 'reader')
    // on a phone the text shows in its own pane
    if (reader) setPane('text')
  }
  const undoButton = reader && (
    <button
      type="button"
      className="lm-btn lme-quiet lme-icon"
      aria-label="Undo"
      title={`Undo (${MAC ? '⌘Z' : 'Ctrl+Z'})`}
      aria-disabled={!canUndo}
      onClick={() => canUndo && view.current && undo(view.current)}
    >
      <Icon d={ICON.undo} />
    </button>
  )
  const templateItems = (sheet?: boolean) => (
    <Suspense fallback={<span data-wait />}>
      <Starters templates={templates || undefined} sheet={sheet} onPick={startFrom} />
    </Suspense>
  )
  // the lanes' fills: a line of the text, written only when it differs from the default
  const filled = def?.view.def.lanes !== 'striped'
  // the canvas's grid is the reader's, kept in this browser; a definition from before 1.5 that says grid: false starts it
  const grid = gridChoice ?? def?.options.grid !== false
  const toggleGrid = () => {
    setGridChoice(!grid)
    keep(GRID_KEY, grid ? 'off' : 'on')
  }
  const pickFont = (font: CodeFont | undefined) => {
    pickedNow.current = true
    setFontName(font?.name ?? null)
    keep(FONT_KEY, font?.name ?? null)
  }
  const pickSize = (px: number) => {
    setFontSize(px)
    keep(SIZE_KEY, px === CODE_SIZE ? null : String(px))
  }
  const toggleLigatures = () => {
    setLigatures(!ligatures)
    keep(LIGATURES_KEY, ligatures ? 'off' : null)
  }
  // the code's font, its size and its ligatures: the reader's, whatever the text says
  const textItems = (sheet?: boolean) => (
    <>
      <MenuGroup label="Font">
        <MenuItem sheet={sheet} checked={!codeFont} onSelect={() => pickFont(undefined)}>
          System
        </MenuItem>
        {fonts.map((f) => (
          <MenuItem key={f.name} sheet={sheet} checked={codeFont === f} onSelect={() => pickFont(f)}>
            {f.name}
          </MenuItem>
        ))}
      </MenuGroup>
      <MenuGroup label="Text size, px">
        <div className="lme-sizes">
          {/* a phone draws the text at 16 px at least, so its keyboard does not zoom the page */}
          {CODE_SIZES.filter((px) => !phone || px >= PHONE_SIZE).map((px) => (
            // biome-ignore lint/a11y/useAriaPropsSupportedByRole: in a menu it is a menuitemradio, which has it
            <button
              key={px}
              type="button"
              className="lme-size"
              role={sheet ? undefined : 'menuitemradio'}
              aria-checked={px === (phone ? Math.max(fontSize, PHONE_SIZE) : fontSize)}
              aria-label={`${px} px`}
              tabIndex={sheet ? undefined : -1}
              onClick={() => pickSize(px)}
            >
              {px}
            </button>
          ))}
        </div>
      </MenuGroup>
      <MenuItem
        sheet={sheet}
        toggle
        checked={ligatures}
        hint="+- drawn as ±, -> as one arrow"
        onSelect={toggleLigatures}
      >
        Ligatures
      </MenuItem>
    </>
  )
  // while the text has errors, as the inspector, they change nothing: no line can be written then
  const lookItems = (sheet?: boolean) =>
    !errors && (
      <>
        <MenuItem
          sheet={sheet}
          toggle
          checked={filled}
          onSelect={() => setOwn(['', 'lanes', filled ? 'striped' : null])}
        >
          Lane fills
        </MenuItem>
        {canvas && (
          <MenuItem sheet={sheet} toggle checked={grid} onSelect={toggleGrid}>
            Dot grid
          </MenuItem>
        )}
      </>
    )
  // the box selected, for "Use for" in the catalog picker
  const node = selected
    ? (def?.view.def.nodes as Record<string, { label?: unknown }> | undefined)?.[selected]
    : undefined
  const picker = picking && (
    <Suspense fallback={null}>
      <CatalogPicker
        box={
          selected && node ? { id: selected, label: typeof node.label === 'string' ? node.label : selected } : undefined
        }
        api={catalogApi}
        onPick={addFromCatalog}
        onClose={() => setPicking(false)}
      />
    </Suspense>
  )
  const addGroup = (sheet?: boolean) => (
    <MenuGroup label="Add">
      {catalog && (
        <MenuItem sheet={sheet} onSelect={() => setPicking(true)}>
          From the catalog…
        </MenuItem>
      )}
      <MenuItem sheet={sheet} onSelect={() => addFile('part')}>
        A part of this model…
      </MenuItem>
      <MenuItem sheet={sheet} onSelect={() => addFile('library')}>
        A library…
      </MenuItem>
      <MenuItem sheet={sheet} onSelect={() => addFile('variant')}>
        A variant of this model…
      </MenuItem>
    </MenuGroup>
  )
  /** The files' explorer, shown beside the text or hidden. */
  const filesShown = explorer && !textHidden
  const toggleFiles = () => {
    // hidden with the text counts as hidden: asking for the files shows the text they sit beside
    if (!filesShown) {
      if (reader) setLayout('code')
      setPane('text')
    }
    setExplorer(!filesShown)
  }
  const filesItem = (sheet?: boolean) => (
    <MenuItem sheet={sheet} toggle checked={filesShown} onSelect={toggleFiles}>
      Files
    </MenuItem>
  )
  const shortcutsItem = (sheet?: boolean) => (
    <MenuItem sheet={sheet} onSelect={() => setShortcuts(true)}>
      Keyboard shortcuts…
    </MenuItem>
  )
  const shortcutsSheet = shortcuts && (
    <Suspense fallback={null}>
      <Shortcuts
        mac={MAC}
        save={saveSays(!!onSave, !!(onChange || onFiles)).sheet}
        onClose={() => {
          setShortcuts(false)
          // back to the text, where the keys work
          view.current?.focus()
        }}
      />
    </Suspense>
  )
  // the same groups in the phone's sheet and in a narrow column's menu
  const viewGroup = (sheet?: boolean) => (
    <MenuGroup label="View">
      <MenuItem sheet={sheet} onSelect={toggleCode}>
        {reader ? 'Show code' : 'Hide code'}
      </MenuItem>
      {!reader && (
        <MenuItem sheet={sheet} onSelect={formatText}>
          Format
        </MenuItem>
      )}
      {filesItem(sheet)}
      {lookItems(sheet)}
      {textItems(sheet)}
      {shortcutsItem(sheet)}
    </MenuGroup>
  )
  const exportGroups = (sheet?: boolean) => (
    <>
      <MenuGroup label="Export">
        <MenuItem sheet={sheet} onSelect={save}>
          Download .loadmap
        </MenuItem>
      </MenuGroup>
      {sections(exportItems, sheet)}
    </>
  )
  const share = (
    <>
      <span className="lme-share" ref={shareGroup}>
        <button
          type="button"
          className="lm-btn lme-primary"
          onClick={shareLink}
          title="Copy a link with the values set"
        >
          <Icon d={ICON.link} />
          Share
        </button>
        {embedOn && !phone && (
          <Menu label="More ways to share" icon={<Icon d={ICON.down} className="lme-chev" />} className="lme-primary">
            {() => (
              <>
                <MenuItem onSelect={shareLink}>Copy link</MenuItem>
                <MenuItem onSelect={() => showEmbed(shareGroup.current)}>Embed in a page…</MenuItem>
              </>
            )}
          </Menu>
        )}
      </span>
      {embedOn && (
        <Embed
          ref={embed}
          link={embedLink}
          hash={shareHash}
          title={def.model.title ?? 'loadmap'}
          story={def.model.story.length > 0}
          onNote={setNote}
        />
      )}
    </>
  )

  return (
    <div
      ref={root}
      className="lm lme"
      data-theme={look === 'auto' ? undefined : look}
      data-fill={fill || undefined}
      data-narrow={phone || undefined}
      data-short={short || undefined}
      data-canvas={canvas || undefined}
      data-typing={(phone && typing) || undefined}
      style={
        canvas
          ? ({
              '--lme-start': `${reader ? RAIL : codePx(ratio) + filesPx}px`,
              '--lme-rail': `${RAIL}px`,
            } as CSSProperties)
          : undefined
      }
    >
      <div className="lme-bar">
        {start}
        {fill && (
          <span className="lme-title" title={title}>
            {title}
          </span>
        )}
        {!fill && status}
        <span className="lme-note" aria-live="polite">
          {note}
        </span>
        <span className="lme-grow" />
        <div className="lme-tools" role="toolbar" aria-label="Editor" ref={tools}>
          {undoButton}
          {phone ? (
            <>
              {share}
              <button
                type="button"
                className="lm-btn lme-quiet lme-icon"
                aria-label="More"
                aria-haspopup="dialog"
                onClick={() => setSheet(true)}
              >
                <Icon d={ICON.more} />
              </button>
              {sheet && (
                <Suspense fallback={null}>
                  <Actions
                    onClose={() => setSheet(false)}
                    pages={[
                      ...(hasTemplates ? [{ label: 'From a template', items: () => templateItems(true) }] : []),
                      ...(newItems ?? []).map((s) => ({ label: s.label, items: () => barItems(s.items, true) })),
                    ]}
                  >
                    {addGroup(true)}
                    {viewGroup(true)}
                    {exportGroups(true)}
                    {embedOn && (
                      <MenuGroup label="Share">
                        <MenuItem sheet onSelect={() => showEmbed(tools.current?.parentElement)}>
                          Embed in a page…
                        </MenuItem>
                      </MenuGroup>
                    )}
                    {actions}
                  </Actions>
                </Suspense>
              )}
            </>
          ) : (
            <>
              {!canvas && (
                <button type="button" className="lm-btn lme-wide" aria-pressed={!reader} onClick={toggleCode}>
                  {reader ? 'Show code' : 'Hide code'}
                </button>
              )}
              {!reader && !canvas && (
                <button
                  type="button"
                  className="lm-btn lme-wide"
                  onClick={formatText}
                  title={MAC ? '⇧⌥F' : 'Shift+Alt+F'}
                >
                  Format
                </button>
              )}
              <Menu label="View" className="lme-wide">
                {() => (
                  <>
                    {filesItem()}
                    {lookItems()}
                    {textItems()}
                    {shortcutsItem()}
                  </>
                )}
              </Menu>
              {(hasTemplates || catalog || !!newItems?.length) && (
                <Menu label="New" className="lme-wide">
                  {() => (
                    <>
                      {hasTemplates && <MenuGroup label="Templates">{templateItems()}</MenuGroup>}
                      {addGroup()}
                      {sections(newItems)}
                    </>
                  )}
                </Menu>
              )}
              <Menu label="Export" className="lme-wide">
                {() => (
                  <>
                    <MenuItem onSelect={save}>Download .loadmap</MenuItem>
                    {sections(exportItems)}
                  </>
                )}
              </Menu>
              {!fill && (
                // a narrow column (below 560 px): the buttons above fold into one menu, so the bar keeps one row
                <Menu label="More" icon={<Icon d={ICON.more} />} className="lme-quiet lme-icon lme-fold">
                  {() => (
                    <>
                      {viewGroup()}
                      {hasTemplates && <MenuGroup label="Templates">{templateItems()}</MenuGroup>}
                      {addGroup()}
                      {sections(newItems)}
                      {exportGroups()}
                    </>
                  )}
                </Menu>
              )}
              {actions && (
                <>
                  <span className="lme-sep" />
                  {actions}
                </>
              )}
              {share}
            </>
          )}
        </div>
      </div>
      <div className="lme-split" data-layout={layout}>
        <div
          className={canvas ? 'lme-left lme-pane' : 'lme-left'}
          data-side={canvas ? 'start' : undefined}
          hidden={textHidden}
        >
          {canvas && (
            <PanelHead
              title="Code"
              note={status}
              fold="Hide code"
              onFold={() => {
                setLayout('reader')
                // the panel goes with the button: the keyboard goes to the rail that brings it back
                requestAnimationFrame(() =>
                  root.current?.querySelector<HTMLElement>('.lme-rail[data-side="start"]')?.focus(),
                )
              }}
            >
              <button
                type="button"
                className="lm-btn"
                aria-pressed={track}
                onClick={() => setTrack(!track)}
                title="Bring what each edit changes into view"
              >
                Track live changes
              </button>
              <button type="button" className="lm-btn" onClick={formatText} title={MAC ? '⇧⌥F' : 'Shift+Alt+F'}>
                Format
              </button>
            </PanelHead>
          )}
          <div className="lme-work" data-files={several || explorer || undefined}>
            {explorer && (
              <Suspense fallback={null}>
                <Explorer
                  dsl={DSL}
                  files={filesNow}
                  active={active}
                  open={open}
                  marks={marks}
                  start={startNew}
                  onStarted={() => setStartNew(null)}
                  onOpen={(p, at) => {
                    // the view takes the keyboard first: the box under the cursor is then picked on the board
                    if (at != null) openAt({ file: p, from: at, to: at })
                    else switchTo(p)
                    // on a phone the files are over the text: a pick shows it
                    if (phone) setExplorer(false)
                    view.current?.focus()
                  }}
                  host={fileHost}
                  onHide={hideFiles}
                />
              </Suspense>
            )}
            {(several || explorer) && (
              // the row's room is kept while they load: the text does not move
              <Suspense fallback={<div className="lme-ftabs" />}>
                <FileTabs
                  open={open}
                  all={tabs}
                  active={active}
                  entry={tabs[0]!}
                  marks={marks}
                  panel={panelId}
                  explorer={explorer}
                  onExplorer={() => (explorer ? hideFiles() : setExplorer(true))}
                  onPick={switchTo}
                  onClose={closeTab}
                />
              </Suspense>
            )}
            <div
              className="lme-code"
              id={panelId}
              role={several || explorer ? 'tabpanel' : undefined}
              ref={host}
              data-ligatures={ligatures ? undefined : 'off'}
              style={{ '--lme-code-font': fontStack(codeFont), '--lme-code-size': `${fontSize}px` } as CSSProperties}
            />
          </div>
          {list.length > 0 && (
            <ul className="lme-problems">
              {list.map((d) => (
                <li key={`${d.file ?? ''}:${d.from}:${d.message}`} data-severity={d.severity}>
                  <button type="button" onClick={() => goTo(d)}>
                    <span className="lme-at">
                      {several && `${(d.file ?? state.given).split('/').at(-1)}:`}
                      {d.line}:{d.column}
                    </span>{' '}
                    {d.message}
                    {d.hint && <small>{d.hint}</small>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {phone && typing && (
            // over the keyboard: what a phone's keyboard lacks, pressed without taking the text's focus (and so the keyboard)
            <div className="lme-keys" role="toolbar" aria-label="Keys" onPointerDown={(e) => e.preventDefault()}>
              <button
                type="button"
                className="lm-btn"
                onClick={key(() => view.current && startCompletion(view.current))}
              >
                Suggest
              </button>
              <button type="button" className="lm-btn" onClick={key(formatText)}>
                Format
              </button>
              <button
                type="button"
                className="lm-btn"
                aria-disabled={!canUndo}
                onClick={key(() => canUndo && view.current && undo(view.current))}
              >
                Undo
              </button>
              <button type="button" className="lm-btn" aria-label="Indent" onClick={indent}>
                ⇥
              </button>
              <button type="button" className="lm-btn" aria-label="Braces" onClick={() => wrap('{ ', ' }')}>
                {'{ }'}
              </button>
              <button type="button" className="lm-btn" aria-label="Quotes" onClick={() => wrap('"', '"')}>
                "
              </button>
              <button
                type="button"
                className="lm-btn"
                onClick={() => view.current && startRename(view.current, aroundRef.current)}
              >
                Rename
              </button>
              <button type="button" className="lm-btn" onClick={key(() => view.current && openSearch(view.current))}>
                Find
              </button>
              <span className="lme-grow" />
              <button type="button" className="lm-btn" onClick={() => view.current?.contentDOM.blur()}>
                Done
              </button>
            </div>
          )}
          {canvas && (
            <Resize
              label="Resize the code"
              value={codePx(ratio) + filesPx}
              min={CODE.min + filesPx}
              max={Math.round(codeMost) + filesPx}
              onChange={resizeCode}
              onReset={() => resizeCode(codePx(split ?? Number.NaN) + filesPx, true)}
            />
          )}
        </div>
        {fill && !width ? (
          // nothing drawn before the editor knows its width, and so which layout it takes
          <div className="lme-preview" />
        ) : canvas || phone ? (
          <div
            className="lme-preview"
            data-stale={stale || undefined}
            data-grid={grid ? undefined : 'off'}
            hidden={phone && !reader && pane === 'text'}
          >
            {def ? (
              // the canvas every loadmap is, filling the room: the editor's own bar has the title, and the editor
              // shows every panel whatever the definition picks for a page
              <Loadmap
                key={shownVersion ? `v${shownVersion.id}` : state.doc}
                ref={preview}
                model={(shownVersion?.def ?? def).model}
                view={(shownVersion?.def ?? def).view}
                theme={look}
                {...pageOptions((shownVersion?.def ?? def).options)}
                panels={undefined}
                chrome="all"
                fill
                zoom
                title={false}
                initial={sharedValues(def.model, shown.current)}
                onNodeClick={clickNode}
                selected={selected}
              >
                {reader && (
                  <Canvas.Panel id={INSPECT} title="Inspect">
                    {inspector}
                  </Canvas.Panel>
                )}
                {reader && <InspectOnClick selected={selected} />}
                {studio.current?.panels({ history: !!keepHistory, shown: shownVersion?.id ?? null })}
                {shownVersion ? (
                  <p className="lme-stale">
                    Showing an older version.{' '}
                    <button type="button" className="lm-btn lme-quiet" onClick={() => showDef(null)}>
                      Back to now
                    </button>
                  </p>
                ) : (
                  staleNote
                )}
              </Loadmap>
            ) : (
              <p className="lme-empty">Fix the errors in the text to see the diagram.</p>
            )}
          </div>
        ) : (
          <div className="lme-preview" data-stale={stale || undefined}>
            {staleNote}
            {def ? (
              <Loadmap
                key={state.doc}
                ref={preview}
                model={def.model}
                view={def.view}
                theme={look}
                {...pageOptions(def.options)}
                zoom
                initial={sharedValues(def.model, shown.current)}
                onNodeClick={clickNode}
                selected={selected}
              />
            ) : (
              <p className="lme-empty">Fix the errors in the text to see the diagram.</p>
            )}
          </div>
        )}
        {canvas && reader && (
          <Rail
            tier={errors ? 'over' : warnings ? 'warn' : 'ok'}
            label={errors || warnings ? `${count(errors, 'error') || count(warnings, 'warning')} · Code` : 'Code'}
            aria-label={
              errors || warnings ? `Show code (${count(errors, 'error') || count(warnings, 'warning')})` : 'Show code'
            }
            title="Show the code"
            onClick={() => {
              setLayout('code')
              // the rail goes: the keyboard goes into the text it brought back
              requestAnimationFrame(() => view.current?.focus())
            }}
          />
        )}
        {!fill && inspector}
      </div>
      {phone && (
        // in thumb reach: the text or the diagram
        <div className="lme-switch" role="tablist" aria-label="Show">
          {(['diagram', 'text'] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={(reader ? 'diagram' : pane) === p}
              data-problems={(p === 'text' && list.length) || undefined}
              data-warn={(p === 'text' && !errors) || undefined}
              onClick={() => {
                if (p === 'text' && reader) setLayout('code')
                setPane(p)
              }}
            >
              {p === 'text' ? 'Code' : 'Diagram'}
            </button>
          ))}
        </div>
      )}
      {picker}
      {shortcutsSheet}
    </div>
  )
}

/**
 * What says a definition in several files is the same model: every file's tokens under its path, whichever file is in
 * the editor. Another file opened (a click on a box it declares) is the same model, and the diagram stays as it is
 * drawn.
 */
function modelKey(prints: readonly (readonly [path: string, print: string])[]): string {
  return [...prints]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, print]) => `${path}\n${print}`)
    .join('\n')
}

/** The inspector's panel among the canvas's, by its id: the first of the tabs while the code is hidden. */
const INSPECT = 'inspect'

/**
 * In the canvas: a box clicked while the code is hidden opens its fields. Once for each box, so a panel the reader
 * closes stays closed.
 */
function InspectOnClick({ selected }: { selected: string | null }) {
  const { show } = useCanvasPanels()
  useEffect(() => {
    if (selected) show(INSPECT)
  }, [selected, show])
  return null
}

/** The one change from `a` to `b`: only the part that differs, so the cursor stays where it was. */
export function between(a: string, b: string): { from: number; to: number; insert: string } {
  let from = 0
  while (from < a.length && from < b.length && a[from] === b[from]) from++
  // the common end may not reach back into the common start of the shorter text
  let tail = 0
  const room = Math.min(a.length, b.length) - from
  while (tail < room && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  return { from, to: a.length - tail, insert: b.slice(from, b.length - tail) }
}

/**
 * The code panel: its width to start and its least, in pixels; its most as a share of the editor's; and the room the
 * canvas always keeps beside it.
 */
const CODE = { start: 440, min: 360, max: 0.6, room: 320 } as const
/** What the explorer's file operations read of the language: handed over, so its chunk imports none of it. */
const DSL: Dsl = { imports, resolvePath, relativePath, parse, MAX_FILES, LANGUAGE_VERSION }
/** The width of the files' explorer, in pixels (its rule is in Explorer.tsx). */
const FILES = 220
/** Below this width the canvas's bar is short: a page's controls in it take their short form. */
const SHORT = 1000
/** Below this width, or this height, a filling editor shows one pane at a time. */
const NARROW = 720
const SHORT_HEIGHT = 500
/** The widest a phone on its side is. */
const SIDEWAYS = 1000

/**
 * The reader types on a phone: the text has the focus and the pointer is a finger, so the screen's keyboard is up. The
 * editor then takes the height the keyboard leaves (Safari keeps the page's height and slides it under the keyboard).
 */
function usePhoneTyping(phone: boolean, root: RefObject<HTMLDivElement | null>): boolean {
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    const el = root.current
    if (!phone || !el) return
    const coarse = matchMedia('(pointer: coarse)')
    const inText = () => coarse.matches && !!document.activeElement?.closest('.lme-code')
    const vv = window.visualViewport
    // Safari also pans what shows down the page to keep the caret in view: the editor follows it
    const fit = () => {
      if (vv && inText()) {
        el.style.setProperty('--lme-vv', `${vv.height}px`)
        el.style.setProperty('--lme-vt', `${vv.offsetTop}px`)
      } else {
        el.style.removeProperty('--lme-vv')
        el.style.removeProperty('--lme-vt')
      }
    }
    // a tap on the row of keys can take the focus from the text for a moment: the row stays until the key has acted
    // and given it back
    let later = 0
    const focus = () => {
      clearTimeout(later)
      if (inText()) {
        setTyping(true)
        fit()
      } else
        later = window.setTimeout(() => {
          setTyping(inText())
          fit()
        }, 300)
    }
    el.addEventListener('focusin', focus)
    el.addEventListener('focusout', focus)
    vv?.addEventListener('resize', fit)
    vv?.addEventListener('scroll', fit)
    return () => {
      clearTimeout(later)
      el.removeEventListener('focusin', focus)
      el.removeEventListener('focusout', focus)
      vv?.removeEventListener('resize', fit)
      vv?.removeEventListener('scroll', fit)
      el.style.removeProperty('--lme-vv')
      el.style.removeProperty('--lme-vt')
      setTyping(false)
    }
  }, [phone, root])
  return typing
}

/** Milliseconds the text rests before tracking shows what an edit changed, and the boxes stay marked. */
const REST = 500
const MARK = 1600
const MAC = typeof navigator !== 'undefined' && /Mac|iP/.test(navigator.platform)
const Starters = later(() => import('./Starters'), 'The templates did not load: reload the page.')
const Shortcuts = later(() => import('./Shortcuts'), 'The list of keys did not load: reload the page.')
const Actions = later(() => import('./Actions'))
const CatalogPicker = later(() => import('./CatalogPicker'), 'The catalog did not load: reload the page.')
const FileTabs = later<FileTabsProps>(() => import('./FileTabs'))
const Explorer = later<ExplorerProps>(() => import('./Explorer'), 'The files did not load: reload the page.')
const Inspector = later<InspectorProps>(
  () => import('./Inspector').then((m) => ({ default: m.Inspector })),
  'The inspector did not load: reload the page.',
)
const count = (n: number, word: string) => (n ? `${n} ${word}${n > 1 ? 's' : ''}` : '')
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || undefined
