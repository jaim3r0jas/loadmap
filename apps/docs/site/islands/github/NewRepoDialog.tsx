// "Save to a new repository": a repository made in the reader's own GitHub account (private unless they choose
// public), then every version of the editor's history pushed to it as its own commit. Every call is the reader's, with
// their token, after they press Create.
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { GitHubError } from './api'
import { createRepo, type Made, RepoMade, type Version } from './commits'
import { DIALOG_CSS, editorTheme } from './dialog'
import { gh, hasToken } from './session'
import TokenForm from './TokenForm'

export interface NewRepoDialogProps {
  /** The versions to push, oldest first: the history's, or the files as they are when there is none. */
  versions: readonly Version[]
  /** A name to start from: the model's. */
  name: string
  onClose: () => void
}

export default function NewRepoDialog({ versions, name: start, onClose }: NewRepoDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [theme] = useState(editorTheme)
  const [name, setName] = useState(start)
  const [shut, setShut] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [made, setMade] = useState<Made | null>(null)
  /** A repository an earlier press made, its versions not written: the next press writes them there. */
  const [half, setHalf] = useState<Made | null>(null)
  const [ask, setAsk] = useState<string | null>(() =>
    hasToken() ? null : 'Making a repository in your account needs a token that may create one.',
  )
  useEffect(() => dialog.current?.showModal(), [])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError('')
    try {
      const r = await createRepo(
        gh,
        { name: name.trim(), private: shut },
        versions,
        (s, n) =>
          setBusy(
            s === 'repo'
              ? 'Making the repository…'
              : s === 'commits'
                ? `Writing the versions (${n ?? 0} of ${versions.length})…`
                : 'Moving the branch…',
          ),
        500,
        half ?? undefined,
      )
      setHalf(null)
      setMade(r)
    } catch (err) {
      if (err instanceof RepoMade) setHalf(err.made)
      const cause = err instanceof RepoMade ? err.cause : err
      // a token refused, or without the right: the form for another, saying why; anything else as it is
      if (cause instanceof GitHubError && ['auth', 'forbidden'].includes(cause.failure))
        setAsk(
          `${(err as Error).message} Making a repository needs a token with Administration and Contents, read and write, on all repositories.`,
        )
      else setError((err as Error).message)
    } finally {
      setBusy('')
    }
  }

  return (
    <dialog ref={dialog} className="lm lmg-dialog" data-theme={theme} aria-labelledby={`${id}h`} onClose={onClose}>
      <style>{DIALOG_CSS}</style>
      <div className="lmg-head">
        <h2 id={`${id}h`}>Save to a new repository</h2>
        <button type="button" className="lm-btn lme-quiet" onClick={() => dialog.current?.close()}>
          {made ? 'Done' : 'Cancel'}
        </button>
      </div>
      <div className="lmg-body">
        {made ? (
          <p role="status">
            Made{' '}
            <a href={made.url} target="_blank" rel="noopener noreferrer">
              {made.owner}/{made.name} ↗
            </a>{' '}
            with {versions.length} commit{versions.length === 1 ? '' : 's'}. Open it from GitHub to keep saving there.
          </p>
        ) : ask ? (
          <TokenForm reason={ask} need="create" onToken={() => setAsk(null)} onCancel={() => dialog.current?.close()} />
        ) : (
          <form className="lmg-save" onSubmit={create}>
            {half ? (
              <p className="lmg-hint">
                {half.owner}/{half.name} is made: pressing again writes the versions to it.
              </p>
            ) : (
              <>
                <label className="lmg-field">
                  Name
                  <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
                </label>
                <label className="lmg-check">
                  <input type="checkbox" checked={shut} onChange={(e) => setShut(e.target.checked)} />
                  <span>Private: only you, and who you invite, can see it</span>
                </label>
              </>
            )}
            <p className="lmg-hint">
              {versions.length} version{versions.length === 1 ? '' : 's'}, each its own commit, after a README.
            </p>
            {busy && <p aria-live="polite">{busy}</p>}
            <div className="lmg-row" style={{ justifyContent: 'flex-end' }}>
              <button type="submit" className="lm-btn" aria-disabled={!!busy}>
                {busy ? 'Making…' : half ? 'Write the versions' : 'Make the repository'}
              </button>
            </div>
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
