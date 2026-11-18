import { type Extension, Facet, Prec, StateEffect } from '@codemirror/state'
import { type EditorView, keymap } from '@codemirror/view'

/**
 * Find and replace in the text: Mod-F opens CodeMirror's search panel. Its code loads with the first Mod-F, not with the
 * editor: a page that never searches never loads it. The browser's own find would miss the text: CodeMirror draws only
 * the lines in view.
 */

/** The search, once a state has it: each file's state takes it on its own first Mod-F. */
const searching = Facet.define<boolean, boolean>({ combine: (v) => v.length > 0 })

type Loaded = typeof import('@codemirror/search') & { panel: Extension }
let loading: Promise<Loaded> | undefined
// the panel's look loads with it: its rules are no part of the editor's first load
const load = () => {
  loading ??= Promise.all([import('@codemirror/search'), import('./searchPanel')]).then(([m, p]) => ({
    ...m,
    panel: p.panel,
  }))
  return loading
}

/** Runs one of the search's commands, loading it first: the key is taken at once, so the browser's never runs. */
const withSearch =
  (pick: (m: Loaded) => (view: EditorView) => boolean) =>
  (view: EditorView): boolean => {
    void load().then((m) => {
      if (!view.state.facet(searching))
        view.dispatch({
          effects: StateEffect.appendConfig.of([
            searching.of(true),
            m.search({ top: true }),
            keymap.of(m.searchKeymap),
            m.panel,
          ]),
        })
      pick(m)(view)
    })
    return true
  }

/** Opens the search panel. */
export const openSearch = withSearch((m) => m.openSearchPanel)

/** Mod-F and go to a line (Mod-Alt-G), ahead of the browser's; once loaded, the panel's own keys too. */
export const lazySearch: Extension = Prec.high(
  keymap.of([
    { key: 'Mod-f', run: openSearch, preventDefault: true },
    { key: 'Mod-Alt-g', run: withSearch((m) => m.gotoLine), preventDefault: true },
  ]),
)
