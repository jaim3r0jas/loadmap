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
import type { Model, ParamValue, Values } from '@loadmap/core'
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
} from '@loadmap/dsl'
import { type EditValue, edit, fingerprint, inspect, pageOptions } from '@loadmap/dsl/internal'
import { Loadmap, type LoadmapHandle, type Theme, usePageTheme } from '@loadmap/react'
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
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
  /** More buttons for the bar: export, record. */
  actions?: ReactNode
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
  actions,
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
    // in full screen the text is out of sight: the keyboard must not go into it
    const full = preview.current?.board()?.svg.closest('[data-full]')
    if (layout !== 'code' || !v || !box || full) return
    const end = Math.min(box.decl.to, v.state.doc.length)
    v.dispatch({
      selection: { anchor: box.decl.from, head: end },
      effects: EditorView.scrollIntoView(box.decl.from, { y: 'start', yMargin: 24 }),
    })
    v.focus()
  }
  // the text was hidden: CodeMirror measures it again once it shows; the inspector starts from the text as it is
  useEffect(() => {
    if (layout === 'code') view.current?.requestMeasure()
    else if (view.current) setText(view.current.state.doc.toString())
  }, [layout])

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

  return (
    <div className="lm lme" data-theme={look === 'auto' ? undefined : look}>
      <div className="lme-bar">
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
        <button type="button" className="lm-btn" onClick={share}>
          Share link
        </button>
        <button type="button" className="lm-btn" onClick={save}>
          Download .loadmap
        </button>
        {actions}
      </div>
      <div className="lme-split" data-layout={layout}>
        <div className="lme-left" hidden={reader}>
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
        <div className="lme-preview" data-stale={stale || undefined}>
          {stale && <p className="lme-stale">Showing the last version without errors.</p>}
          {def ? (
            <Loadmap
              ref={preview}
              model={def.model}
              view={def.view}
              theme={look}
              {...pageOptions(def.options)}
              initial={valuesFor(def.model, shown.current)}
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

/** The tokens of the text: two texts with the same tokens define the same diagram. */
/**
 * The values that still fit the model: known names, options that still exist, numbers within range. A text (from a
 * link) is read by the parameter's kind, so "20" can be the number 20 or the option "20".
 */
function valuesFor(model: Model, v: Readonly<Record<string, unknown>>): Partial<Values<any>> {
  const out: Record<string, unknown> = {}
  for (const { id, def } of model.params) {
    if (!Object.hasOwn(v, id)) continue
    const x = v[id]
    if (def.kind === 'select') {
      const o = (def.options as unknown[]).find((o) => o === x || String(o) === String(x))
      if (o !== undefined) out[id] = o
    }
    if (def.kind === 'switch' && (x === true || x === 'true' || x === false || x === 'false'))
      out[id] = x === true || x === 'true'
    if (def.kind === 'range' || def.kind === 'load') {
      const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : Number.NaN
      if (Number.isFinite(n)) out[id] = Math.min(def.max, Math.max(def.min, n))
    }
  }
  return out as Partial<Values<any>>
}

const count = (n: number, word: string) => (n ? `${n} ${word}${n > 1 ? 's' : ''}` : '')
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || undefined
