import { type ReactNode, useEffect, useRef, useState } from 'react'
import { MenuGroup } from './Menu'

/** The sheet's own rules: they come with it, not in the editor's first load. */
const CSS = `
.lme-actions { width: 100%; max-width: none; max-height: 85dvh; margin: auto 0 0; padding: 0; color: var(--lm-fg); background: var(--lm-surface); border: 0; border-radius: 16px 16px 0 0; box-shadow: 0 -6px 24px rgb(0 0 0 / .2); }
.lme-actions::backdrop { background: rgb(0 0 0 / .35); }
/* its padding on the body: a tap on the dialog itself is a tap on the dimmed page */
.lme-actions-body { display: grid; gap: 2px; padding: 8px calc(12px + env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) calc(12px + env(safe-area-inset-left)); }
.lme-actions-body > .lm-btn { width: 100%; min-height: 44px; margin-top: 8px; text-align: left; }
.lme-actions .lme-item { min-height: 44px; font-size: 1rem; }
.lme-actions .lme-mh { padding: 12px 10px 4px; }
.lme-page::after { content: "›" / ""; color: var(--lm-muted); }
.lme-back { font-weight: 600; border-bottom: 1px solid var(--lm-line); border-radius: 0; }
.lme-back::before { content: "‹ " / ""; }
`

/**
 * The actions that do not fit a phone's bar, in a sheet from the bottom, drawn when ⋯ opens it: modal (the keyboard
 * stays in it), closed by a pick, Escape, Close or a tap on the dimmed page, the focus back on ⋯. A page (the
 * templates) opens in its place, with Back. Its code and rules load with it, so a wide editor never loads them.
 */
export default function Actions({
  pages,
  onClose,
  children,
}: {
  pages: readonly { label: string; items: () => ReactNode }[]
  onClose: () => void
  children: ReactNode
}) {
  const sheet = useRef<HTMLDialogElement>(null)
  const [page, setPage] = useState<number | null>(null)
  const shown = page == null ? undefined : pages[page]
  const close = () => sheet.current?.close()
  useEffect(() => sheet.current?.showModal(), [])
  return (
    <>
      <style>{CSS}</style>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the buttons inside take the keyboard, and Escape closes it */}
      <dialog
        ref={sheet}
        className="lme-actions"
        aria-label={shown?.label ?? 'More'}
        // a pick closes it, a way to a page does not; a tap on the backdrop is a click on the dialog itself
        onClick={(e) => {
          const t = e.target as HTMLElement
          if (t === sheet.current || (t.closest('button') && !t.closest('[data-keep]'))) close()
        }}
        onClose={onClose}
        // a pick among radios (a page's theme) closes it too
        onChange={close}
      >
        <div className="lme-actions-body">
          {shown ? (
            <>
              <button type="button" className="lme-item lme-back" data-keep onClick={() => setPage(null)}>
                {shown.label}
              </button>
              {shown.items()}
            </>
          ) : (
            <>
              {pages.length > 0 && (
                <MenuGroup label="New">
                  {pages.map((p, i) => (
                    <button
                      key={p.label}
                      type="button"
                      className="lme-item lme-page"
                      data-keep
                      onClick={() => setPage(i)}
                    >
                      {p.label}
                    </button>
                  ))}
                </MenuGroup>
              )}
              {children}
            </>
          )}
          <button type="button" className="lm-btn">
            Close
          </button>
        </div>
      </dialog>
    </>
  )
}
