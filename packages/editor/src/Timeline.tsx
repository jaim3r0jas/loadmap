import { useId, useState } from 'react'
import { applyFiles } from './apply'
import type { Commit, History } from './history'
import type { FileHost } from './reshape'

/**
 * The Timeline: every version of the files on this branch, newest first, with who made it and, for the assistant, the
 * request it answered. Pressing a version shows it in the canvas (read only); Back and Forward step from there; Restore
 * makes it the current files with a new version on top, and "Branch from here" tries another design from it. Loaded
 * the first time its tab opens.
 */

export interface TimelineProps {
  history: History
  /** What puts files in the editor: a restore and a branch change the files there. */
  host: FileHost
  /** The files as they are now. */
  files: () => { path: string; files: Readonly<Record<string, string>> }
  /** Counts the changes of the history, for this panel to draw again. */
  version: number
  /** The version shown in the canvas instead of the live files; null for the live files. */
  shown: string | null
  /** Draws a version in the canvas, or the files again (null). */
  onShow: (id: string | null) => void
  /** Every file replaced, the model too: a version whose model is another file than now. */
  onReplace: (f: { path: string; files: Readonly<Record<string, string>> }) => void
  /** Saves the whole history as a git bundle. */
  onExport?: () => void
  /** The history changed: kept, and drawn again. */
  onChanged: () => void
  now?: () => number
}

const WHO: Record<Commit['author'], string> = {
  you: 'You',
  assistant: 'Assistant',
  opened: 'Start',
  restore: 'Restore',
}

export const TIMELINE_CSS = `
.lme-timeline { display: grid; gap: 10px; font-size: .84rem; }
.lme-timeline-tools { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.lme-timeline-tools select { font: inherit; color: var(--lm-fg); background: var(--lm-bg); border: 1px solid var(--lm-line); border-radius: 5px; padding: 3px 6px; }
.lme-timeline ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.lme-timeline li > button { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; width: 100%; text-align: left; padding: 6px 8px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.lme-timeline li > button:hover { background: color-mix(in srgb, var(--lm-fg) 6%, transparent); }
.lme-timeline li > button[aria-current="true"] { border-color: var(--lm-accent); background: var(--lm-accent-soft); }
.lme-timeline .lme-who { grid-row: span 2; align-self: start; padding: 1px 6px; border-radius: 999px; font: 600 .68rem var(--lm-font); text-transform: uppercase; letter-spacing: .02em; color: var(--lm-muted); background: color-mix(in srgb, var(--lm-fg) 8%, transparent); }
.lme-timeline .lme-who[data-who="assistant"] { color: var(--lm-accent); background: var(--lm-accent-soft); }
.lme-timeline .lme-when { color: var(--lm-muted); font-size: .76rem; }
.lme-trace { margin: 4px 0 0 0; padding: 8px; border-radius: 6px; background: var(--lm-bg); display: grid; gap: 4px; }
.lme-trace pre { margin: 0; white-space: pre-wrap; font: .76rem var(--lm-mono); }
.lme-keep { display: flex; gap: 6px; }
.lme-keep input { flex: 1; min-width: 0; font: inherit; color: var(--lm-fg); background: var(--lm-bg); border: 1px solid var(--lm-line); border-radius: 5px; padding: 4px 7px; }
`

/** "2 min ago", "3 h ago", or the day. */
export function ago(seconds: number, now: number): string {
  const s = Math.max(0, now - seconds)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/** How many files a version changed against the one before it. */
function changedCount(h: History, c: Commit): number {
  const before = c.parent ? h.commits.get(c.parent) : undefined
  if (!before) return Object.keys(c.files).length
  const paths = new Set([...Object.keys(c.files), ...Object.keys(before.files)])
  return [...paths].filter((p) => c.files[p] !== before.files[p]).length
}

export default function Timeline(p: TimelineProps) {
  const id = useId()
  const h = p.history
  const live = p.files()
  const dirty = !h.same(live.files)
  /** The reader's edits since the newest version, kept before the files change under them. */
  const keepEdits = async () => {
    if (dirty) await h.commit(live.files, live.path, 'you', 'Edited')
  }
  const put = (c: Commit | null) => {
    if (c) {
      const files = h.filesOf(c)
      // a version whose model is another file (renamed since) replaces every file, the model too
      if (c.entry !== live.path || !Object.hasOwn(files, live.path)) p.onReplace({ path: c.entry, files })
      else applyFiles(p.host, files, 'input.history')
      p.onShow(null)
    }
    // a version kept on the way (the reader's edits) is drawn even when nothing else changed
    p.onChanged()
  }
  const restore = async (cid: string) => {
    await keepEdits()
    put(await h.restore(cid))
  }
  const branch = async (cid: string) => {
    await keepEdits()
    if (h.branchFrom(cid)) put(h.head)
  }
  const switchTo = async (name: string) => {
    await keepEdits()
    put(h.switchTo(name))
  }
  const keepNow = async (message: string) => {
    if (await h.commit(live.files, live.path, 'you', message)) p.onChanged()
  }
  const [open, setOpen] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const now = (p.now ?? (() => Math.floor(Date.now() / 1000)))()
  const line = h.line()
  // the version drawn; none is now (the files), which is the newest version unless the reader has edited since
  const current = p.shown ?? (dirty ? null : (line[0]?.id ?? null))
  const step = (by: -1 | 1) => {
    if (!current) return by < 0 && line[0] ? p.onShow(line[0].id) : undefined
    const next = h.step(current, by)
    if (next) p.onShow(next.id === line[0]?.id && !dirty ? null : next.id)
    else if (by > 0) p.onShow(null)
  }
  const counts = new Map(line.map((c) => [c.id, changedCount(h, c)]))
  const atOldest = current === line.at(-1)?.id
  const atNewest = p.shown == null
  return (
    <div className="lme-timeline">
      <style>{TIMELINE_CSS}</style>
      <div className="lme-timeline-tools">
        <button
          type="button"
          className="lm-btn"
          aria-label="Back to the version before"
          aria-disabled={atOldest}
          onClick={() => !atOldest && step(-1)}
        >
          Back
        </button>
        <button
          type="button"
          className="lm-btn"
          aria-label="Forward to the version after"
          aria-disabled={atNewest}
          onClick={() => (p.shown ? step(1) : undefined)}
        >
          Forward
        </button>
        {p.shown && (
          <button type="button" className="lm-btn" onClick={() => p.onShow(null)}>
            Back to now
          </button>
        )}
        {p.onExport && (
          <button type="button" className="lm-btn lme-quiet" onClick={p.onExport} title="A file git clone reads">
            Download
          </button>
        )}
        {h.branches.length > 1 && (
          <label>
            <span className="lm-sr">Branch</span>
            <select value={h.branch} onChange={(e) => void switchTo(e.target.value)}>
              {h.branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {dirty && !p.shown && (
        <form
          className="lme-keep"
          onSubmit={(e) => {
            e.preventDefault()
            void keepNow(message.trim() || 'Edited')
            setMessage('')
          }}
        >
          <label htmlFor={`${id}m`} className="lm-sr">
            What changed
          </label>
          <input
            id={`${id}m`}
            value={message}
            placeholder="What you changed"
            onChange={(e) => setMessage(e.target.value)}
          />
          <button type="submit" className="lm-btn">
            Keep this version
          </button>
        </form>
      )}
      <ol aria-label={`Versions on ${h.branch}`}>
        {line.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              aria-current={c.id === current}
              aria-expanded={open === c.id}
              onClick={() => {
                setOpen(open === c.id ? null : c.id)
                p.onShow(c.id === line[0]?.id && !dirty ? null : c.id)
              }}
            >
              <span className="lme-who" data-who={c.author}>
                {WHO[c.author]}
              </span>
              <span>{c.message}</span>
              <span className="lme-when">
                {ago(c.time, now)} · {counts.get(c.id)} file{counts.get(c.id) === 1 ? '' : 's'} · {c.id.slice(0, 7)}
              </span>
            </button>
            {open === c.id && (
              <div className="lme-trace">
                {c.trace && (
                  <>
                    <div>Asked: {c.trace.request}</div>
                    <div>
                      Model: {c.trace.model}
                      {c.trace.usage ? ` · ${c.trace.usage.input} tokens in, ${c.trace.usage.output} out` : ''}
                    </div>
                    {c.trace.operations.length > 0 && <pre>{c.trace.operations.join('\n')}</pre>}
                  </>
                )}
                <div className="lme-timeline-tools">
                  {c.id !== line[0]?.id && (
                    <button type="button" className="lm-btn" onClick={() => void restore(c.id)}>
                      Restore this version
                    </button>
                  )}
                  <button type="button" className="lm-btn lme-quiet" onClick={() => void branch(c.id)}>
                    Branch from here
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
