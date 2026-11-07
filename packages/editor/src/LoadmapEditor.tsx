import {
  defaultKeymap,
  history,
  historyKeymap,
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
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Embed, type EmbedOptions } from './Embed'
import { Inspector, type InspectorTab } from './Inspector'
import { loadmapLanguage } from './language'
import { injectEditorStyles } from './styles'
import { TEMPLATES, type Template } from './templates'

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
   * "Copy embed link" sits beside "Share link": the link, or an `<iframe>` with it, for ClickUp's /embed or any page.
   */
  embedLink?: (hash: string, o: EmbedOptions) => string
  /** More buttons for the bar: export, record. */
  actions?: ReactNode
  /** Controls at the start of the bar, before the status: a way back, a name, a menu of examples. */
  start?: ReactNode
  /**
   * The editor fills its container, which gives it a height: the bar, then the text and the diagram side by side with
   * a divider to drag between them, each scrolling on its own. Below 720 px wide, tabs switch between the text and the
   * diagram, and the buttons other than Share fold into a menu; the root then carries `data-narrow`, for a page's own
   * controls in `start` to follow.
   */
  fill?: boolean
  /** With `fill`: where the divider starts, and where a double-click puts it back: the text's share of the width, from 0.2 to 0.8. Default 0.4. */
  split?: number
  /** With `fill`: the divider was moved, to this share; a page can keep it. */
  onSplit?: (share: number) => void
  /** The starters in the "New from template" menu; false hides it. Default: the six that come with the editor. */
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
  actions,
  start,
  fill = false,
  split = SPLIT,
  onSplit,
  fileName,
  templates = TEMPLATES,
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
  const [layout, setLayout] = useState<EditorLayout>(initialLayout)
  // the update listener is made once: it reads the layout through this
  const shownLayout = useRef(layout)
  shownLayout.current = layout
  const root = useRef<HTMLDivElement>(null)
  // with fill: the text's part of the width, and below 720 px one pane at a time
  const [ratio, setRatio] = useState(() => clampShare(split))
  const [narrow, setNarrow] = useState(false)
  const [pane, setPane] = useState<'text' | 'diagram'>('text')
  useLayoutEffect(() => {
    const el = root.current
    if (!fill || !el) return
    const measure = (width: number) => setNarrow(width < NARROW)
    measure(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(([e]) => e && measure(e.contentRect.width))
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
  const startFrom = (t: Template) => {
    const text = view.current?.state.doc.toString()
    if (text != null && text !== loaded.current && !window.confirm(`Replace your text with “${t.title}”?`)) return
    replace(t.source)
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

  const share = async () => {
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

  /** The divider: dragged, or moved with the arrow keys; double-click puts it back. */
  const moveTo = (to: number) => {
    const next = clampShare(to)
    setRatio(next)
    onSplit?.(next)
  }
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const bar = e.currentTarget
    const box = bar.parentElement!.getBoundingClientRect()
    bar.setPointerCapture(e.pointerId)
    root.current?.setAttribute('data-dragging', '')
    let last = ratio
    const move = (ev: globalThis.PointerEvent) => {
      last = clampShare((ev.clientX - box.left) / box.width)
      setRatio(last)
    }
    const up = () => {
      bar.removeEventListener('pointermove', move)
      bar.removeEventListener('pointerup', up)
      bar.removeEventListener('pointercancel', up)
      root.current?.removeAttribute('data-dragging')
      // a click that moved nothing (the focus, a double-click) is no move
      if (last !== ratio) onSplit?.(last)
    }
    bar.addEventListener('pointermove', move)
    bar.addEventListener('pointerup', up)
    bar.addEventListener('pointercancel', up)
  }
  const nudge = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.02
    const to =
      e.key === 'ArrowLeft'
        ? ratio - step
        : e.key === 'ArrowRight'
          ? ratio + step
          : e.key === 'Home'
            ? MIN_SHARE
            : e.key === 'End'
              ? MAX_SHARE
              : null
    if (to == null) return
    e.preventDefault()
    moveTo(to)
  }

  const list = problems(state.result)
  const errors = list.filter((d) => d.severity === 'error').length
  const warnings = list.length - errors
  const stale = !state.result.ok && !!def
  const reader = layout === 'reader'
  // `inherit` follows the page's own switch, for the editor's frame and the diagram alike
  const look = usePageTheme(theme)
  const inspection = useMemo(
    () =>
      !reader ? null : tab === 'model' ? inspect(text, 'model') : selected ? inspect(text, { node: selected }) : null,
    [reader, text, tab, selected],
  )

  const compact = fill && narrow
  const shareButton = (
    <button type="button" className="lm-btn" onClick={share}>
      {compact ? 'Share' : 'Share link'}
    </button>
  )
  // beside Share, in either bar: a menu of its own, which the narrow bar's menu would close on every pick
  const embedMenu = embedLink && def && (
    <Embed
      link={embedLink}
      hash={shareHash}
      title={def.model.title ?? 'loadmap'}
      story={def.model.story.length > 0}
      short={compact}
      onNote={setNote}
    />
  )
  // the buttons before Share, and after it; on a narrow fill they fold into the menu
  const lead = (
    <>
      <button
        type="button"
        className="lm-btn"
        aria-pressed={!reader}
        onClick={() => setLayout(reader ? 'code' : 'reader')}
      >
        {reader ? 'Show code' : 'Hide code'}
      </button>
      {!reader && (
        <button type="button" className="lm-btn" onClick={formatText} title="Shift+Alt+F">
          Format
        </button>
      )}
      {!reader && templates && templates.length > 0 && (
        <select
          className="lm-btn"
          aria-label="New from template"
          value=""
          onChange={(e) => {
            const t = templates.find((x) => x.id === e.target.value)
            if (t) startFrom(t)
          }}
        >
          <option value="">New from template…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id} title={t.summary}>
              {t.title}
            </option>
          ))}
        </select>
      )}
    </>
  )
  const tail = (
    <>
      <button type="button" className="lm-btn" onClick={save}>
        Download .loadmap
      </button>
      {actions}
    </>
  )

  return (
    <div
      ref={root}
      className="lm lme"
      data-theme={look === 'auto' ? undefined : look}
      data-fill={fill || undefined}
      data-narrow={compact || undefined}
      style={fill ? ({ '--lme-share': `${ratio * 100}%` } as CSSProperties) : undefined}
    >
      <div className="lme-bar">
        {start}
        <output className="lme-status" data-ok={errors === 0}>
          {errors === 0 && warnings === 0
            ? 'No problems'
            : [count(errors, 'error'), count(warnings, 'warning')].filter(Boolean).join(' · ')}
        </output>
        <span className="lme-note" aria-live="polite">
          {note}
        </span>
        <span className="lme-grow" />
        {reader && (
          <button
            type="button"
            className="lm-btn"
            aria-disabled={!canUndo}
            onClick={() => canUndo && view.current && undo(view.current)}
          >
            Undo
          </button>
        )}
        {compact ? (
          <>
            {shareButton}
            {embedMenu}
            <More>
              {lead}
              {tail}
            </More>
          </>
        ) : (
          <>
            {lead}
            {shareButton}
            {embedMenu}
            {tail}
          </>
        )}
      </div>
      {compact && !reader && (
        <div className="lme-panes" role="tablist" aria-label="Show">
          {(['text', 'diagram'] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              className="lm-btn"
              aria-selected={pane === p}
              onClick={() => setPane(p)}
            >
              {p === 'text' ? 'Text' : 'Diagram'}
            </button>
          ))}
        </div>
      )}
      <div className="lme-split" data-layout={layout}>
        <div className="lme-left" hidden={textHidden}>
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
        </div>
        {fill && !compact && !reader && (
          // biome-ignore lint/a11y/useSemanticElements: an <hr> takes no focus nor pointer; this separator is moved
          <div
            className="lme-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the text and the diagram"
            aria-valuemin={MIN_SHARE * 100}
            aria-valuemax={MAX_SHARE * 100}
            aria-valuenow={Math.round(ratio * 100)}
            tabIndex={0}
            onPointerDown={drag}
            onKeyDown={nudge}
            onDoubleClick={() => moveTo(split)}
          />
        )}
        <div className="lme-preview" data-stale={stale || undefined} hidden={compact && !reader && pane === 'text'}>
          {stale && <p className="lme-stale">Showing the last version without errors.</p>}
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
        {reader && (
          <Inspector
            inspection={inspection}
            tab={tab}
            onTab={setTab}
            onEdit={change}
            blocked={errors ? 'The text has errors: show the code to fix them.' : undefined}
            gone={tab === 'box' && !!selected && !inspection}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
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

const SPLIT = 0.4
const MIN_SHARE = 0.2
const MAX_SHARE = 0.8
/** Below this width a filling editor shows one pane at a time. */
const NARROW = 720
const clampShare = (n: number) => (Number.isFinite(n) ? Math.min(MAX_SHARE, Math.max(MIN_SHARE, n)) : SPLIT)

/**
 * The buttons that do not fit a narrow bar: a menu that closes on a pick, a click outside it, or Escape. A pick or
 * Escape hands the focus back to its button, as the one it was on is hidden.
 */
function More({ children }: { children: ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const outside = (e: Event) => !menu.current?.contains(e.target as Node) && shut(menu.current, false)
    const key = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && shut(menu.current, true)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  return (
    <details className="lme-more" ref={menu} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="lm-btn" aria-label="More">
        ⋯
      </summary>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the buttons inside take the keyboard; this only closes the menu after them */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: as above */}
      <div
        className="lme-menu"
        onClick={(e) => (e.target as HTMLElement).closest('button') && shut(menu.current, true)}
        onChange={() => shut(menu.current, true)}
      >
        {children}
      </div>
    </details>
  )
}

function shut(menu: HTMLDetailsElement | null, focus: boolean) {
  if (!menu?.open) return
  menu.open = false
  if (focus) menu.querySelector('summary')?.focus()
}

const count = (n: number, word: string) => (n ? `${n} ${word}${n > 1 ? 's' : ''}` : '')
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || undefined
