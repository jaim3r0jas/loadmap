// The bar's Connect to GitHub, when it needs a word with the reader: a build without the site's app (a token is
// pasted), a popup the browser blocked, or the reader's choice of a pasted token over the app.
import { useEffect, useId, useRef, useState } from 'react'
import { DIALOG_CSS, editorTheme } from './dialog'
import TokenForm from './TokenForm'

export interface ConnectDialogProps {
  /** Why it opened when the press alone did not connect: the popup was blocked, GitHub said no. */
  error?: string
  /** The pasted token's way open from the start. */
  paste?: boolean
  onClose: () => void
}

export default function ConnectDialog({ error, paste, onClose }: ConnectDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [theme] = useState(editorTheme)
  useEffect(() => dialog.current?.showModal(), [])
  return (
    <dialog ref={dialog} className="lm lmg-dialog" data-theme={theme} aria-labelledby={`${id}h`} onClose={onClose}>
      <style>{DIALOG_CSS}</style>
      <div className="lmg-head">
        <h2 id={`${id}h`}>Connect to GitHub</h2>
        <button type="button" className="lm-btn lme-quiet" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </div>
      <div className="lmg-body">
        {error && (
          <p className="lmg-error" role="alert">
            {error}
          </p>
        )}
        <TokenForm
          reason="Connected, the editor opens your repositories, saves to them and makes new ones."
          need="write"
          paste={paste}
          onToken={() => dialog.current?.close()}
        />
      </div>
    </dialog>
  )
}
