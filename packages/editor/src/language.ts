import { autocompletion, type CompletionSource } from '@codemirror/autocomplete'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { type Diagnostic as CmDiagnostic, linter, lintGutter } from '@codemirror/lint'
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { type CompileOptions, type CompileResult, compile, completions, problems } from '@loadmap/dsl'
import { BUILTINS, SCHEMA } from '@loadmap/dsl/internal'

const KEYWORDS = new Set(Object.keys(SCHEMA).filter(Boolean))
const FUNCTIONS = new Set(Object.keys(BUILTINS))

interface State {
  /** Inside a template that runs past the end of the line. */
  template: boolean
  /** The last token was a statement's keyword: the next name is what it declares. */
  declares: boolean
}

function template(stream: { next(): unknown; eol(): boolean }, state: State) {
  while (!stream.eol()) {
    const c = stream.next()
    if (c === '\\') stream.next()
    else if (c === '`') {
      state.template = false
      return
    }
  }
  state.template = true
}

/** Highlighting that reads the language the way the parser's lexer does. */
export const loadmapStream = StreamLanguage.define<State>({
  name: 'loadmap',
  startState: () => ({ template: false, declares: false }),
  token(stream, state) {
    if (state.template) {
      template(stream, state)
      return 'string'
    }
    if (stream.eatSpace()) return null
    const declares = state.declares
    state.declares = false
    if (stream.match('#')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/) || stream.match(/^'(?:[^'\\]|\\.)*'?/)) return 'string'
    if (stream.eat('`')) {
      template(stream, state)
      return 'string'
    }
    if (stream.match(/^\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?/)) return 'number'
    if (stream.match('->')) return 'operator'
    if (stream.match(/^[A-Za-z_]\w*/)) {
      const w = stream.current()
      if (w === 'true' || w === 'false') return 'atom'
      if (stream.match(/^\s*:/, false)) return 'property'
      const head = stream.string.slice(0, stream.start).trimEnd()
      if (KEYWORDS.has(w) && (head === '' || head.endsWith('{') || head.endsWith(';'))) {
        state.declares = true
        return 'keyword'
      }
      if (declares) return 'def'
      if (FUNCTIONS.has(w) && stream.match(/^\s*\(/, false)) return 'builtin'
      return 'variable'
    }
    stream.next()
    return null
  },
  languageData: { commentTokens: { line: '#' } },
})

export const loadmapHighlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--lm-accent)', fontWeight: '600' },
  { tag: t.definition(t.variableName), color: 'var(--lm-fg)', fontWeight: '600' },
  { tag: t.propertyName, color: 'var(--lm-alt)' },
  { tag: t.string, color: 'var(--lm-ok)' },
  { tag: [t.number, t.bool, t.atom], color: 'var(--lm-warn)' },
  { tag: t.comment, color: 'var(--lm-muted)', fontStyle: 'italic' },
  { tag: t.operator, color: 'var(--lm-accent)' },
  { tag: t.standard(t.variableName), color: 'var(--lm-accent)' },
])

/**
 * The language for CodeMirror: highlighting, inline errors from the checker and autocomplete. `onResult` hears every
 * compile the linter runs (after a pause in typing), so a preview can follow without compiling twice.
 */
export function loadmapLanguage(
  o: CompileOptions & { onResult?: (source: string, result: CompileResult) => void; delay?: number } = {},
): Extension {
  let last: { source: string; result: CompileResult } | null = null
  const result = (source: string) => {
    if (last?.source !== source) last = { source, result: compile(source, o) }
    return last.result
  }
  const lint = (view: EditorView): CmDiagnostic[] => {
    const source = view.state.doc.toString()
    const r = result(source)
    o.onResult?.(source, r)
    const end = source.length
    return problems(r).map((d) => ({
      from: Math.min(d.from, end),
      to: Math.min(Math.max(d.to, d.from), end),
      severity: d.severity,
      message: d.hint ? `${d.message}: ${d.hint}` : d.message,
    }))
  }
  const complete: CompletionSource = (ctx) => {
    const source = ctx.state.doc.toString()
    const c = completions(source, ctx.pos, result(source))
    const typed = c.from < c.to || /[.:>]\s*$/.test(source.slice(Math.max(0, c.from - 3), c.from))
    if (!c.options.length || (!ctx.explicit && !typed)) return null
    return { from: c.from, to: c.to, options: c.options, validFor: /^\w*$/ }
  }
  return [
    loadmapStream,
    syntaxHighlighting(loadmapHighlight),
    linter(lint, { delay: o.delay ?? 150 }),
    lintGutter(),
    autocompletion({ override: [complete], activateOnTyping: true }),
  ]
}
