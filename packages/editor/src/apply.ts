import { isolateHistory } from '@codemirror/commands'
import { Transaction } from '@codemirror/state'
import { between } from './LoadmapEditor'
import { type FileHost, reshape } from './reshape'

/**
 * A whole set of files put in the editor: what a restore or an accepted proposal does. A file whose text changed is
 * one step of its own undo (the open one, and each other one in its own state); a file added or removed goes as the
 * explorer adds and removes one. The page hears of the files once, after all of it.
 */
export function applyFiles(h: FileHost, next: Readonly<Record<string, string>>, userEvent = 'input.assistant') {
  const v = h.view.current
  if (!v) return
  const f = h.set.current
  const now: Record<string, string> = { ...f.others, [f.active]: v.state.doc.toString() }
  // each file added or removed as the explorer does it, but the page hears of the files once, at the end, and the
  // editor stays on the file it shows
  const quiet: FileHost = { ...h, changed: () => {}, open: () => {} }
  for (const path of Object.keys(now))
    if (!Object.hasOwn(next, path) && path !== f.entry) reshape(quiet, { remove: path, note: '' })
  for (const [path, text] of Object.entries(next))
    if (!Object.hasOwn(now, path)) reshape(quiet, { add: { path, text }, note: '' })
  const set = h.set.current
  const others = { ...set.others }
  for (const [path, text] of Object.entries(next)) {
    if (now[path] == null || now[path] === text) continue
    if (path === set.active) continue
    const kept = h.states.current.get(path) ?? h.state(others[path]!)
    h.states.current.set(
      path,
      kept.update({
        changes: between(kept.doc.toString(), text),
        annotations: [isolateHistory.of('full'), Transaction.userEvent.of(userEvent)],
      }).state,
    )
    others[path] = text
  }
  h.set.current = { ...set, others, version: set.version + 1 }
  const open = next[set.active]
  if (open != null && open !== v.state.doc.toString())
    v.dispatch({
      changes: between(v.state.doc.toString(), open),
      annotations: [isolateHistory.of('full'), Transaction.userEvent.of(userEvent)],
    })
  h.changed()
}
