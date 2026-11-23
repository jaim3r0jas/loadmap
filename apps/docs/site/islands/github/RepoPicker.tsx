// Open from GitHub's lists under the name field: what this browser opened lately, and, connected, the reader's
// repositories (the app's installations', or what a pasted token sees), newest first among those read, narrowed by
// what is typed.
import { useEffect, useId, useState } from 'react'
import { account, app, installUrl } from './account'
import { parseRepo, type RepoTarget } from './parse'
import { listRepos, type RepoList, readRecent } from './repos'
import { gh, tokenNow } from './session'

/** Rows shown at most: the filter finds the rest. */
const SHOWN = 50

/** The list for the token that read it: the dialog opens again without asking GitHub again. */
let cached: { token: string; list: Promise<RepoList> } | undefined

function listFor(token: string, via: 'app' | 'token'): Promise<RepoList> {
  if (cached?.token !== token) {
    const list = listRepos(gh, via)
    cached = { token, list }
    // a failure is tried again on the next open
    list.catch(() => {
      if (cached?.list === list) cached = undefined
    })
  }
  return cached.list
}

export interface RepoPickerProps {
  /** What the name field holds: the lists keep what matches it. */
  filter: string
  /** Something is being opened: the rows wait. */
  busy: boolean
  onPick: (t: RepoTarget) => void
}

export default function RepoPicker({ filter, busy, onPick }: RepoPickerProps) {
  const id = useId()
  const [recent] = useState(readRecent)
  const token = tokenNow()
  const [list, setList] = useState<RepoList>()
  const [error, setError] = useState('')
  const [picked, setPicked] = useState('')
  const via = account().via ?? 'token'
  useEffect(() => {
    if (!token) return
    let gone = false
    listFor(token, via).then(
      (l) => !gone && setList(l),
      (e: unknown) => !gone && setError(e instanceof Error ? e.message : 'GitHub did not list them.'),
    )
    return () => {
      gone = true
    }
  }, [token, via])
  // a pasted address narrows to the repository it names
  const typed = parseRepo(filter)
  const q = ('error' in typed ? filter.trim() : `${typed.owner}/${typed.name}`).toLowerCase()
  const matches = (owner: string, name: string) => !q || `${owner}/${name}`.toLowerCase().includes(q)
  const recentShown = recent.filter((r) => matches(r.owner, r.name))
  // a few hundred names at most: filtered on each draw
  const mineShown = list?.repos.filter((r) => matches(r.owner, r.name)) ?? []
  const row = (t: RepoTarget, note: string | undefined, key: string) => {
    const mine = busy && picked === key
    return (
      <li key={key}>
        <button
          type="button"
          aria-busy={mine}
          disabled={busy && !mine}
          onClick={() => {
            if (busy) return
            setPicked(key)
            onPick(t)
          }}
        >
          <span className="lmg-file">
            {t.owner}/{t.name}
          </span>
          {(mine || note) && <small>{mine ? 'Opening…' : note}</small>}
        </button>
      </li>
    )
  }
  return (
    <>
      {recentShown.length > 0 && (
        <>
          <p className="lmg-hint" id={`${id}r`}>
            Recent
          </p>
          <ul className="lmg-files" aria-labelledby={`${id}r`}>
            {recentShown.map((r) => row(r, r.path, `r:${r.owner}/${r.name}`))}
          </ul>
        </>
      )}
      {token && !list && !error && <p className="lmg-hint">Reading your repositories…</p>}
      {error && <p className="lmg-hint">{error}</p>}
      {list && (
        <>
          <p className="lmg-hint" id={`${id}m`}>
            Your repositories
          </p>
          <ul className="lmg-files" aria-labelledby={`${id}m`}>
            {mineShown.slice(0, SHOWN).map((r) => row(r, r.private ? 'private' : undefined, `m:${r.owner}/${r.name}`))}
            {mineShown.length === 0 && <li className="lmg-hint">No repository matches.</li>}
          </ul>
          {(mineShown.length > SHOWN || list.more) && (
            <p className="lmg-hint">More than these: type to narrow them, or the name of the one you want.</p>
          )}
          {via === 'app' && app && (
            <p className="lmg-hint">
              Not here?{' '}
              <a href={installUrl(app)} target="_blank" rel="noopener noreferrer">
                Choose repositories on GitHub ↗
              </a>
            </p>
          )}
        </>
      )}
    </>
  )
}
