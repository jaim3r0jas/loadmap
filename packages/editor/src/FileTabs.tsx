import { type KeyboardEvent, useEffect, useRef } from 'react'
import { ICON, Icon } from './Menu'

/** The worst a file's problems are, for its mark on a tab and in the explorer. */
export type FileMark = 'error' | 'warning'

/** What a mark says to a reader who does not see it. */
export const MARK_TEXT = { error: 'has errors', warning: 'has warnings' } as const

/**
 * Each path's name as a tab or a problem shows it: the file's own name, with its folder in front only where two files
 * share the name.
 */
export function shortNames(paths: readonly string[]): Map<string, { folder: string; name: string }> {
  const count = new Map<string, number>()
  const nameOf = (p: string) => p.split('/').at(-1)!
  for (const p of paths) count.set(nameOf(p), (count.get(nameOf(p)) ?? 0) + 1)
  return new Map(
    paths.map((p) => {
      const name = nameOf(p)
      const clash = count.get(name)! > 1 && p.includes('/')
      return [p, { folder: clash ? p.slice(0, -name.length) : '', name }]
    }),
  )
}

/**
 * The files open in the editor, one row over the text: the model first, never closed; the others close with their ×
 * (or Delete) and stay files of the definition. One stop for Tab, the arrows, Home and End moving between the tabs.
 */
export function FileTabs({
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
}: {
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
}) {
  const list = useRef<HTMLDivElement>(null)
  const names = shortNames(all)
  // the open file's tab in view: a row with more tabs than room scrolls, it never wraps
  // biome-ignore lint/correctness/useExhaustiveDependencies: again when a tab is added or taken away
  useEffect(() => {
    list.current?.querySelector('[data-active]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active, open.length])
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
      // the keyboard stays on the row, on the tab it moved to
      requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
    } else if (e.key === 'Delete' && path !== entry) {
      e.preventDefault()
      onClose(path)
      requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
    }
  }
  return (
    <div className="lme-ftabs">
      <button
        type="button"
        className="lme-ftoggle"
        aria-label="Files"
        aria-pressed={explorer}
        title={explorer ? 'Hide the files' : 'Show the files'}
        onClick={onExplorer}
      >
        <Icon d={ICON.files} />
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
                  onClick={() => onClose(p)}
                >
                  <Icon d={ICON.x} />
                </button>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}
