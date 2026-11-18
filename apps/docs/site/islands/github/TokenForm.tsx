// A GitHub token, asked for in place when something needs one: a private repository, the hourly limit, a save. The
// reader makes it on GitHub's page (filled in by the link) and pastes it here; it stays in this tab.
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { takeToken, tokenPage } from './session'

const CSS = `
.lmg-token { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--lm-line); border-radius: 8px; background: var(--lm-bg); }
.lmg-token p { margin: 0; line-height: 1.45; }
.lmg-token ol { margin: 0; padding-left: 20px; display: grid; gap: 4px; line-height: 1.45; }
.lmg-token a { color: var(--lm-accent); }
.lmg-token code { font: .8rem var(--lm-mono); }
.lmg-token label.lmg-keep { display: flex; gap: 6px; align-items: center; font-size: .85rem; }
.lmg-token .lmg-row button { flex: none; }
`

export interface TokenFormProps {
  /** Why a token is asked for, in a sentence. */
  reason: string
  /** The repository's owner: GitHub's form starts there. */
  owner?: string
  need: 'read' | 'write'
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
  useEffect(() => input.current?.focus(), [])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const wrong = takeToken(value, keep)
    if (wrong) setError(wrong)
    else {
      setValue('')
      onToken()
    }
  }
  return (
    <form className="lmg-token" onSubmit={submit} aria-labelledby={`${id}r`}>
      <style>{CSS}</style>
      <p id={`${id}r`}>{reason}</p>
      <ol>
        <li>
          <a href={tokenPage(owner, need)} target="_blank" rel="noopener noreferrer">
            Make a token on GitHub ↗
          </a>{' '}
          (the form is filled in{need === 'write' ? ': Contents and Pull requests, read and write' : ''}).
        </li>
        <li>
          Under <b>Repository access</b>, pick <b>Only select repositories</b> and this repository.
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
        {onCancel && (
          <button type="button" className="lm-btn lme-quiet" onClick={onCancel}>
            Back
          </button>
        )}
      </div>
      <label className="lmg-keep">
        <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep it for this tab
      </label>
      {error && (
        <p className="lmg-error" role="alert">
          {error}
        </p>
      )}
      <p className="lmg-hint">
        The token goes to api.github.com only. It stays in this page{keep ? ', and in this tab until it closes' : ''}:
        never in a link, and never in this browser's lasting storage. A token for an organization's repository may wait
        for an owner's approval.
      </p>
    </form>
  )
}
