// Open from GitHub's lists under the name field: what this browser opened lately, and, connected, the reader's
// repositories (the app's installations', or what a pasted token sees), newest first, narrowed by what is typed.
import { useEffect, useId, useState } from 'react'
import { account, app, installUrl } from './account'
import type { RepoTarget } from './parse'
import { listRepos, type RepoList, readRecent } from './repos'
import { gh, hasToken } from './session'

/** Rows shown at most: the filter finds the rest. */
const SHOWN = 50

export interface RepoPickerProps {
  /** What the name field holds: the lists keep what matches it. */
  filter: string
  /** A row is busy while its repository is looked at. */
  busy: string | null
  onPick: (t: RepoTarget) => void
}

export default function RepoPicker({ filter, busy, onPick }: RepoPickerProps) {
  const id = useId()
  const [recent] = useState(readRecent)
  const [mine, setMine] = useState<RepoList | 'reading' | { error: string } | undefined>(() =>
    hasToken() ? 'reading' : undefined,
  )
  const via = account().via ?? 'token'
  useEffect(() => {
    if (!hasToken()) return
    let gone = false
    listRepos(gh, via).then(
      (l) => !gone && setMine(l),
      (e: unknown) => !gone && setMine({ error: e instanceof Error ? e.message : 'GitHub did not list them.' }),
    )
    return () => {
      gone = true
    }
  }, [via])
  const q = filter.trim().toLowerCase()
  const matches = (owner: string, name: string) => !q || `${owner}/${name}`.toLowerCase().includes(q)
  const recentShown = recent.filter((r) => matches(r.owner, r.name))
  // a few hundred names at most: filtered on each draw
  const mineShown =
    mine && typeof mine === 'object' && 'repos' in mine ? mine.repos.filter((r) => matches(r.owner, r.name)) : []
  const row = (t: RepoTarget, note?: string) => {
    const at = `${t.owner}/${t.name}`
    return (
      <li key={`${at}:${t.path ?? ''}`}>
        <button type="button" aria-busy={busy === at} disabled={busy != null && busy !== at} onClick={() => onPick(t)}>
          <span className="lmg-file">{at}</span>
          {note && <small>{busy === at ? 'Opening…' : note}</small>}
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
            {recentShown.map((r) => row(r, r.path))}
          </ul>
        </>
      )}
      {mine === 'reading' && <p className="lmg-hint">Reading your repositories…</p>}
      {mine && typeof mine === 'object' && 'error' in mine && <p className="lmg-hint">{mine.error}</p>}
      {mine && typeof mine === 'object' && 'repos' in mine && (
        <>
          <p className="lmg-hint" id={`${id}m`}>
            Your repositories
          </p>
          <ul className="lmg-files" aria-labelledby={`${id}m`}>
            {mineShown.slice(0, SHOWN).map((r) => row(r, r.private ? 'private' : undefined))}
            {mineShown.length === 0 && <li className="lmg-hint">No repository matches.</li>}
          </ul>
          {(mineShown.length > SHOWN || mine.more) && (
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
