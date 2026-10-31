import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import type { Model, ParamValue, Values } from '@loadmap/core'
import {
  type CompileResult,
  compile,
  type Definition,
  type Diagnostic,
  encodeShare,
  type HostFunctions,
  lex,
  Reporter,
} from '@loadmap/dsl'
import { Loadmap, type LoadmapHandle, type Theme } from '@loadmap/react'
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { loadmapLanguage } from './language'
import { injectEditorStyles } from './styles'

/** What a page can drive from outside. */
export interface LoadmapEditorHandle {
  source(): string
  /** Replaces the whole text, e.g. with an example. */
  setSource(source: string): void
  /** The preview, once a version has compiled. */
  loadmap(): LoadmapHandle | null
  /** The hash of a link to this definition at the current values: `v1.…&load=30`. */
  shareHash(): Promise<string>
}

export interface LoadmapEditorProps {
  /** The text to start from. */
  initial: string
  /** Values to start the preview at, e.g. from a shared link. */
  values?: Partial<Values<any>>
  /** Functions formulas may call beyond the built-in ones. */
  functions?: HostFunctions
  theme?: Theme
  /** Every change of the text: a page can keep a draft. */
  onChange?: (source: string) => void
  /** Called with a share hash. Default: puts it in the address bar and copies the link. */
  onShare?: (hash: string) => void | Promise<void>
  /** More buttons for the bar: export, record. */
  actions?: ReactNode
  /** The name the downloaded file takes, without ".loadmap". Default: the title. */
  fileName?: string
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
  const shown = useRef<Partial<Values<any>>>(values ?? {})
  const latest = useRef({ onChange, functions })
  latest.current = { onChange, functions }

  const accept = (source: string, result: CompileResult) => {
    const h = preview.current
    if (h) shown.current = h.values()
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
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorState.tabSize.of(2),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'loadmap definition' }),
          loadmapLanguage({
            functions: latest.current.functions,
            onResult: (source, result) => acceptRef.current(source, result),
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) latest.current.onChange?.(u.state.doc.toString())
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

  useImperativeHandle(ref, () => ({
    source: () => view.current?.state.doc.toString() ?? state.source,
    setSource: (source) => {
      const v = view.current
      if (!v) return
      shown.current = {}
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: source }, selection: { anchor: 0 } })
    },
    loadmap: () => preview.current,
    shareHash,
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

  const problems = state.result.diagnostics
  const errors = problems.filter((d) => d.severity === 'error').length
  const warnings = problems.length - errors
  const stale = !state.result.ok && !!def

  return (
    <div className="lm lme" data-theme={theme === 'auto' || !theme ? undefined : theme}>
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
        <button type="button" className="lm-btn" onClick={share}>
          Share link
        </button>
        <button type="button" className="lm-btn" onClick={save}>
          Download .loadmap
        </button>
        {actions}
      </div>
      <div className="lme-split">
        <div className="lme-left">
          <div className="lme-code" ref={host} />
          {problems.length > 0 && (
            <ul className="lme-problems">
              {problems.map((d) => (
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
              theme={theme}
              {...pageOptions(def)}
              initial={valuesFor(def.model, shown.current)}
            />
          ) : (
            <p className="lme-empty">Fix the errors on the left to see the diagram.</p>
          )}
        </div>
      </div>
    </div>
  )
}

/** The definition's page options, leaving out the unset ones so `<Loadmap>` keeps its defaults. */
function pageOptions(def: Definition) {
  const { speed, direction, assumptions } = def.options
  return {
    ...(speed != null ? { speed } : {}),
    ...(direction ? { direction } : {}),
    ...(assumptions.length ? { assumptions } : {}),
  }
}

/** The tokens of the text: two texts with the same tokens define the same diagram. */
function fingerprint(source: string): string {
  return lex(source, new Reporter(source))
    .map((t) => t.text)
    .join('\u0001')
}

/** The values that still fit the model: known names, options that still exist, loads within range. */
function valuesFor(model: Model, v: Partial<Values<any>>): Partial<Values<any>> {
  const out: Record<string, unknown> = {}
  for (const { id, def } of model.params) {
    const x = (v as Record<string, unknown>)[id]
    if (x === undefined) continue
    if (def.kind === 'select' && (def.options as unknown[]).includes(x)) out[id] = x
    if (def.kind === 'switch' && typeof x === 'boolean') out[id] = x
    if ((def.kind === 'range' || def.kind === 'load') && typeof x === 'number')
      out[id] = Math.min(def.max, Math.max(def.min, x))
  }
  return out as Partial<Values<any>>
}

const count = (n: number, word: string) => (n ? `${n} ${word}${n > 1 ? 's' : ''}` : '')
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || undefined
