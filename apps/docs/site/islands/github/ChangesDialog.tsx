// "Changes": what the reader changed of the repository's files, file by file, each with its diff; a file or all of
// them back as the commit holds them. Loaded with the rest of the GitHub code, the diff itself only once one opens.

import { useEffect, useId, useRef, useState } from 'react'
import type { Change } from './changes'
import { DIFF_CSS, Diff } from './Diff'
import { DIALOG_CSS, editorTheme } from './dialog'
import type { RepoTab } from './tab'

const CSS = `${DIALOG_CSS}${DIFF_CSS}
.lmg-changes { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.lmg-change { border: 1px solid var(--lm-line); border-radius: 8px; overflow: hidden; }
.lmg-change-row { display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 10px; }
.lmg-change-row > button:first-child { display: flex; align-items: baseline; gap: 8px; flex: 1; min-width: 0; padding: 2px 0; text-align: left; font: .82rem var(--lm-mono); color: inherit; background: none; border: 0; cursor: pointer; }
.lmg-change-row > button:first-child span { overflow-wrap: anywhere; }
.lmg-change-row > button:first-child::before { content: "▸"; color: var(--lm-muted); transition: transform .12s; }
.lmg-change-row > button[aria-expanded="true"]:first-child::before { transform: rotate(90deg); }
.lmg-kind { flex: none; padding: 1px 6px; border-radius: 999px; font: 600 .68rem var(--lm-font); letter-spacing: .02em; text-transform: uppercase; }
.lmg-kind[data-kind="changed"] { color: var(--lm-accent); background: var(--lm-accent-soft); }
.lmg-kind[data-kind="added"] { color: var(--lm-ok); background: color-mix(in srgb, var(--lm-ok) 14%, transparent); }
.lmg-kind[data-kind="removed"] { color: var(--lm-drop); background: color-mix(in srgb, var(--lm-drop) 14%, transparent); }
`

const KIND: Record<Change['kind'], string> = { changed: 'Changed', added: 'New', removed: 'Removed' }

export interface ChangesDialogProps {
  tab: RepoTab
  /** What changed of the tab's files (changes.ts): worked out by the page, which counts them as the reader types. */
  list: Change[]
  /** Puts a file (or every file, with no path) back as the commit holds it. */
  onUndo: (path?: string) => void
  onClose: () => void
}

export default function ChangesDialog({ tab, list, onUndo, onClose }: ChangesDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [open, setOpen] = useState<string | null>(null)
  // an Undo goes with what it undid: the keyboard stays in the dialog, on its list
  const body = useRef<HTMLDivElement>(null)
  const undo = (path?: string) => {
    onUndo(path)
    requestAnimationFrame(() => body.current?.focus())
  }
  const o = tab.origin
  useEffect(() => dialog.current?.showModal(), [])
  const [theme] = useState(editorTheme)
  return (
    <dialog
      ref={dialog}
      className="lm lmg-dialog lmg-wide"
      data-theme={theme}
      aria-labelledby={`${id}h`}
      onClose={onClose}
    >
      <style>{CSS}</style>
      <div className="lmg-head">
        <h2 id={`${id}h`}>Changes</h2>
        <button type="button" className="lm-btn lme-quiet" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </div>
      <div className="lmg-body" ref={body} tabIndex={-1}>
        <div className="lmg-at">
          <b>
            {o.owner}/{o.name}
          </b>
          <a
            href={`https://github.com/${encodeURIComponent(o.owner)}/${encodeURIComponent(o.name)}/tree/${o.sha}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {o.ref} · {o.sha.slice(0, 7)} ↗
          </a>
        </div>
        {list.length === 0 ? (
          <p className="lmg-hint">Nothing changed: the files are as {o.ref} holds them.</p>
        ) : (
          <>
            <p className="lmg-hint">
              {list.length} file{list.length === 1 ? '' : 's'} changed since the files were opened.
            </p>
            <ul className="lmg-changes">
              {list.map((c) => (
                <li key={c.path} className="lmg-change">
                  <div className="lmg-change-row">
                    <button
                      type="button"
                      aria-expanded={open === c.path}
                      aria-controls={`${id}-${c.path}`}
                      onClick={() => setOpen(open === c.path ? null : c.path)}
                    >
                      <span>{c.path}</span>
                    </button>
                    <span className="lmg-kind" data-kind={c.kind}>
                      {KIND[c.kind]}
                    </span>
                    <button
                      type="button"
                      className="lm-btn lme-quiet"
                      onClick={() => undo(c.path)}
                      aria-label={`Undo the changes to ${c.path}`}
                    >
                      Undo
                    </button>
                  </div>
                  {open === c.path && <Diff id={`${id}-${c.path}`} before={c.before} after={c.after} />}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {list.length > 0 && (
        <div className="lmg-foot">
          <button
            type="button"
            className="lm-btn lme-quiet lmg-grow"
            onClick={() => {
              if (window.confirm(`Put every file back as ${o.ref} holds it? Your changes go.`)) undo()
            }}
          >
            Undo all changes
          </button>
        </div>
      )}
    </dialog>
  )
}
