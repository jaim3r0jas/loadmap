// "Open from GitHub": a repository's name or address, then its `.loadmap` files to pick the model from. Loaded the
// first time it opens, with its own rules, so the editor's page lacks it until then.
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { inFolder, type Listing, list, type Opened, open } from './load'
import { parseRepo, type RepoTarget } from './parse'
import { gh } from './session'
import { missedFile } from './start'

const CSS = `
.lmg-dialog { width: min(560px, calc(100vw - 32px)); max-height: min(640px, calc(100dvh - 32px)); padding: 0; color: var(--lm-fg); background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 12px; box-shadow: 0 12px 40px rgb(0 0 0 / .25); font: 400 .9rem var(--lm-font); }
.lmg-dialog[open] { display: flex; flex-direction: column; }
.lmg-dialog:not([open]) { display: none; }
.lmg-dialog::backdrop { background: rgb(0 0 0 / .35); }
.lmg-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--lm-line); }
.lmg-head h2 { margin: 0; font-size: 1rem; }
.lmg-body { display: grid; gap: 10px; min-height: 0; overflow: auto; padding: 12px 14px 14px; }
.lmg-row { display: flex; gap: 8px; }
.lmg-row input { flex: 1; min-width: 0; }
.lmg-dialog input:not([type="checkbox"]) { box-sizing: border-box; padding: 6px 8px; font: inherit; color: var(--lm-fg); background: var(--lm-bg); border: 1px solid var(--lm-line); border-radius: 6px; }
.lmg-dialog input:focus-visible { outline: 2px solid var(--lm-accent); outline-offset: -1px; }
.lmg-hint { margin: 0; color: var(--lm-muted); font-size: .8rem; line-height: 1.45; }
.lmg-error { margin: 0; padding: 8px 10px; border-left: 3px solid var(--lm-warn); background: color-mix(in srgb, var(--lm-warn) 8%, transparent); border-radius: 0 6px 6px 0; line-height: 1.45; overflow-wrap: anywhere; }
.lmg-at { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.lmg-at b { font-family: var(--lm-mono); font-weight: 600; overflow-wrap: anywhere; }
.lmg-at code { font: .8rem var(--lm-mono); color: var(--lm-muted); }
.lmg-at button { margin-left: auto; }
.lmg-files { display: grid; gap: 2px; margin: 0; padding: 4px; list-style: none; border: 1px solid var(--lm-line); border-radius: 8px; max-height: 340px; overflow: auto; }
.lmg-files button { display: flex; align-items: baseline; gap: 6px; width: 100%; padding: 6px 8px; text-align: left; font: .82rem var(--lm-mono); color: inherit; background: none; border: 0; border-radius: 6px; cursor: pointer; }
.lmg-files button:hover, .lmg-files button:focus-visible { background: var(--lm-accent-soft); outline: none; }
.lmg-files button[aria-busy="true"] { background: var(--lm-accent-soft); cursor: progress; }
.lmg-files .lmg-dir { color: var(--lm-muted); overflow-wrap: anywhere; }
.lmg-files .lmg-file { font-weight: 600; overflow-wrap: anywhere; }
.lmg-files small { margin-left: auto; padding-left: 8px; color: var(--lm-muted); font-family: var(--lm-font); white-space: nowrap; }
`

export interface OpenDialogProps {
  /** Where to start: a repository named by the address, or one already listed (an address with no file). */
  start?: { target?: RepoTarget | { error: string }; listing?: Listing }
  onOpen: (opened: Opened) => void
  onClose: () => void
}

const named = (t: RepoTarget) => `${t.owner}/${t.name}`
const sizeOf = (bytes: number) => (bytes < 1000 ? `${bytes} B` : `${Math.round(bytes / 100) / 10} kB`)

export default function OpenDialog({ start, onOpen, onClose }: OpenDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const first = start?.target && !('error' in start.target) ? start.target : undefined
  const [text, setText] = useState(first ? named(first) : '')
  const [listing, setListing] = useState<Listing | undefined>(start?.listing)
  const [error, setError] = useState(start?.target && 'error' in start.target ? start.target.error : '')
  const [busy, setBusy] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  // one look at a time: an older answer arriving late never replaces a newer one
  const turn = useRef(0)

  useEffect(() => {
    dialog.current?.showModal()
    if (!start?.listing) input.current?.focus()
  }, [start?.listing])
  // closed (Close, Esc) while GitHub is still answering: that answer opens nothing
  useEffect(
    () => () => {
      turn.current++
    },
    [],
  )

  const look = async (target: RepoTarget) => {
    const mine = ++turn.current
    setError('')
    setBusy('look')
    try {
      const l = await list(gh, target)
      if (mine !== turn.current) return
      setListing(l)
      setFilter('')
      const missed = missedFile(target, l)
      if (missed) setError(`${missed}. Pick the model here.`)
      else if (l.want) await pick(l, l.want, mine)
      else if (inFolder(l).length === 1) await pick(l, inFolder(l)[0]!.path, mine)
    } catch (e) {
      if (mine === turn.current) setError(message(e))
    } finally {
      if (mine === turn.current) setBusy(null)
    }
  }

  const pick = async (l: Listing, path: string, mine = ++turn.current) => {
    setError('')
    setBusy(path)
    try {
      const o = await open(gh, l, path)
      if (mine !== turn.current) return
      onOpen(o)
      dialog.current?.close()
    } catch (e) {
      if (mine === turn.current) setError(message(e))
    } finally {
      if (mine === turn.current) setBusy(null)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const t = parseRepo(text)
    if ('error' in t) setError(t.error)
    else void look(t)
  }

  // an address with a folder starts the list there; the filter narrows it further
  const shown = useMemo(() => {
    if (!listing) return []
    const q = filter.trim().toLowerCase()
    return inFolder(listing).filter((f) => !q || f.path.toLowerCase().includes(q))
  }, [listing, filter])

  // the first look only: what the address named
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on opening
  useEffect(() => {
    if (first && !start?.listing) void look(first)
  }, [])

  // a loadmap root of its own (its colours), in the theme the editor shows: the editor's bar is behind the backdrop,
  // so the theme cannot change while it is open
  const [theme] = useState(() => document.querySelector('.lm.lme')?.getAttribute('data-theme') ?? undefined)
  return (
    <dialog ref={dialog} className="lm lmg-dialog" data-theme={theme} aria-labelledby={`${id}h`} onClose={onClose}>
      <style>{CSS}</style>
      <div className="lmg-head">
        <h2 id={`${id}h`}>Open from GitHub</h2>
        <button type="button" className="lm-btn lme-quiet" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </div>
      <div className="lmg-body">
        {listing ? (
          <>
            <div className="lmg-at">
              <b>{named(listing)}</b>
              <code>
                {listing.ref} · {listing.sha.slice(0, 7)}
              </code>
              <button
                type="button"
                className="lm-btn lme-quiet"
                onClick={() => {
                  turn.current++
                  setBusy(null)
                  setListing(undefined)
                  setError('')
                  setFilter('')
                  setText(named(listing))
                  setTimeout(() => input.current?.focus())
                }}
              >
                Another repository
              </button>
            </div>
            {inFolder(listing).length === 0 ? (
              <p className="lmg-hint">
                There is no .loadmap file {listing.folder ? `in ${listing.folder}/ ` : ''}at {listing.ref}.
              </p>
            ) : (
              <>
                <p className="lmg-hint" id={`${id}l`}>
                  Pick the model to open: the files it names open with it.
                </p>
                {inFolder(listing).length > 8 && (
                  <input
                    type="search"
                    placeholder="Filter the files"
                    aria-label="Filter the files"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                )}
                <ul className="lmg-files" aria-labelledby={`${id}l`}>
                  {shown.map((f) => {
                    const cut = f.path.lastIndexOf('/') + 1
                    return (
                      <li key={f.path}>
                        <button
                          type="button"
                          aria-busy={busy === f.path}
                          disabled={busy != null && busy !== f.path}
                          onClick={() => pick(listing, f.path)}
                        >
                          {cut > 0 && <span className="lmg-dir">{f.path.slice(0, cut)}</span>}
                          <span className="lmg-file">{f.path.slice(cut)}</span>
                          <small>{busy === f.path ? 'Opening…' : sizeOf(f.size)}</small>
                        </button>
                      </li>
                    )
                  })}
                  {shown.length === 0 && <li className="lmg-hint">No file matches.</li>}
                </ul>
              </>
            )}
            {listing.truncated && (
              <p className="lmg-hint">
                The repository is larger than GitHub lists at once: some files may be missing here. An address to a file
                opens it all the same.
              </p>
            )}
          </>
        ) : (
          <form onSubmit={submit} className="lmg-body" style={{ padding: 0 }}>
            <label htmlFor={`${id}r`}>Repository</label>
            <div className="lmg-row">
              <input
                id={`${id}r`}
                ref={input}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="owner/name, or its address on GitHub"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" className="lm-btn" aria-disabled={busy != null}>
                {busy ? 'Looking…' : 'Open'}
              </button>
            </div>
            <p className="lmg-hint">
              A public repository opens without signing in. An address to a folder or a .loadmap file opens there.
            </p>
          </form>
        )}
        {error && (
          <p className="lmg-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </dialog>
  )
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Try again.'
}
