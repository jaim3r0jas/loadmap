// A GitHub token, asked for in place when something needs one: a private repository, the hourly limit, a save. With
// the site's GitHub App (a build given one), "Sign in with GitHub" gets it in a popup; else, or as well, the reader
// makes one on GitHub's page (filled in by the link) and pastes it here. It stays in this tab.
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { takeToken, tokenPage } from './session'
import { installUrl, signIn, signInConfig } from './signin'

const APP = signInConfig()

const CSS = `
.lmg-token { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--lm-line); border-radius: 8px; background: var(--lm-bg); }
.lmg-token p { margin: 0; line-height: 1.45; }
.lmg-token ol { margin: 0; padding-left: 20px; display: grid; gap: 4px; line-height: 1.45; }
.lmg-token a { color: var(--lm-accent); }
.lmg-token code { font: .8rem var(--lm-mono); }
.lmg-token label.lmg-keep { display: flex; gap: 6px; align-items: center; font-size: .85rem; }
.lmg-token .lmg-row button { flex: none; }
.lmg-token details { display: grid; gap: 10px; }
.lmg-token details > summary { cursor: pointer; color: var(--lm-muted); font-size: .85rem; }
.lmg-token details[open] > summary { margin-bottom: 10px; }
.lmg-token .lmg-signin { justify-self: start; }
`

export interface TokenFormProps {
  /** Why a token is asked for, in a sentence. */
  reason: string
  /** The repository's owner: GitHub's form starts there. */
  owner?: string
  /** What the token must do: read a repository, write to it, or make a new one in the reader's account. */
  need: 'read' | 'write' | 'create'
  /** The token is in: try again. */
  onToken: () => void
  onCancel?: () => void
}

export default function TokenForm({ reason, owner, need, onToken, onCancel }: TokenFormProps) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const [keep, setKeep] = useState(false)
  const [error, setError] = useState('')
  const [signing, setSigning] = useState(false)
  const first = useRef<HTMLButtonElement>(null)
  // the app reaches the repositories it is installed on: a new one is not among them, so a new one takes a token
  const app = need === 'create' ? undefined : APP
  useEffect(() => (app ? first.current : input.current)?.focus(), [app])
  // a sign-in outlives a click: it reads "Keep" when the token comes, and does nothing once the form is gone (Back,
  // Close), so a save the reader backed out of never runs
  const kept = useRef(keep)
  kept.current = keep
  const here = useRef(true)
  useEffect(() => {
    here.current = true
    return () => {
      here.current = false
    }
  }, [])
  const signInNow = async () => {
    if (!app || signing) return
    setError('')
    setSigning(true)
    try {
      const token = await signIn(app)
      if (!here.current) return
      const wrong = takeToken(token, kept.current)
      if (wrong) setError(wrong)
      else onToken()
    } catch (e) {
      if (here.current) setError(e instanceof Error ? e.message : 'GitHub did not sign you in.')
    } finally {
      if (here.current) setSigning(false)
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const wrong = takeToken(value, keep)
    if (wrong) setError(wrong)
    else {
      setValue('')
      onToken()
    }
  }
  // a token made on GitHub's page, pasted: the way without the app, and beside it
  const paste = (
    <>
      <ol>
        <li>
          <a href={tokenPage(owner, need)} target="_blank" rel="noopener noreferrer">
            Make a token on GitHub ↗
          </a>{' '}
          (the form is filled in
          {need === 'write'
            ? ': Contents and Pull requests, read and write'
            : need === 'create'
              ? ': Administration and Contents, read and write'
              : ''}
          ).
        </li>
        <li>
          {need === 'create' ? (
            <>
              Under <b>Repository access</b>, pick <b>All repositories</b>: the new one is in no list yet.
            </>
          ) : (
            <>
              Under <b>Repository access</b>, pick <b>Only select repositories</b> and this repository.
            </>
          )}
        </li>
        <li>Generate it, copy it, and paste it here.</li>
      </ol>
      <label htmlFor={`${id}t`}>Token</label>
      <div className="lmg-row">
        <input
          id={`${id}t`}
          ref={input}
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="github_pat_…"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="lm-btn">
          Use it
        </button>
      </div>
    </>
  )
  return (
    <form className="lmg-token" onSubmit={submit} aria-labelledby={`${id}r`}>
      <style>{CSS}</style>
      <p id={`${id}r`}>{reason}</p>
      {app && (
        <>
          {/* it stays while the popup is open (aria-disabled): the keyboard is never dropped */}
          <button ref={first} type="button" className="lm-btn lmg-signin" aria-disabled={signing} onClick={signInNow}>
            {signing ? 'Signing in on GitHub…' : 'Sign in with GitHub'}
          </button>
          <p className="lmg-hint">
            The loadmap editor app reads and writes only the repositories it is installed on.{' '}
            <a href={installUrl(app)} target="_blank" rel="noopener noreferrer">
              Install it on {owner ? `${owner}'s` : 'a'} repository ↗
            </a>
          </p>
        </>
      )}
      {app ? (
        <details>
          <summary>Or paste a token</summary>
          {paste}
        </details>
      ) : (
        paste
      )}
      <label className="lmg-keep">
        <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep it for this tab
      </label>
      {error && (
        <p className="lmg-error" role="alert">
          {error}
        </p>
      )}
      <p className="lmg-hint">
        The token goes to api.github.com only
        {app ? ' (a sign-in gets it through the site’s sign-in service, which keeps nothing)' : ''}. It stays in this
        page
        {keep ? ', and in this tab until it closes' : ''}: never in a link, and never in this browser's lasting storage.
        A token for an organization's repository may wait for an owner's approval.
      </p>
      {/* outside the folded paste: the way back shows whichever way the token comes */}
      {onCancel && (
        <button type="button" className="lm-btn lme-quiet" style={{ justifySelf: 'start' }} onClick={onCancel}>
          Back
        </button>
      )}
    </form>
  )
}
