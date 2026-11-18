import { useEffect, useRef } from 'react'

/** The dialog's own rules: they come with it, not in the editor's first load. */
const CSS = `
.lme-keysheet { width: min(640px, calc(100vw - 32px)); max-height: min(80dvh, 720px); padding: 0; color: var(--lm-fg); background: var(--lm-surface); border: 1px solid var(--lm-line); border-radius: 12px; box-shadow: 0 12px 40px rgb(0 0 0 / .3); }
.lme-keysheet::backdrop { background: rgb(0 0 0 / .35); }
.lme-keysheet-body { display: grid; gap: 4px; padding: 16px 20px 20px; }
.lme-keysheet-head { position: sticky; top: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: -16px -20px 0; padding: 12px 20px; background: var(--lm-surface); border-bottom: 1px solid var(--lm-line); }
.lme-keysheet h2 { margin: 0; font: 700 1.05rem var(--lm-font); }
.lme-keysheet h3 { margin: 12px 0 2px; font: 700 .68rem var(--lm-font); letter-spacing: .07em; text-transform: uppercase; color: var(--lm-muted); }
.lme-keysheet dl { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 16px; margin: 0; }
.lme-keysheet dt { color: var(--lm-fg); }
.lme-keysheet dd { margin: 0; text-align: right; color: var(--lm-muted); }
.lme-keysheet kbd { display: inline-block; min-width: 1.6em; padding: 1px 6px; font: .85em var(--lm-mono); text-align: center; color: var(--lm-fg); background: var(--lm-bg); border: 1px solid var(--lm-line); border-radius: 4px; }
`

/** A key, as each platform writes it: on a Mac, then elsewhere. */
type Keys = readonly [mac: string, other: string]

/** What the editor's keys do, by what a reader wants to do. */
const GROUPS: readonly { title: string; rows: readonly (readonly [action: string, keys: Keys])[] }[] = [
  {
    title: 'Help with the language',
    rows: [
      ['What fits at the cursor', ['⌘I, ⌥I or ⌃Space', 'Ctrl+Space']],
      ['In the list: pick, take, close', ['↑ ↓, Enter, Esc', '↑ ↓, Enter, Esc']],
      ["A template's next field", ['Tab', 'Tab']],
      ['Go to where a name is declared', ['F12 or ⌘-click', 'F12 or Ctrl+click']],
      ['Rename a name everywhere', ['F2', 'F2']],
      ['Format the text', ['⇧⌥F', 'Shift+Alt+F']],
    ],
  },
  {
    title: 'Find',
    rows: [
      ['Find and replace', ['⌘F', 'Ctrl+F']],
      ['Next, previous match', ['⌘G, ⇧⌘G', 'F3, Shift+F3']],
      ['Select the next match too', ['⌘D', 'Ctrl+D']],
      ['Go to a line', ['⌥⌘G', 'Ctrl+Alt+G']],
    ],
  },
  {
    title: 'Edit',
    rows: [
      ['Undo, redo', ['⌘Z, ⇧⌘Z', 'Ctrl+Z, Ctrl+Y']],
      ['Comment or uncomment the lines', ['⌘/', 'Ctrl+/']],
      ['Move the line up or down', ['⌥↑, ⌥↓', 'Alt+↑, Alt+↓']],
      ['Copy the line up or down', ['⇧⌥↑, ⇧⌥↓', 'Shift+Alt+↑, Shift+Alt+↓']],
      ['Delete the line', ['⇧⌘K', 'Shift+Ctrl+K']],
      ['Indent, outdent', ['Tab, ⇧Tab', 'Tab, Shift+Tab']],
      ['A new line below', ['⌘Enter', 'Ctrl+Enter']],
      ['A cursor above or below too', ['⌥⌘↑, ⌥⌘↓', 'Ctrl+Alt+↑, Ctrl+Alt+↓']],
    ],
  },
  {
    title: 'Move and select',
    rows: [
      ['By word', ['⌥←, ⌥→', 'Ctrl+←, Ctrl+→']],
      ['To the start or end of the line', ['⌘←, ⌘→', 'Home, End']],
      ['To the start or end of the text', ['⌘↑, ⌘↓', 'Ctrl+Home, Ctrl+End']],
      ['Select as you move', ['⇧ with any of these', 'Shift with any of these']],
      ['Select the line', ['⌃L', 'Alt+L']],
      ['Select the block around', ['⌃⇧⌘→', 'Ctrl+I']],
      ['To the matching bracket', ['⇧⌘\\', 'Shift+Ctrl+\\']],
    ],
  },
  {
    title: 'Leave the text',
    rows: [
      ['Tab moves on, once', ['Esc, then Tab', 'Esc, then Tab']],
      ['Tab moves on, until pressed again', ['⇧⌥M', 'Ctrl+M']],
    ],
  },
]

/**
 * The editor's keys, for the platform it runs on: a modal dialog (the keyboard stays in it), closed by Close, Escape
 * or a click on the dimmed page. Its code and rules load with it.
 */
export default function Shortcuts({ mac, onClose }: { mac: boolean; onClose: () => void }) {
  const sheet = useRef<HTMLDialogElement>(null)
  useEffect(() => sheet.current?.showModal(), [])
  const close = () => sheet.current?.close()
  return (
    <>
      <style>{CSS}</style>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Close and Escape take the keyboard */}
      <dialog
        ref={sheet}
        className="lme-keysheet"
        aria-labelledby="lme-keysheet-title"
        // a click on the backdrop is a click on the dialog itself
        onClick={(e) => e.target === sheet.current && close()}
        onClose={onClose}
      >
        <div className="lme-keysheet-body">
          {/* Close first: the focus lands on it as the dialog opens, at the top of the list rather than its end */}
          <div className="lme-keysheet-head">
            <h2 id="lme-keysheet-title">Keyboard shortcuts</h2>
            <button type="button" className="lm-btn" onClick={close}>
              Close
            </button>
          </div>
          {GROUPS.map((g) => (
            <section key={g.title} aria-label={g.title}>
              <h3>{g.title}</h3>
              <dl>
                {g.rows.map(([action, keys]) => (
                  <div key={action} style={{ display: 'contents' }}>
                    <dt>{action}</dt>
                    <dd>
                      <kbd>{mac ? keys[0] : keys[1]}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </dialog>
    </>
  )
}
