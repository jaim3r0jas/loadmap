import { EditorSelection, type Extension, Prec, RangeSetBuilder, StateEffect } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { lex, PLUS_MINUS_MARKS, Reporter } from '@loadmap/dsl/internal'

/** The reader turned ligatures on or off: the marks are drawn again, or taken away. */
export const redrawMarks = StateEffect.define<null>()

/** A capacity's `+-` (or `+/-`) drawn as `±`, as wide as the marks it stands for, so the columns stay where they are. */
class Sign extends WidgetType {
  constructor(readonly width: number) {
    super()
  }
  override eq(other: Sign) {
    return other.width === this.width
  }
  toDOM() {
    const sign = document.createElement('span')
    sign.className = 'lme-pm'
    sign.textContent = '±'
    sign.style.width = `${this.width}ch`
    return sign
  }
  override ignoreEvent() {
    return false
  }
}

// the language's spellings of ±, but the one that is ± already
const SIGNS = new Set(PLUS_MINUS_MARKS.filter((m) => m !== '±'))

/**
 * Every `+-` and `+/-` the language reads as a capacity's ±. The lexer knows the file's `loadmap` line: before 1.6 a
 * `+-` is a plus and a minus, and stays as it is written. Texts and comments are never marks.
 */
function signs(view: EditorView): DecorationSet {
  const text = view.state.doc.toString()
  // most texts have none: no need to read them
  if (![...SIGNS].some((m) => text.includes(m))) return Decoration.none
  const out = new RangeSetBuilder<Decoration>()
  for (const t of lex(text, new Reporter(text)))
    if (t.kind === 'punct' && SIGNS.has(t.text))
      out.add(t.from, t.to, Decoration.replace({ widget: new Sign(t.to - t.from) }))
  return out.finish()
}

/**
 * Draws a capacity's `+-` as `±` while `on()` says ligatures are on, the way a font joins `->`: the text keeps its
 * marks (copy, undo and the file are as written), the cursor steps over the sign as over one character (an atomic
 * range), and Backspace and Delete take one mark at a time, as in a ligature.
 */
export function plusMinusSigns(on: () => boolean): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = on() ? signs(view) : Decoration.none
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(redrawMarks))))
          this.decorations = on() ? signs(u.view) : Decoration.none
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations ?? Decoration.none),
    },
  )
  /**
   * Backspace after a sign, Delete before it: one mark, as in a ligature, where the atomic range would take them all.
   * Only empty cursors, each at a sign's edge; anything else is CodeMirror's.
   */
  const oneMark =
    (back: boolean) =>
    (view: EditorView): boolean => {
      const set = view.plugin(plugin)?.decorations
      if (!set?.size) return false
      const at = (pos: number) => {
        let edge: { from: number; to: number } | undefined
        set.between(pos, pos, (from, to) => {
          if ((back ? to : from) === pos) edge = { from, to }
        })
        return edge
      }
      const signs = view.state.selection.ranges.map((r) => (r.empty ? at(r.head) : undefined))
      if (!signs.every((s) => s)) return false
      const marks = signs.map((s) => (back ? { from: s!.to - 1, to: s!.to } : { from: s!.from, to: s!.from + 1 }))
      view.dispatch({
        changes: marks,
        selection: EditorSelection.create(
          marks.map((m) => EditorSelection.cursor(m.from)),
          view.state.selection.mainIndex,
        ),
        userEvent: back ? 'delete.backward' : 'delete.forward',
        scrollIntoView: true,
      })
      return true
    }
  return [
    plugin,
    Prec.high(
      keymap.of([
        { key: 'Backspace', run: oneMark(true) },
        { key: 'Delete', run: oneMark(false) },
      ]),
    ),
  ]
}
