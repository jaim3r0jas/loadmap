// "Save to GitHub": the reader's changes as a commit on a new branch of the repository they came from (or one more
// commit on the branch this tab made), and a pull request when they ask. Nothing is written before they press Save;
// a token that may write is asked for in place.
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { GitHubError } from './api'
import type { Change } from './changes'
import type { Version } from './commits'
import { DIALOG_CSS, editorTheme } from './dialog'
import { gh, hasToken } from './session'
import TokenForm from './TokenForm'
import type { RepoOrigin } from './tab'
import { branchFor, messageFor, type Saved, type SaveStep, save, saveProblem, wantsPull } from './write'

const CSS = `${DIALOG_CSS}
.lmg-save { display: grid; gap: 12px; }
.lmg-save label.lmg-field { display: grid; gap: 4px; font-size: .85rem; }
.lmg-save textarea { min-height: 64px; resize: vertical; }
.lmg-save fieldset { display: grid; gap: 6px; margin: 0; padding: 0; border: 0; }
.lmg-save legend { margin-bottom: 4px; font-size: .85rem; }
.lmg-save .lmg-check { display: flex; gap: 6px; align-items: baseline; font-size: .85rem; }
.lmg-save .lmg-check code, .lmg-done code { font: .8rem var(--lm-mono); }
.lmg-files-said { margin: 0; padding-left: 18px; font: .8rem var(--lm-mono); color: var(--lm-muted); }
.lmg-steps { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; font-size: .85rem; }
.lmg-steps li[data-state="done"]::before { content: "✓ "; color: var(--lm-ok); }
.lmg-steps li[data-state="now"]::before { content: "… "; color: var(--lm-accent); }
.lmg-steps li[data-state="later"] { color: var(--lm-muted); }
.lmg-steps li[data-state="later"]::before { content: "· "; }
.lmg-done:focus { outline: none; }
.lmg-done { display: grid; gap: 8px; padding: 12px; border-left: 3px solid var(--lm-ok); background: color-mix(in srgb, var(--lm-ok) 8%, transparent); border-radius: 0 8px 8px 0; }
.lmg-done p { margin: 0; line-height: 1.45; }
.lmg-done a { color: var(--lm-accent); }
`

const STEPS: { step: SaveStep; text: string }[] = [
  { step: 'tree', text: 'Writing the files' },
  { step: 'commit', text: 'Making the commit' },
  { step: 'branch', text: 'Making the branch' },
  { step: 'pull', text: 'Opening the pull request' },
]
/** A save onto the branch this tab made moves it on: none is made. */
const MOVING = 'Moving the branch on'

/** A failure a token that may write would mend: none yet, a refused one, one without the permission or the reach. */
const writeMends = (e: unknown) =>
  e instanceof GitHubError && ['auth', 'forbidden', 'unseen', 'missing'].includes(e.failure)

export interface SaveDialogProps {
  origin: RepoOrigin
  /** The model's path now: the branch's name comes from it. */
  path: string
  list: Change[]
  onSaved: (saved: Saved) => void
  onClose: () => void
  /** The editor's versions since the files were opened (the last one the files as they are): each can be a commit. */
  versions?: readonly Version[]
}

export default function SaveDialog(props: SaveDialogProps) {
  // what the reader saves from, as it was when the dialog opened: a save moves the page's own on
  const [{ origin, path, list }] = useState(() => props)
  const { onSaved, onClose } = props
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [theme] = useState(editorTheme)
  const repo = `${origin.owner}/${origin.name}`
  const [onto, setOnto] = useState<'new' | 'same'>(origin.made ? 'same' : 'new')
  const [branch, setBranch] = useState(() => branchFor(path))
  const [message, setMessage] = useState(() => messageFor(list))
  const versions = props.versions
  const [each, setEach] = useState(() => (versions?.length ?? 0) > 1)
  const canPull = origin.pullable
  const [pull, setPull] = useState(canPull)
  // a token is asked for only when there is something to save
  const [ask, setAsk] = useState<string | null>(() =>
    hasToken() || !list.length ? null : `Saving writes to ${repo}: give a token that may write to it.`,
  )
  const [step, setStep] = useState<SaveStep | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<Saved | null>(null)
  useEffect(() => dialog.current?.showModal(), [])
  // the form goes once saved: the keyboard goes to what was saved
  const done = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (saved) done.current?.focus()
  }, [saved])

  // one place says whether a pull request is opened: the steps shown and the save agree
  const pulls = wantsPull(origin, onto, pull)
  const go = async () => {
    const target = onto === 'same' ? origin.ref : branch.trim()
    const request = {
      branch: target,
      onto,
      message,
      // every version its own commit, the last one with the message written here
      ...(each && versions?.length
        ? { versions: versions.map((v, i) => (i === versions.length - 1 ? { ...v, message } : v)) }
        : {}),
      ...(pulls
        ? {
            pull: {
              title: message.trim().split('\n')[0]!,
              body: `${message.trim().split('\n').slice(1).join('\n').trim()}\n\nMade in the loadmap editor.`.trim(),
            },
          }
        : {}),
    }
    const wrong = saveProblem(list, request)
    if (wrong) return setError(wrong)
    setError('')
    setStep('tree')
    try {
      const s = await save(gh, origin, list, request, setStep)
      setSaved(s)
      onSaved(s)
    } catch (e) {
      const said = e instanceof Error ? e.message : 'GitHub would not take the save. Try again.'
      if (writeMends(e)) setAsk(`${said} Saving needs a token that may write to ${repo}: Contents, read and write.`)
      else {
        setError(said)
        // the branch this tab made moved or is gone: a new one is what is left
        if (e instanceof GitHubError && e.failure === 'conflict') setOnto('new')
      }
    } finally {
      setStep(null)
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (step == null) void go()
  }

  const at = STEPS.findIndex((s) => s.step === step)
  return (
    <dialog ref={dialog} className="lm lmg-dialog" data-theme={theme} aria-labelledby={`${id}h`} onClose={onClose}>
      <style>{CSS}</style>
      <div className="lmg-head">
        <h2 id={`${id}h`}>Save to GitHub</h2>
        <button type="button" className="lm-btn lme-quiet" onClick={() => dialog.current?.close()}>
          {saved ? 'Done' : 'Cancel'}
        </button>
      </div>
      <div className="lmg-body">
        <div className="lmg-at">
          <b>{repo}</b>
          <code>
            from {origin.ref} · {origin.sha.slice(0, 7)}
          </code>
        </div>
        {saved ? (
          <div className="lmg-done" role="status" ref={done} tabIndex={-1}>
            <p>
              Saved as{' '}
              <a href={saved.url} target="_blank" rel="noopener noreferrer">
                <code>{saved.branch}</code> ↗
              </a>
              , commit <code>{saved.commit.slice(0, 7)}</code>.
            </p>
            {saved.pull ? (
              <p>
                <a href={saved.pull.url} target="_blank" rel="noopener noreferrer">
                  Pull request #{saved.pull.number} ↗
                </a>{' '}
                into <code>{origin.base}</code>.
              </p>
            ) : (
              onto === 'new' &&
              canPull && (
                <p>
                  {saved.pullError ? `${saved.pullError} ` : ''}
                  <a href={saved.compare} target="_blank" rel="noopener noreferrer">
                    Open a pull request on GitHub ↗
                  </a>
                </p>
              )
            )}
            <p className="lmg-hint">The next save adds a commit to this branch, or makes another.</p>
          </div>
        ) : !list.length ? (
          <p className="lmg-hint">Nothing changed since the files were opened: there is nothing to save.</p>
        ) : ask ? (
          <TokenForm
            reason={ask}
            owner={origin.owner}
            need="write"
            onToken={() => {
              setAsk(null)
              void go()
            }}
            onCancel={hasToken() ? () => setAsk(null) : undefined}
          />
        ) : (
          <form className="lmg-save" onSubmit={submit} aria-describedby={`${id}f`}>
            <p className="lmg-hint" id={`${id}f`}>
              {list.length} file{list.length === 1 ? '' : 's'} changed:
            </p>
            <ul className="lmg-files-said">
              {list.slice(0, 6).map((c) => (
                <li key={c.path}>
                  {c.path}
                  {c.kind === 'changed' ? '' : c.kind === 'added' ? ' (new)' : ' (removed)'}
                </li>
              ))}
              {list.length > 6 && <li>and {list.length - 6} more</li>}
            </ul>
            {origin.made && (
              <fieldset>
                <legend>Where</legend>
                <label className="lmg-check">
                  <input type="radio" name={`${id}o`} checked={onto === 'same'} onChange={() => setOnto('same')} />
                  <span>
                    One more commit on <code>{origin.ref}</code>
                  </span>
                </label>
                <label className="lmg-check">
                  <input type="radio" name={`${id}o`} checked={onto === 'new'} onChange={() => setOnto('new')} />
                  <span>A new branch</span>
                </label>
              </fieldset>
            )}
            {onto === 'new' && (
              <label className="lmg-field">
                New branch
                <input value={branch} onChange={(e) => setBranch(e.target.value)} spellCheck={false} />
              </label>
            )}
            {(versions?.length ?? 0) > 1 && (
              <label className="lmg-check">
                <input type="checkbox" checked={each} onChange={(e) => setEach(e.target.checked)} />
                <span>Every version from the Timeline as its own commit ({versions!.length})</span>
              </label>
            )}
            <label className="lmg-field">
              {each && (versions?.length ?? 0) > 1 ? 'Message of the last commit' : 'Message'}
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} />
            </label>
            {onto === 'new' && canPull && (
              <label className="lmg-check">
                <input type="checkbox" checked={pull} onChange={(e) => setPull(e.target.checked)} />
                <span>
                  Open a pull request into <code>{origin.base}</code>
                </span>
              </label>
            )}
            {step && (
              <ol className="lmg-steps" aria-live="polite">
                {STEPS.filter((s) => s.step !== 'pull' || pulls).map((s, i) => (
                  <li key={s.step} data-state={i < at ? 'done' : i === at ? 'now' : 'later'}>
                    {s.step === 'branch' && onto === 'same' ? MOVING : s.text}
                  </li>
                ))}
              </ol>
            )}
            <div className="lmg-row" style={{ justifyContent: 'flex-end' }}>
              {/* it stays while the save runs (aria-disabled): the keyboard is never dropped behind the dialog */}
              <button type="submit" className="lm-btn" aria-disabled={step != null}>
                {step ? 'Saving…' : 'Save to GitHub'}
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
