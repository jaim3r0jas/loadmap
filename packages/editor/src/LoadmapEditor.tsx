import { hasNextSnippetField, nextSnippetField } from '@codemirror/autocomplete'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentMore,
  indentWithTab,
  isolateHistory,
  undo,
  undoDepth,
} from '@codemirror/commands'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { EditorState, Transaction } from '@codemirror/state'
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import type { ParamValue } from '@loadmap/core'
import {
  type CompileResult,
  compile,
  type Definition,
  type Diagnostic,
  type DslSymbol,
  encodeShare,
  format,
  type HostFunctions,
  problems,
  sharedValues,
} from '@loadmap/dsl'
import { type EditValue, edit, fingerprint, inspect, pageOptions } from '@loadmap/dsl/internal'
import { Loadmap, type LoadmapHandle, type Theme, usePageTheme } from '@loadmap/react'
import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
  Suspense,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { EditorCanvas, PANEL, type PanelMode } from './Canvas'
import type { TemplateEntry } from './catalog'
import { Embed, type EmbedHandle, type EmbedOptions } from './Embed'
import type { InspectorProps, InspectorTab } from './Inspector'
import { loadmapLanguage } from './language'
import { type BarSection, barItems, ICON, Icon, later, Menu, MenuGroup, MenuItem, sections, useToolbar } from './Menu'
import { PanelHead, RAIL, Rail, Resize } from './Panel'
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
   * The editor fills its container, which gives it a height, as a canvas: the bar, then the code in a panel on the
   * left, the diagram the reader pans and zooms in the room between, and the verdict and the rest in a panel on the
   * right. Each panel resizes by its inner edge and folds onto a rail. The bar shows the model's title. On a phone
   * (below 720 px wide, or a phone on its side) the text or the diagram, switched at the bottom, the panels in a sheet
   * over the diagram, and the actions other than Share in a sheet of their own. The root carries `data-narrow` on a
   * phone and `data-short` below 1000 px, for a page's own controls to follow.
   */
  fill?: boolean
  /** With `fill`: the code panel's share of the width (360 px to 60 % of it), and where a double-click on its edge puts it back. Default: 440 px. */
  split?: number
  /** With `fill`: the code panel was resized, to this share; a page can keep it. */
  onSplit?: (share: number) => void
  /** With `fill`: the side panel pinned beside the canvas, or on `auto`, folded onto its rail. Default: pinned from 1280 px wide. */
  panel?: PanelMode
  /** With `fill`: the reader pinned or folded the side panel; a page can keep it. */
  onPanel?: (mode: PanelMode) => void
  /** With `fill`: the side panel's width in pixels (300 to 480). Default: 340. */
  panelWidth?: number
  /** With `fill`: the side panel was resized, to this width; a page can keep it. */
  onPanelWidth?: (px: number) => void
  /** The reader showed or hid the code; a page can keep it. */
  onLayout?: (layout: EditorLayout) => void
  /**
   * The starters in the New menu; false leaves them out. Default: the ten that come with the editor (`TEMPLATES`),
   * the list loaded when the menu first opens, each one's text when the reader picks it.
   */
  templates?: readonly Template[] | false
  /** The name the downloaded file takes, without ".loadmap". Default: the title. */
  fileName?: string
  /**
   * How it opens. `reader` shows the diagram with an inspector beside it: a click on a box shows its label, its
   * capacity and its parameters to change, each change a small edit of the text. "Show code" switches. Default `code`,
   * where a click on a box selects its lines in the text.
   */
  layout?: EditorLayout
  ref?: Ref<LoadmapEditorHandle>
}

interface Compiled {
  source: string
  result: CompileResult
  /** The last version that compiled; it stays on screen while the text has errors. */
  good: Definition | null
  /** Its tokens: an edit that leaves them alone (a comment, spacing) keeps the same model and view. */
  goodKey: string
}

/** A text editor for a `.loadmap` definition next to its live diagram. */
export function LoadmapEditor({
  initial,
  values,
  functions,
  theme,
  onChange,
  onShare,
  embedLink,
  newItems,
  exportItems,
  actions,
  start,
  fill = false,
  split,
  onSplit,
  panel: initialPanel,
  onPanel,
  panelWidth,
  onPanelWidth,
  onLayout,
  fileName,
  templates,
  layout: initialLayout = 'code',
  ref,
}: LoadmapEditorProps) {
  useEffect(() => injectEditorStyles(), [])
  const [state, setState] = useState<Compiled>(() => {
    const result = compile(initial, { functions })
    return { source: initial, result, good: result.definition ?? null, goodKey: fingerprint(initial) }
  })
  const [note, setNote] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const preview = useRef<LoadmapHandle>(null)
  // the values the preview shows, carried across versions so an edit does not reset the sliders
  const shown = useRef<Readonly<Record<string, unknown>>>(values ?? {})
  // setSource starts the new text from its own defaults: the next compile must not carry the old values over
  const fresh = useRef(false)
  // the text last loaded whole (the initial one or a template): replacing anything else asks first
  const loaded = useRef(initial)
  const latest = useRef({ onChange, functions })
  latest.current = { onChange, functions }
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
  const [panelState, setPanelState] = useState<PanelMode | undefined>(initialPanel)
  // a wide window pins the panel unless the reader said otherwise
  // pinned only where it leaves the diagram room; a choice made on a wide screen waits for one
  const canPin = width >= PANEL.pinFrom
  const panel = !canPin ? 'auto' : (panelState ?? (width >= PIN_FROM ? 'pinned' : 'auto'))
  const setPanel = (m: PanelMode) => {
    setPanelState(m)
    onPanel?.(m)
  }
  // the side panel's width as the page gave it, and as the reader set it
  const panelStart = Number.isFinite(panelWidth) ? panelWidth! : PANEL.width
  const [panelPx, setPanelPx] = useState(panelStart)
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
  const symbols = useRef<DslSymbol[]>(state.result.symbols)
  symbols.current = state.result.symbols
  const formatRef = useRef<() => boolean>(() => false)
  const tools = useRef<HTMLDivElement>(null)
  // the phone's sheet of actions, drawn while it is open
  const [sheet, setSheet] = useState(false)
  const shareGroup = useRef<HTMLSpanElement>(null)
  const embed = useRef<EmbedHandle>(null)

  const accept = (source: string, result: CompileResult) => {
    const h = preview.current
    if (fresh.current) fresh.current = false
    else if (h) shown.current = h.values()
    setState((prev) => {
      if (prev.source === source && prev.result === result) return prev
      if (!result.definition) return { ...prev, source, result }
      const key = fingerprint(source)
      if (key === prev.goodKey && prev.good) return { ...prev, source, result }
      return { source, result, good: result.definition, goodKey: key }
    })
  }
  const acceptRef = useRef(accept)
  acceptRef.current = accept

  // biome-ignore lint/correctness/useExhaustiveDependencies: created once; a new text comes in through setSource
  useEffect(() => {
    if (!host.current) return
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
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
          EditorState.tabSize.of(2),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'loadmap definition' }),
          loadmapLanguage({
            functions: latest.current.functions,
            onResult: (source, result) => acceptRef.current(source, result),
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              const doc = u.state.doc.toString()
              // only the inspector reads it: typing in the code layout re-renders nothing
              if (shownLayout.current === 'reader') setText(doc)
              latest.current.onChange?.(doc)
            }
            setCanUndo(undoDepth(u.state) > 0)
            // the cursor in a box's lines selects the box
            if (u.selectionSet && u.view.hasFocus) {
              const at = u.state.selection.main.head
              const box = symbols.current.find((s) => s.kind === 'node' && s.decl.from <= at && at <= s.decl.to)
              if (box) setSelected(box.id)
            }
          }),
        ],
      }),
    })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
  }, [])

  const def = state.good

  /** A whole new text, from its own defaults. One transaction: undo brings the old text back. */
  const replace = (source: string) => {
    const v = view.current
    if (!v) return
    loaded.current = source
    shown.current = {}
    fresh.current = true
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: source },
      selection: { anchor: 0 },
      // its own undo step, never merged with the typing just before it
      annotations: isolateHistory.of('full'),
    })
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
    return encodeShare(view.current?.state.doc.toString() ?? state.source, changed)
  }

  /** One change from the inspector: the smallest edit of the text, its own undo step. */
  const change = (key: string, value: EditValue): string | null => {
    const v = view.current
    if (!v) return 'the editor is not ready'
    const r = edit(v.state.doc.toString(), key, value, { functions })
    if ('error' in r) return r.error
    if (r.changes.length)
      v.dispatch({
        changes: r.changes,
        annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.inspector')],
      })
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
      v.dispatch({ changes: between(doc, r.text), annotations: isolateHistory.of('full') })
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
    const box = symbols.current.find((s) => s.kind === 'node' && s.id === id)
    // in full screen, or on the diagram's tab, the text is out of sight: the keyboard must not go into it
    const full = preview.current?.board()?.svg.closest('[data-full]')
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

  useImperativeHandle(ref, () => ({
    source: () => view.current?.state.doc.toString() ?? state.source,
    setSource: replace,
    loadmap: () => preview.current,
    shareHash,
    format: formatText,
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
    const name = fileName ?? slug(def?.model.title ?? '') ?? 'diagram'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    a.download = `${name || 'diagram'}.loadmap`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const goTo = (d: Diagnostic) => {
    const v = view.current
    if (!v) return
    v.dispatch({ selection: { anchor: Math.min(d.from, v.state.doc.length) }, scrollIntoView: true })
    v.focus()
  }

  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(''), 2500)
    return () => clearTimeout(t)
  }, [note])

  /**
   * The panels' widths in pixels. A pinned side panel takes no more than leaves the canvas `CODE.room` beside the code
   * at its least; the code then takes from 360 px to 60 % of the editor, as far as the canvas keeps `CODE.room` (below
   * about 720 px, its least wins). Over the canvas, the side panel takes its own width.
   */
  const reader = layout === 'reader'
  const panelMost = Math.round(
    panel === 'pinned'
      ? Math.max(PANEL.min, Math.min(PANEL.max, width - (reader ? RAIL : CODE.min) - CODE.room))
      : PANEL.max,
  )
  const panelAt = Math.round(Math.max(PANEL.min, Math.min(panelMost, panelPx)))
  const right = panel === 'pinned' ? panelAt : RAIL
  const codeMost = Math.max(CODE.min, Math.min(CODE.max * width, width - right - CODE.room))
  const codePx = (share: number) =>
    Math.round(Math.max(CODE.min, Math.min(codeMost, Number.isFinite(share) ? share * width : CODE.start)))
  const resizeCode = (px: number, done: boolean) => {
    setRatio(px / width)
    if (done) onSplit?.(px / width)
  }
  const resizePanel = (px: number, done: boolean) => {
    setPanelPx(px)
    if (done) onPanelWidth?.(px)
  }

  const list = problems(state.result)
  const errors = list.filter((d) => d.severity === 'error').length
  const warnings = list.length - errors
  const stale = !state.result.ok && !!def
  // `inherit` follows the page's own switch, for the editor's frame and the diagram alike
  const look = usePageTheme(theme)
  const inspection = useMemo(
    () =>
      !reader ? null : tab === 'model' ? inspect(text, 'model') : selected ? inspect(text, { node: selected }) : null,
    [reader, text, tab, selected],
  )

  // a phone: the text or the diagram, one at a time, the panels in a sheet; typing, the keyboard takes the bottom
  const phone = fill && narrow
  // a filling editor wide enough: the diagram is a canvas, the code's panel and the side panel on either side
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
  // it loads as the code hides, before the reader picks a box
  const inspector = reader && (
    <Suspense fallback={null}>
      <Inspector
        inspection={inspection}
        tab={tab}
        onTab={setTab}
        onEdit={change}
        blocked={errors ? 'The text has errors: show the code to fix them.' : undefined}
        gone={tab === 'box' && !!selected && !inspection}
        onClose={() => setSelected(null)}
      />
    </Suspense>
  )
  const staleNote = stale && <p className="lme-stale">Showing the last version without errors.</p>
  const title = def?.model.title ?? 'Untitled'
  const hasTemplates = templates == null || (templates !== false && templates.length > 0)
  const embedOn = !!embedLink && !!def
  useToolbar(tools, `${phone} ${canvas} ${reader} ${embedOn} ${hasTemplates || !!newItems?.length}`)
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
              '--lme-start': `${reader ? RAIL : codePx(ratio)}px`,
              '--lme-panel': `${panelAt}px`,
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
                <button type="button" className="lm-btn lme-wide" onClick={formatText} title="Shift+Alt+F">
                  Format
                </button>
              )}
              {(hasTemplates || !!newItems?.length) && (
                <Menu label="New" className="lme-wide">
                  {() => (
                    <>
                      {hasTemplates && <MenuGroup label="Templates">{templateItems()}</MenuGroup>}
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
              side="start"
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
              <button type="button" className="lm-btn" onClick={formatText} title="Shift+Alt+F">
                Format
              </button>
            </PanelHead>
          )}
          <div className="lme-code" ref={host} />
          {list.length > 0 && (
            <ul className="lme-problems">
              {list.map((d) => (
                <li key={`${d.from}:${d.message}`} data-severity={d.severity}>
                  <button type="button" onClick={() => goTo(d)}>
                    <span className="lme-at">
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
              <span className="lme-grow" />
              <button type="button" className="lm-btn" onClick={() => view.current?.contentDOM.blur()}>
                Done
              </button>
            </div>
          )}
          {canvas && (
            <Resize
              side="start"
              label="Resize the code"
              value={codePx(ratio)}
              min={CODE.min}
              max={Math.round(codeMost)}
              onChange={resizeCode}
              onReset={() => resizeCode(codePx(split ?? Number.NaN), true)}
            />
          )}
        </div>
        {fill && !width ? (
          // nothing drawn before the editor knows its width, and so which layout it takes
          <div className="lme-preview" />
        ) : canvas || phone ? (
          <div className="lme-preview" data-stale={stale || undefined} hidden={phone && !reader && pane === 'text'}>
            {def ? (
              <EditorCanvas
                ref={preview}
                def={def}
                look={look}
                initial={sharedValues(def.model, shown.current)}
                onNodeClick={clickNode}
                selected={selected}
                phone={phone}
                panel={panel}
                onPanel={setPanel}
                canPin={canPin}
                width={panelAt}
                resize={
                  <Resize
                    side="end"
                    label="Resize the panel"
                    value={panelAt}
                    min={PANEL.min}
                    max={panelMost}
                    onChange={resizePanel}
                    onReset={() => resizePanel(panelStart, true)}
                  />
                }
                inspector={inspector}
                note={staleNote}
              />
            ) : (
              <p className="lme-empty">Fix the errors in the text to see the diagram.</p>
            )}
          </div>
        ) : (
          <div className="lme-preview" data-stale={stale || undefined}>
            {staleNote}
            {def ? (
              <Loadmap
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
            side="start"
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
    </div>
  )
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
 * canvas always keeps between the panels.
 */
const CODE = { start: 440, min: 360, max: 0.6, room: 320 } as const
/** Below this width the canvas's bar is short: a page's controls in it take their short form. */
const SHORT = 1000
/** From this width the side panel starts pinned. */
const PIN_FROM = 1280
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

const MAC = typeof navigator !== 'undefined' && /Mac|iP/.test(navigator.platform)
const Starters = later(() => import('./Starters'), 'The templates did not load: reload the page.')
const Actions = later(() => import('./Actions'))
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
