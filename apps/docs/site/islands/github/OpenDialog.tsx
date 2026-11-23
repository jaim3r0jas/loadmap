// "Open from GitHub": a repository's name or address, then its `.loadmap` files to pick the model from. Loaded the
// first time it opens, with its own rules, so the editor's page lacks it until then.

import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { DIALOG_CSS, editorTheme } from './dialog'
import { inFolder, type Listing, list, type Opened, open } from './load'
import { parseRepo, type RepoTarget } from './parse'
import { gh } from './session'
import { missedFile, tokenMends } from './start'
import TokenForm from './TokenForm'

const CSS = `${DIALOG_CSS}
.lmg-files { display: grid; gap: 2px; margin: 0; padding: 4px; list-style: none; border: 1px solid var(--lm-line); border-radius: 8px; max-height: 340px; overflow: auto; }
.lmg-files button { display: flex; align-items: baseline; gap: 6px; width: 100%; padding: 6px 8px; text-align: left; font: .82rem var(--lm-mono); color: inherit; background: none; border: 0; border-radius: 6px; cursor: pointer; }
.lmg-files button:hover, .lmg-files button:focus-visible { background: var(--lm-accent-soft); outline: none; }
.lmg-files button[aria-busy="true"] { background: var(--lm-accent-soft); cursor: progress; }
.lmg-files .lmg-dir { color: var(--lm-muted); overflow-wrap: anywhere; }
.lmg-files .lmg-file { font-weight: 600; overflow-wrap: anywhere; }
.lmg-files small { margin-left: auto; padding-left: 8px; color: var(--lm-muted); font-family: var(--lm-font); white-space: nowrap; }
`

export interface OpenDialogProps {
  /**
   * Where to start: a repository named by the address, one already listed (an address with no file), or one a token
   * may open (`ask` says why).
   */
  start?: { target?: RepoTarget | { error: string }; listing?: Listing; ask?: string }
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
  // a token would mend the last failure: why, and what to try again with it
  const [ask, setAsk] = useState<{ reason: string; owner: string; retry: () => void } | null>(() =>
    first && start?.ask ? { reason: start.ask, owner: first.owner, retry: () => void look(first) } : null,
  )
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
    setAsk(null)
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
      if (mine !== turn.current) return
      if (tokenMends(e)) setAsk({ reason: message(e), owner: target.owner, retry: () => void look(target) })
      else setError(message(e))
    } finally {
      if (mine === turn.current) setBusy(null)
    }
  }

  const pick = async (l: Listing, path: string, mine = ++turn.current) => {
    setError('')
    setAsk(null)
    setBusy(path)
    try {
      const o = await open(gh, l, path)
      if (mine !== turn.current) return
      onOpen(o)
      dialog.current?.close()
    } catch (e) {
      if (mine !== turn.current) return
      if (tokenMends(e)) setAsk({ reason: message(e), owner: l.owner, retry: () => void pick(l, path) })
      else setError(message(e))
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
    if (first && !start?.listing && !start?.ask) void look(first)
  }, [])

  const [theme] = useState(editorTheme)
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
        {ask ? (
          <TokenForm
            reason={ask.reason}
            owner={ask.owner}
            need="read"
            onToken={() => ask.retry()}
            onCancel={() => setAsk(null)}
          />
        ) : listing ? (
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
              A public repository opens as it is; a private one asks you to connect to GitHub. An address to a folder or
              a .loadmap file opens there.
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
