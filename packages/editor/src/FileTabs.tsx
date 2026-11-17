import { type KeyboardEvent, useEffect, useRef } from 'react'
import { FICON, type FileMark, MARK_TEXT, shortNames } from './filenames'
import { Icon } from './Menu'

/** The tabs' own rules: they come with them, when a definition has several files or the explorer shows. */
const CSS = `
.lme-ftoggle { flex: none; display: grid; place-items: center; width: 32px; padding: 0; color: var(--lm-muted); background: none; border: 0; border-right: 1px solid var(--lm-line); cursor: pointer; }
.lme-ftoggle:hover, .lme-ftoggle[aria-pressed="true"] { color: var(--lm-fg); }
.lme-ftoggle[aria-pressed="true"] { background: color-mix(in srgb, var(--lm-fg) 7%, transparent); }
.lme-ftablist { position: relative; flex: 1; display: flex; min-width: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.lme-ftablist::-webkit-scrollbar { display: none; }
.lme-ftab { flex: none; display: inline-flex; align-items: center; color: var(--lm-muted); border-right: 1px solid var(--lm-line); }
.lme-ftab:hover { color: var(--lm-fg); }
.lme-ftab[data-active] { color: var(--lm-fg); background: var(--lm-surface); box-shadow: inset 0 2px 0 var(--lm-accent); }
.lme-ftab [role="tab"] { display: inline-flex; align-items: center; gap: 6px; height: 100%; padding: 0 12px; font: 12px var(--lm-mono); color: inherit; white-space: nowrap; background: none; border: 0; cursor: pointer; }
.lme-ftab [role="tab"]:has(+ .lme-ftab-x) { padding-right: 4px; }
.lme-fdir { color: var(--lm-muted); margin-right: -6px; }
.lme-ftab-x { flex: none; display: grid; place-items: center; width: 18px; height: 18px; margin-right: 6px; padding: 0; color: var(--lm-muted); background: none; border: 0; border-radius: 4px; cursor: pointer; opacity: 0; }
.lme-ftab-x .lme-svg { width: 12px; height: 12px; }
.lme-ftab[data-active] .lme-ftab-x, .lme-ftab:hover .lme-ftab-x, .lme-ftab:focus-within .lme-ftab-x { opacity: 1; }
.lme-ftab-x:hover { color: var(--lm-fg); background: color-mix(in srgb, var(--lm-fg) 10%, transparent); }
.lme-ftabs button:focus-visible { outline: 2px solid var(--lm-accent); outline-offset: -2px; border-radius: 4px; }
.lme-fdot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--lm-warn); }
.lme-fdot[data-mark="error"] { background: var(--lm-drop); }
@media (pointer: coarse) { .lme-ftab-x { opacity: 1; } }
.lme[data-narrow] .lme-ftoggle { width: 44px; }
.lme[data-narrow] .lme-ftab [role="tab"] { font-size: 14px; }
.lme[data-narrow] .lme-ftab-x { width: 32px; height: 32px; margin-right: 2px; }
`

export interface FileTabsProps {
  /** The paths of the open files, in the order of their tabs. */
  open: readonly string[]
  /** Every file of the definition: two with one name show their folders. */
  all: readonly string[]
  active: string
  /** The model: its tab has no ×. */
  entry: string
  marks: ReadonlyMap<string, FileMark>
  /** The id of the element the tabs switch: the text. */
  panel: string
  explorer: boolean
  onExplorer: () => void
  onPick: (path: string) => void
  onClose: (path: string) => void
}

/**
 * The files open in the editor, one row over the text: the model first, never closed; the others close with their ×
 * (or Delete) and stay files of the definition. One stop for Tab, the arrows, Home and End moving between the tabs.
 */
export default function FileTabs({
  open,
  all,
  active,
  entry,
  marks,
  panel,
  explorer,
  onExplorer,
  onPick,
  onClose,
}: FileTabsProps) {
  const list = useRef<HTMLDivElement>(null)
  const names = shortNames(all)
  // the open file's tab in view: a row with more tabs than room scrolls, it never wraps
  // biome-ignore lint/correctness/useExhaustiveDependencies: again when a tab is added or taken away
  useEffect(() => {
    const row = list.current
    const tab = row?.querySelector<HTMLElement>('[data-active]')
    if (!row || !tab) return
    // the row alone scrolls: scrollIntoView would move the page under an editor further down it
    if (tab.offsetLeft < row.scrollLeft) row.scrollLeft = tab.offsetLeft
    else if (tab.offsetLeft + tab.offsetWidth > row.scrollLeft + row.clientWidth)
      row.scrollLeft = tab.offsetLeft + tab.offsetWidth - row.clientWidth
  }, [active, open.length])
  const refocus = () =>
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
  const keys = (e: KeyboardEvent, path: string) => {
    const i = open.indexOf(path)
    const to =
      e.key === 'ArrowRight'
        ? open[(i + 1) % open.length]
        : e.key === 'ArrowLeft'
          ? open[(i - 1 + open.length) % open.length]
          : e.key === 'Home'
            ? open[0]
            : e.key === 'End'
              ? open.at(-1)
              : undefined
    if (to != null) {
      e.preventDefault()
      onPick(to)
      refocus()
    } else if (e.key === 'Delete' && path !== entry) {
      e.preventDefault()
      onClose(path)
      refocus()
    }
  }
  return (
    <div className="lme-ftabs">
      <style>{CSS}</style>
      <button
        type="button"
        className="lme-ftoggle"
        aria-label="Files"
        aria-pressed={explorer}
        title={explorer ? 'Hide the files' : 'Show the files'}
        onClick={onExplorer}
      >
        <Icon d={FICON.files} />
      </button>
      <div className="lme-ftablist" role="tablist" aria-label="Open files" ref={list}>
        {open.map((p) => {
          const { folder, name } = names.get(p) ?? { folder: '', name: p }
          const mark = marks.get(p)
          const on = p === active
          return (
            <span key={p} role="presentation" className="lme-ftab" data-active={on || undefined}>
              <button
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={panel}
                tabIndex={on ? 0 : -1}
                title={p}
                onClick={() => onPick(p)}
                onKeyDown={(e) => keys(e, p)}
              >
                {folder && <span className="lme-fdir">{folder}</span>}
                {name}
                {mark && <span className="lme-fdot" data-mark={mark} role="img" aria-label={MARK_TEXT[mark]} />}
              </button>
              {p !== entry && (
                <button
                  type="button"
                  className="lme-ftab-x"
                  aria-label={`Close ${name}`}
                  title="Close (the file stays)"
                  tabIndex={-1}
                  onClick={() => {
                    onClose(p)
                    // the button goes with its tab: the keyboard goes to the tab that shows
                    refocus()
                  }}
                >
                  <Icon d={FICON.x} />
                </button>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}
