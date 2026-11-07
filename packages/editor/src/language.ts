import {
  autocompletion,
  type Completion as CmCompletion,
  type CompletionSource,
  closeBrackets,
  closeBracketsKeymap,
  snippetCompletion,
} from '@codemirror/autocomplete'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { type Diagnostic as CmDiagnostic, linter, lintGutter } from '@codemirror/lint'
import type { Extension } from '@codemirror/state'
import { type EditorView, keymap } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { type CompileOptions, type CompileResult, type Completion, compile, completions, problems } from '@loadmap/dsl'
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
  languageData: { commentTokens: { line: '#' }, closeBrackets: { brackets: ['(', '[', '{', '"', '`'] } },
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
 * What opens the list before a word is typed: a dot, a colon, an arrow, an operator, an open parenthesis, bracket or
 * quote, a comma, or the space after a number (a capacity's `±`). Where nothing fits, the list stays closed.
 */
const INVITES = /(?:[.:>(,[+\-*/%?!=<&|"'±]|\d)\s?$/

type Rect = { left: number; right: number; top: number; bottom: number }

/**
 * The help beside the list, as CodeMirror places it; where there is no room beside it (a phone), past the whole list on
 * the side away from the line being typed, not over the options after the one selected: those are what the reader is
 * choosing between.
 */
function positionInfo(view: EditorView, list: Rect, option: Rect, info: Rect, space: Rect) {
  const width = info.right - info.left
  const height = info.bottom - info.top
  // the editor may sit in a scaled box: offsets are in its own pixels
  const box = view.dom.getBoundingClientRect()
  const scaleX = box.width / view.dom.offsetWidth || 1
  const scaleY = box.height / view.dom.offsetHeight || 1
  const right = space.right - list.right
  const left = list.left - space.left
  if (width <= Math.max(right, left)) {
    const side = right >= width || right >= left ? 'right' : 'left'
    const top = Math.max(space.top, Math.min(option.top, space.bottom - height)) - list.top
    const room = Math.min(400, side === 'right' ? right : left)
    return { style: `top: ${top / scaleY}px; max-width: ${room / scaleX}px`, class: `cm-completionInfo-${side}` }
  }
  // on the side of the list away from the line being typed
  const caret = view.coordsAtPos(view.state.selection.main.head)
  const listBelow = !caret || list.top >= caret.top
  const edge = listBelow ? 'top' : 'bottom'
  const room = Math.max(160, Math.min(400, space.right - list.left - 30))
  return {
    style: `${edge}: ${(list.bottom - list.top) / scaleY}px; max-width: ${room / scaleX}px`,
    class: 'cm-completionInfo-right-narrow',
  }
}

function cmCompletion(o: Completion): CmCompletion {
  const { snippet, ...rest } = o
  return snippet ? snippetCompletion(snippet, rest) : rest
}

/** Completion from the parse alone: no compile per keystroke. */
const complete: CompletionSource = (ctx) => {
  const source = ctx.state.doc.toString()
  const c = completions(source, ctx.pos)
  if (
    !c.options.length ||
    (!ctx.explicit && c.from === c.to && !INVITES.test(source.slice(Math.max(0, c.from - 3), c.from)))
  )
    return null
  // in a text (a unit) a "/" is part of the word; in a formula it is a division, after which the list starts again
  const inText = /["'`]/.test(source[c.from - 1] ?? '')
  return { from: c.from, to: c.to, options: c.options.map(cmCompletion), validFor: inText ? /^[\w/]*$/ : /^\w*$/ }
}

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
  return [
    loadmapStream,
    syntaxHighlighting(loadmapHighlight),
    linter(lint, { delay: o.delay ?? 150 }),
    lintGutter(),
    autocompletion({ override: [complete], activateOnTyping: true, positionInfo }),
    closeBrackets(),
    keymap.of(closeBracketsKeymap),
  ]
}
