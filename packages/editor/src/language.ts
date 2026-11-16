import {
  autocompletion,
  type Completion as CmCompletion,
  type CompletionSource,
  closeBrackets,
  closeBracketsKeymap,
  snippetCompletion,
} from '@codemirror/autocomplete'
import { isolateHistory } from '@codemirror/commands'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { type Diagnostic as CmDiagnostic, linter, lintGutter } from '@codemirror/lint'
import { type EditorState, type Extension, StateEffect, StateField } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  hoverTooltip,
  keymap,
  showTooltip,
  type Tooltip,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import {
  type CompileOptions,
  type CompileResult,
  type Completion,
  compile,
  completions,
  completionsAcross,
  type Definition,
  type Diagnostic,
  definition,
  definitionAcross,
  type Hover,
  hover,
  hoverAcross,
  type Located,
  loadCatalogFor,
  loadedCatalog,
  problems,
  quickFixes,
  references,
  referencesAcross,
  rename,
  renameAcross,
  type SignatureHelp,
  signatureHelp,
} from '@loadmap/dsl'
import { BUILTINS, LEXICON, SCHEMA } from '@loadmap/dsl/internal'

const KEYWORDS = new Set(Object.keys(SCHEMA).filter(Boolean))
const FUNCTIONS = new Set(Object.keys(BUILTINS))
// a unit written after a number is part of it: 20ms, 80%
const NUMBER = new RegExp(`^\\d[\\d_]*(\\.\\d[\\d_]*)?([eE][+-]?\\d+)?${LEXICON.unit}?`)

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
    if (stream.match(NUMBER)) return 'number'
    if (stream.match('->')) return 'operator'
    if (stream.match(/^[A-Za-z_]\w*/)) {
      const w = stream.current()
      if (w === 'true' || w === 'false') return 'atom'
      // a demand's unit: `… as "cores"`
      if (w === 'as' && stream.match(/^\s*["']/, false)) return 'keyword'
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

/** The other files of the definition a text belongs to: what a host with several open hands the language. */
export interface Around {
  /** The text's own path, from the root of the files. */
  path: string
  /** Every other file by its path. */
  files: Readonly<Record<string, string>>
  /** Counts the changes to those files: the same count is the same files. */
  version: number
}

/** Completion from the parse alone: no compile per keystroke. With files around, their names and paths too. */
const completeWith =
  (around: () => Around | undefined): CompletionSource =>
  (ctx) => {
    const source = ctx.state.doc.toString()
    const a = around()
    const c = a
      ? completionsAcross(source, ctx.pos, { path: a.path, files: a.files, paths: [a.path, ...Object.keys(a.files)] })
      : completions(source, ctx.pos)
    if (
      !c.options.length ||
      (!ctx.explicit && c.from === c.to && !INVITES.test(source.slice(Math.max(0, c.from - 3), c.from)))
    )
      return null
    // in a text (a unit) a "/" is part of the word; in a formula it is a division, after which the list starts again
    const inText = /["'`]/.test(source[c.from - 1] ?? '')
    return { from: c.from, to: c.to, options: c.options.map(cmCompletion), validFor: inText ? /^[\w/]*$/ : /^\w*$/ }
  }

/** A line of help: its `code` as code elements, the rest as text. Never HTML: a shared definition is untrusted. */
function helpLine(text: string, tag: 'p' | 'div' = 'p'): HTMLElement {
  const el = document.createElement(tag)
  text.split('`').forEach((piece, i) => {
    if (!piece) return
    if (i % 2) {
      const code = document.createElement('code')
      code.textContent = piece
      el.append(code)
    } else el.append(piece)
  })
  return el
}

function hoverDom(h: Hover, note?: string): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'lm-hover'
  const head = document.createElement('code')
  head.className = 'lm-hover-head'
  head.textContent = h.head
  dom.append(head, ...h.body.map((line) => helpLine(line)))
  if (note) dom.append(Object.assign(helpLine(note), { className: 'lm-hover-note' }))
  return dom
}

function signatureDom(s: SignatureHelp): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'lm-hover lm-signature'
  const head = document.createElement('code')
  head.className = 'lm-hover-head'
  head.append(`${s.name}(`)
  s.params.forEach((p, i) => {
    if (i) head.append(', ')
    const param = document.createElement('span')
    param.textContent = p
    if (i === s.active) param.className = 'lm-signature-active'
    head.append(param)
  })
  head.append(s.variadic ? ', …)' : ')')
  dom.append(head, helpLine(s.doc))
  return dom
}

type SignatureTip = Tooltip & { key: string }

/**
 * Over the cursor while it is inside a builtin's or a fit's parentheses: the arguments, the one being written marked.
 * While the call and the argument stay the same, the tooltip keeps its element (CodeMirror reuses one whose `create`
 * is the same) and only follows the cursor.
 */
function signatureTooltip(state: EditorState, prev: SignatureTip | null): SignatureTip | null {
  const sel = state.selection.main
  if (!sel.empty) return null
  const s = signatureHelp(state.doc.toString(), sel.head)
  if (!s) return null
  const key = `${s.label}#${s.active}`
  const create = prev?.key === key ? prev.create : () => ({ dom: signatureDom(s) })
  return { pos: sel.head, above: true, arrow: false, create, key }
}

const signature = StateField.define<SignatureTip | null>({
  create: (state) => signatureTooltip(state, null),
  update: (tip, tr) => (tr.docChanged || tr.selection ? signatureTooltip(tr.state, tip) : tip),
  provide: (f) => showTooltip.from(f),
})

/** The fix titled `title` of the diagnostic `was` (now at `from`), made again for `source`; null when it has gone. */
function fixAgain(source: string, r: CompileResult, was: Diagnostic, from: number, title: string) {
  const list = problems(r)
  // the code and the message: two diagnostics of one code can share a place (a component missing two lines)
  const i = list.findIndex((d) => d.from === from && d.code === was.code && d.message === was.message)
  return i < 0 ? null : (quickFixes(source, [list[i]!])[0]!.find((f) => f.title === title)?.changes ?? null)
}

/**
 * Selects where the name at `pos` (the cursor by default) is declared. A name another file declares is handed to
 * `open`, when the host has files to open.
 */
function goToDefinition(
  view: EditorView,
  pos = view.state.selection.main.head,
  around?: () => Around | undefined,
  open?: (at: Located) => void,
): boolean {
  const source = view.state.doc.toString()
  const a = around?.()
  const d: Located | null = a
    ? definitionAcross(source, pos, { path: a.path, files: a.files })
    : definition(source, pos)
  if (!d) return false
  if (d.file != null) {
    open?.(d)
    return !!open
  }
  view.dispatch({ selection: { anchor: d.from, head: d.to }, scrollIntoView: true })
  view.focus()
  return true
}

const occurrence = Decoration.mark({ class: 'lm-occurrence' })

function marks(state: EditorState): DecorationSet {
  const sel = state.selection.main
  const spans = sel.empty ? references(state.doc.toString(), sel.head) : null
  return spans ? Decoration.set(spans.map((s) => occurrence.range(s.from, s.to))) : Decoration.none
}

/** The other places the name under the cursor is written, marked. */
const occurrences = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = marks(view.state)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet) this.decorations = marks(u.state)
    }
  },
  { decorations: (p) => p.decorations },
)

interface Renaming {
  from: number
  to: number
  /** What was typed, kept when a refusal draws the field again. */
  value?: string
  error?: string
}
const openRename = StateEffect.define<Renaming | null>()

/** F2's field at a name: Enter renames it everywhere it is written, Escape closes it. */
function renaming(o: RenameOptions): Extension {
  return StateField.define<Renaming | null>({
    create: () => null,
    update(r, tr) {
      for (const e of tr.effects) if (e.is(openRename)) return e.value
      if (!r || tr.docChanged) return null
      // the cursor went elsewhere: the field would rename a name no longer looked at
      const head = tr.state.selection.main.head
      return tr.selection && (head < r.from || head > r.to) ? null : r
    },
    provide: (f) =>
      showTooltip.from(f, (r) =>
        r
          ? {
              pos: r.from,
              above: true,
              create: (view) => ({
                dom: renameDom(view, r, o),
                mount: () => view.dom.querySelector<HTMLInputElement>('.lm-rename input')?.select(),
              }),
            }
          : null,
      ),
  })
}

/** What a rename reads beyond the text: the functions formulas call, and the other files with a way to change them. */
type RenameOptions = CompileOptions & {
  around?: () => Around | undefined
  /** The changes a rename makes in the other files of the definition: the host applies them where it keeps those. */
  onElsewhere?: (
    changes: readonly { file: string; from: number; to: number; insert: string }[],
    /** The text in the editor does not change with them: nothing else will tell the host of the new files. */
    alone: boolean,
  ) => void
}

function renameDom(view: EditorView, r: Renaming, o: RenameOptions): HTMLElement {
  const form = document.createElement('form')
  form.className = 'lm-hover lm-rename'
  const input = document.createElement('input')
  input.value = r.value ?? view.state.sliceDoc(r.from, r.to)
  input.setAttribute('aria-label', 'New name')
  input.spellcheck = false
  form.append(input)
  if (r.error) form.append(Object.assign(document.createElement('p'), { textContent: r.error }))
  const close = () => {
    view.dispatch({ effects: openRename.of(null) })
    view.focus()
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const a = o.around?.()
    const source = view.state.doc.toString()
    // with other files: everywhere the name is written in the model and its parts
    const out = a
      ? renameAcross(source, r.from, input.value.trim(), { path: a.path, files: a.files, functions: o.functions })
      : rename(source, r.from, input.value.trim(), o)
    if ('error' in out) view.dispatch({ effects: openRename.of({ ...r, value: input.value, error: out.error }) })
    else if (!out.changes.length) close()
    else {
      const all: readonly { file?: string; from: number; to: number; insert: string }[] = out.changes
      const elsewhere = all.flatMap((c) => (c.file != null ? [{ ...c, file: c.file }] : []))
      // the other files first: the text's next check reads them as they are after the rename
      const here = all.filter((c) => c.file == null).map(({ from, to, insert }) => ({ from, to, insert }))
      if (elsewhere.length) o.onElsewhere?.(elsewhere, !here.length)
      // a step of its own in the history: undoing it undoes the rename, in every file it reached
      if (here.length)
        view.dispatch({ changes: here, userEvent: 'input.rename', annotations: isolateHistory.of('full') })
      else close()
      view.focus()
    }
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  })
  return form
}

/** Opens the rename field at the name under the cursor; false where there is no name to rename. */
export function startRename(view: EditorView, around?: () => Around | undefined): boolean {
  const a = around?.()
  const source = view.state.doc.toString()
  const head = view.state.selection.main.head
  // a name another file of the model declares is a name to rename too
  const spans = a
    ? referencesAcross(source, head, { path: a.path, files: a.files })?.filter((s) => s.file == null)
    : references(source, head)
  const at = spans?.find((s) => s.from <= view.state.selection.main.head && view.state.selection.main.head <= s.to)
  if (!at) return false
  view.dispatch({ effects: openRename.of({ from: at.from, to: at.to }) })
  return true
}

/**
 * The language for CodeMirror: highlighting, inline errors from the checker with their quick fixes, autocomplete, hover,
 * signature help, go to definition (F12, a click with Cmd or Ctrl), the other uses of a name marked, and rename (F2).
 * `onResult` hears every compile the linter runs (after a pause in typing), so a preview can follow without compiling
 * twice.
 */
export function loadmapLanguage(
  o: CompileOptions & {
    onResult?: (source: string, result: CompileResult) => void
    delay?: number
    /** The other files of the definition, read on every compile: a text among several is read with them. */
    around?: () => Around | undefined
    /** Go to definition found the name in another file: the host shows it. */
    onOpen?: (at: Located) => void
    /** A rename changed other files of the definition: the host applies the changes there. */
    onElsewhere?: RenameOptions['onElsewhere']
  } = {},
): Extension {
  const around = () => o.around?.()
  let last: { source: string; catalog: boolean; files: string; result: CompileResult } | null = null
  // the last definition without errors: a hover's values while the text has one; not another text's, once replaced
  let good: Definition | undefined
  const replaced = EditorView.updateListener.of((u) => {
    for (const tr of u.transactions)
      tr.changes.iterChanges((fromA, toA) => {
        if (fromA === 0 && toA === tr.startState.doc.length && toA > 0) good = undefined
      })
  })
  const result = (source: string) => {
    // a result from before the catalog loaded is not this text's
    const catalog = !!loadedCatalog()
    const a = around()
    const files = a ? `${a.path}#${a.version}` : ''
    if (last?.source !== source || last.catalog !== catalog || last.files !== files)
      last = { source, catalog, files, result: compile(source, a ? { ...o, path: a.path, files: a.files } : o) }
    good = last.result.definition ?? good
    return last.result
  }
  const info = hoverTooltip((view, pos) => {
    const source = view.state.doc.toString()
    const r = result(source)
    const a = around()
    const at = (def?: Definition) =>
      a ? hoverAcross(source, pos, { path: a.path, files: a.files }, def) : hover(source, pos, def)
    const h = at(r.definition ?? good)
    if (!h) return null
    // values from an older text: say so, where there are any
    const stale = !r.definition && good && h.body.length > (at()?.body.length ?? 0)
    const note = stale ? 'Values from the last version without errors.' : undefined
    return { pos: h.from, end: h.to, above: true, create: () => ({ dom: hoverDom(h, note) }) }
  })
  const lint = async (view: EditorView): Promise<CmDiagnostic[]> => {
    const source = view.state.doc.toString()
    // a published statement: the catalog loads once, the first time a text needs it
    await loadCatalogFor(source)
    for (const text of Object.values(around()?.files ?? {})) await loadCatalogFor(text)
    const r = result(source)
    o.onResult?.(source, r)
    const end = source.length
    // this text's own: a problem in another file is marked there
    const list = problems(r).filter((d) => d.file == null)
    const fixes = quickFixes(source, list)
    return list.map((d, i) => ({
      from: Math.min(d.from, end),
      to: Math.min(Math.max(d.to, d.from), end),
      severity: d.severity,
      message: d.hint ? `${d.message}: ${d.hint}` : d.message,
      // a fix is made for this text: once it has changed, made again for the text as it is now
      actions: fixes[i]!.map((f) => ({
        name: f.title,
        apply: (v: EditorView, from: number) => {
          const now = v.state.doc.toString()
          const changes = now === source ? f.changes : fixAgain(now, result(now), d, from, f.title)
          if (changes) v.dispatch({ changes, userEvent: 'input.fix' })
        },
      })),
    }))
  }
  const renameField = renaming(o)
  return [
    loadmapStream,
    syntaxHighlighting(loadmapHighlight),
    linter(lint, { delay: o.delay ?? 150 }),
    lintGutter(),
    autocompletion({ override: [completeWith(around)], activateOnTyping: true, positionInfo }),
    closeBrackets(),
    keymap.of(closeBracketsKeymap),
    info,
    signature,
    replaced,
    occurrences,
    renameField,
    keymap.of([
      { key: 'F12', run: (v) => goToDefinition(v, undefined, around, o.onOpen) },
      { key: 'F2', run: (v) => startRename(v, around) },
    ]),
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (e.button !== 0 || !(e.metaKey || e.ctrlKey)) return false
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
        if (pos == null || !goToDefinition(view, pos, around, o.onOpen)) return false
        e.preventDefault()
        return true
      },
    }),
  ]
}
