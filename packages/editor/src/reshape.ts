import type { EditorState, TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { FileChange } from './fileops'

/** What an operation on the files reaches of the editor: handed over, so this loads with the explorer. */
export interface FileHost {
  view: RefObject<EditorView | null>
  /** The files: the model, the one in the editor, the text of every other. */
  set: RefObject<{ entry: string; active: string; others: Record<string, string>; version: number }>
  /** Each file's own editor state while another is in the editor. */
  states: RefObject<Map<string, EditorState>>
  /** The files each rename across several reached. */
  renamed: RefObject<Map<number, Set<string>>>
  setOpen: Dispatch<SetStateAction<string[]>>
  setNote: (note: string) => void
  /** A file's state, new from its text. */
  state: (doc: string) => EditorState
  /** The change from one text to another, outside the file's history: undo never takes half an operation back. */
  edit: (was: string, text: string) => TransactionSpec
  /** Another file's state in the editor. */
  show: (next: EditorState) => void
  /** The files changed as a whole: the tabs, the next compile, the page's draft. */
  changed: () => void
  open: (path: string) => void
}

/**
 * An operation of the explorer (a file added, renamed or removed, with the head lines that go with it), as the texts
 * it leaves. None of it is a step of a history: undo cannot bring a file back, so it leaves the lines that name the
 * files alone too. The page hears of the files once, whole.
 */
export function reshape(h: FileHost, c: FileChange) {
  const v = h.view.current
  if (!v) return
  let f = h.set.current
  const states = h.states.current
  const others = { ...f.others }
  if (c.add) others[c.add.path] = c.add.text
  let mine: string | undefined
  for (const [path, text] of Object.entries(c.texts ?? {})) {
    if (path === f.active) mine = text
    else if (Object.hasOwn(others, path)) {
      const kept = states.get(path) ?? h.state(others[path]!)
      states.set(path, kept.update(h.edit(kept.doc.toString(), text)).state)
      others[path] = text
    }
  }
  let { entry, active: now } = f
  if (c.rename) {
    const { from, to } = c.rename
    if (entry === from) entry = to
    if (now === from) now = to
    else if (Object.hasOwn(others, from)) {
      others[to] = others[from]!
      delete others[from]
      const kept = states.get(from)
      states.delete(from)
      if (kept) states.set(to, kept)
    }
    for (const reached of h.renamed.current.values()) if (reached.delete(from)) reached.add(to)
    h.setOpen((o) => o.map((p) => (p === from ? to : p)))
  }
  f = { entry, active: now, others, version: f.version + 1 }
  h.set.current = f
  if (c.remove && c.remove !== f.entry) {
    const rest = { ...others }
    // the file in the editor goes: the model takes its place first
    if (f.active === c.remove) {
      mine = undefined
      const next = states.get(f.entry) ?? h.state(others[f.entry]!)
      delete rest[f.entry]
      states.delete(f.entry)
      h.set.current = { ...f, active: f.entry, others: rest, version: f.version + 1 }
      h.show(next)
    } else {
      delete rest[c.remove]
      h.set.current = { ...f, others: rest, version: f.version + 1 }
    }
    states.delete(c.remove)
  }
  // the open text last: the page then hears of every file as the operation left it, never of half of it
  if (mine != null) {
    const doc = v.state.doc.toString()
    if (doc !== mine) v.dispatch(h.edit(doc, mine))
  }
  h.changed()
  if (c.add) h.open(c.add.path)
  if (c.note) h.setNote(c.note)
}
