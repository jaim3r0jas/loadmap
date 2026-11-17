import type { Role } from '@loadmap/dsl'
import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { FICON, type FileMark, MARK_TEXT } from './filenames'
import {
  type Dsl,
  type FileChange,
  type FileSet,
  headOf,
  type NewKind,
  newFile,
  removeFile,
  renameFile,
  roleOf,
} from './fileops'
import { ICON, Icon, Menu, MenuItem } from './Menu'
import { type FileHost, reshape } from './reshape'

/** The explorer's own rules: they come with it, not in the editor's first load. */
const CSS = `
.lme-files { grid-column: 1; grid-row: 1 / 3; display: flex; flex-direction: column; box-sizing: border-box; width: 220px; min-height: 0; background: var(--lm-bg); border-right: 1px solid var(--lm-line); font: 400 12px/1.3 var(--lm-font); color: var(--lm-fg); }
.lme-files-head { flex: none; display: flex; align-items: center; gap: 2px; box-sizing: border-box; height: 30px; padding: 0 3px 0 10px; border-bottom: 1px solid var(--lm-line); }
.lme .lme-files-head h3 { flex: 1; margin: 0; font: 600 11px var(--lm-font); letter-spacing: .06em; text-transform: uppercase; color: var(--lm-muted); }
.lme-files .lm-btn.lme-icon { display: inline-grid; place-items: center; width: 24px; height: 24px; padding: 0; }
.lme-tree { flex: 1; min-height: 0; margin: 0; padding: 4px 0; overflow: auto; overscroll-behavior: contain; }
.lme-tree > div { position: relative; display: flex; align-items: center; min-height: 24px; }
.lme-tree-row { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; box-sizing: border-box; height: 24px; padding: 0 8px 0 calc(10px + var(--lme-depth) * 12px); cursor: pointer; white-space: nowrap; color: var(--lm-muted); }
.lme-tree-row[data-open] { color: var(--lm-fg); }
.lme-tree-row:hover { background: color-mix(in srgb, var(--lm-fg) 6%, transparent); }
.lme-tree-row[aria-selected="true"] { color: var(--lm-fg); background: var(--lm-accent-soft); box-shadow: inset 2px 0 0 var(--lm-accent); }
.lme-tree-row:focus { outline: none; }
.lme-tree-row:focus-visible { outline: 2px solid var(--lm-accent); outline-offset: -2px; }
.lme-tree-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-family: var(--lm-mono); }
.lme-tree-row[data-folder] .lme-tree-name { font-family: var(--lm-font); font-weight: 600; }
.lme-tree-fold { flex: none; width: 10px; height: 10px; margin-left: -2px; color: var(--lm-muted); transition: transform .1s; }
.lme-tree-row[aria-expanded="false"] .lme-tree-fold { transform: rotate(-90deg); }
.lme-tree-role { flex: none; margin-left: auto; font-size: 10.5px; color: var(--lm-muted); }
.lme-tree-acts { position: absolute; right: 3px; top: 0; bottom: 0; display: none; align-items: center; }
.lme-tree > div:hover .lme-tree-acts, .lme-tree > div:focus-within .lme-tree-acts { display: flex; }
/* the role makes room for them */
.lme-tree > div:hover .lme-tree-role, .lme-tree > div:focus-within .lme-tree-role { visibility: hidden; }
.lme-tree-ask, .lme-tree-field { flex: 1; min-width: 0; display: grid; gap: 4px; padding: 4px 8px 6px calc(10px + var(--lme-depth, 0) * 12px); }
.lme-tree-field input { box-sizing: border-box; width: 100%; height: 24px; padding: 0 6px; font: 12px var(--lm-mono); color: var(--lm-fg); background: var(--lm-surface); border: 1px solid var(--lm-accent); border-radius: 4px; outline: none; }
.lme-tree-field small { color: var(--lm-muted); white-space: normal; overflow-wrap: anywhere; }
.lme-tree-field small[role="alert"] { color: var(--lm-drop); }
.lme-tree-ask p { margin: 0; white-space: normal; overflow-wrap: anywhere; }
.lme-tree-ask span { display: flex; gap: 6px; }
.lme-tree-ask .lm-btn { height: 24px; padding: 0 8px; font-size: 12px; }
.lme-tree-ask .lme-danger { color: var(--lm-surface); background: var(--lm-drop); border-color: var(--lm-drop); }
@media (pointer: coarse) { .lme-tree-acts { display: flex; } .lme-tree-row { padding-right: 58px; } .lme-tree .lme-tree-role { visibility: visible; } }
/* a phone: the files over the text, each row a thumb high; a pick closes them */
.lme[data-narrow] .lme-files { position: absolute; inset: 0; z-index: 4; width: auto; border-right: 0; font-size: 15px; }
.lme[data-narrow] .lme-files-head { height: 44px; padding-right: 6px; }
.lme[data-narrow] .lme-files .lm-btn.lme-icon { width: 40px; height: 40px; }
.lme[data-narrow] .lme-tree > div { min-height: 44px; }
.lme[data-narrow] .lme-tree-row { height: 44px; padding-right: 96px; }
.lme[data-narrow] .lme-tree .lme-tree-role { font-size: 12px; visibility: visible; }
.lme[data-narrow] .lme-tree-acts { display: flex; }
.lme[data-narrow] .lme-tree-field input { height: 40px; font-size: 16px; }
.lme[data-narrow] .lme-tree-ask .lm-btn { height: 40px; padding: 0 14px; font-size: 15px; }
`

export interface ExplorerProps {
  /** What the file operations read of the language. */
  dsl: Dsl
  /** Every file as it is now: asked when the explorer draws and again when it changes one. */
  files: () => FileSet
  /** The file in the editor. */
  active: string
  /** The files with a tab. */
  open: readonly string[]
  marks: ReadonlyMap<string, FileMark>
  /** A new file to ask the name of as soon as the explorer shows (Add in the bar's menu). */
  start?: NewKind | null
  onStarted: () => void
  onOpen: (path: string) => void
  /** What an operation reaches of the editor. */
  host: FileHost
  onHide: () => void
}

type Row =
  | { folder: true; path: string; name: string; depth: number }
  | { folder?: false; path: string; name: string; depth: number }

/** What the reader is in the middle of: a name for a new file, another name for one, or the question before one goes. */
type Doing =
  | { what: 'new'; kind: NewKind; value: string; error?: string }
  | { what: 'rename'; path: string; value: string; error?: string }
  | { what: 'remove'; path: string }

const NEW: Record<NewKind, { label: string; hint: (base: string) => string; holder: string }> = {
  part: {
    label: 'A part of this model',
    holder: 'story, data, …',
    hint: (base) => `${base}.name.loadmap, included in the model`,
  },
  library: { label: 'A library', holder: 'platform', hint: () => 'name.loadmap, imported by the model' },
  variant: {
    label: 'A variant of this model',
    holder: 'big, cheap, …',
    hint: (base) => `${base}.name.loadmap, which extends the model`,
  },
}

/** The rows of the tree: in each folder its folders, then its files, the model first among them. */
function rowsOf(paths: readonly string[], entry: string, closed: ReadonlySet<string>): Row[] {
  const rows: Row[] = []
  const walk = (folder: string, depth: number) => {
    const inside = paths.filter((p) => p.startsWith(folder))
    const folders = [
      ...new Set(
        inside
          .map((p) => p.slice(folder.length))
          .filter((r) => r.includes('/'))
          .map((r) => r.split('/')[0]!),
      ),
    ]
    for (const name of folders.sort()) {
      const path = `${folder}${name}/`
      rows.push({ folder: true, path, name, depth })
      if (!closed.has(path)) walk(path, depth + 1)
    }
    const files = inside.filter((p) => !p.slice(folder.length).includes('/'))
    for (const path of files.sort((a, b) => Number(b === entry) - Number(a === entry) || a.localeCompare(b)))
      rows.push({ path, name: path.slice(folder.length), depth })
  }
  walk('', 0)
  return rows
}

/**
 * The files of the definition as a tree by folder: the model, its parts, the libraries it imports, its variants. A
 * click opens a file as a tab. New, rename and remove are edits of the texts (`fileops`): the line in the model's head
 * that names a file is written, follows or goes with it. ↑ ↓ move, Enter opens, F2 renames, Delete removes.
 */
export default function Explorer({
  dsl,
  files,
  active,
  open,
  marks,
  start,
  onStarted,
  onOpen,
  host,
  onHide,
}: ExplorerProps) {
  const all = files()
  const entry = all.path
  const paths = Object.keys(all.files)
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const [doing, setDoing] = useState<Doing | null>(null)
  const [cursor, setCursor] = useState(active)
  const tree = useRef<HTMLDivElement>(null)
  // each file's role, read from its head once per text
  const roles = useRef(new Map<string, { text: string; role: Role }>())
  const role = (path: string): Role => {
    // only the head says it: typing further down reads nothing again
    const text = headOf(all.files[path] ?? '')
    const kept = roles.current.get(path)
    if (kept?.text === text) return kept.role
    const r = roleOf(dsl, text, path)
    roles.current.set(path, { text, role: r })
    return r
  }
  const rows = rowsOf(paths, entry, closed)
  const at = rows.some((r) => r.path === cursor) ? cursor : (rows.find((r) => r.path === active)?.path ?? rows[0]?.path)
  const focusRow = (path: string | undefined) =>
    requestAnimationFrame(() => {
      const row = [...(tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].find(
        (el) => el.dataset.path === path,
      )
      ;(row ?? tree.current?.querySelector<HTMLElement>('[role="treeitem"]'))?.focus()
    })
  useEffect(() => {
    if (!start) return
    setDoing({ what: 'new', kind: start, value: '' })
    onStarted()
  }, [start, onStarted])

  const base = entry
    .split('/')
    .at(-1)!
    .replace(/\.loadmap$/, '')
  const done = (r: FileChange | { error: string }, then?: string) => {
    if ('error' in r) {
      setDoing((d) => (d && d.what !== 'remove' ? { ...d, error: r.error } : null))
      return
    }
    setDoing(null)
    reshape(host, r)
    const to = r.add?.path ?? r.rename?.to ?? then
    if (to) setCursor(to)
    // what held the keyboard is gone (a field, a button): it goes to the row the change left
    focusRow(to)
  }
  const commit = () => {
    if (!doing || doing.what === 'remove') return
    if (!doing.value.trim()) return cancel()
    if (doing.what === 'new') done(newFile(dsl, files(), doing.kind, doing.value))
    else {
      const r = renameFile(dsl, files(), doing.path, doing.value)
      // the name it has: nothing to do
      if (!('error' in r) && !r.rename) cancel()
      else done(r)
    }
  }
  const cancel = () => {
    const back = doing && doing.what !== 'new' ? doing.path : at
    setDoing(null)
    focusRow(back)
  }
  const toggle = (path: string) => {
    const next = new Set(closed)
    if (!next.delete(path)) next.add(path)
    setClosed(next)
  }
  const pick = (r: Row) => {
    setCursor(r.path)
    if (r.folder) toggle(r.path)
    else onOpen(r.path)
  }
  const keys = (e: KeyboardEvent, r: Row) => {
    const i = rows.indexOf(r)
    const move = (to: Row | undefined) => {
      if (!to) return
      e.preventDefault()
      setCursor(to.path)
      focusRow(to.path)
    }
    if (e.key === 'ArrowDown') move(rows[i + 1])
    else if (e.key === 'ArrowUp') move(rows[i - 1])
    else if (e.key === 'Home') move(rows[0])
    else if (e.key === 'End') move(rows.at(-1))
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(r)
    } else if (
      r.folder &&
      ((e.key === 'ArrowRight' && closed.has(r.path)) || (e.key === 'ArrowLeft' && !closed.has(r.path)))
    ) {
      e.preventDefault()
      toggle(r.path)
    } else if (!r.folder && e.key === 'F2') {
      e.preventDefault()
      setDoing({ what: 'rename', path: r.path, value: r.path.replace(/\.loadmap$/, '') })
    } else if (!r.folder && r.path !== entry && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault()
      setDoing({ what: 'remove', path: r.path })
    }
  }
  const field = (d: Exclude<Doing, { what: 'remove' }>, depth: number) => (
    <div key="field" role="none" style={{ '--lme-depth': depth } as CSSProperties}>
      <span className="lme-tree-field">
        <input
          type="text"
          // biome-ignore lint/a11y/noAutofocus: the reader asked for this field: the name is typed next
          autoFocus
          aria-label={d.what === 'new' ? `A name for ${NEW[d.kind].label.toLowerCase()}` : `A new name for ${d.path}`}
          aria-invalid={!!d.error}
          placeholder={d.what === 'new' ? NEW[d.kind].holder : undefined}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={d.value}
          onChange={(e) => setDoing({ ...d, value: e.target.value, error: undefined })}
          onFocus={(e) => d.what === 'rename' && e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') {
              e.stopPropagation()
              cancel()
            }
          }}
          // a click elsewhere leaves it: nothing is made of half a name
          onBlur={() => setDoing((now) => (now === d ? null : now))}
        />
        {d.error ? (
          <small role="alert">{d.error}</small>
        ) : (
          <small>{d.what === 'new' ? NEW[d.kind].hint(base) : 'Every line that names it follows.'}</small>
        )}
      </span>
    </div>
  )
  return (
    <div className="lme-files">
      <style>{CSS}</style>
      <div className="lme-files-head">
        <h3>Files</h3>
        <Menu label="New file" icon={<Icon d={FICON.plus} />} className="lme-quiet lme-icon" title="New file">
          {() =>
            (Object.keys(NEW) as NewKind[]).map((kind) => (
              <MenuItem key={kind} onSelect={() => setDoing({ what: 'new', kind, value: '' })}>
                {NEW[kind].label}
              </MenuItem>
            ))
          }
        </Menu>
        <button
          type="button"
          className="lm-btn lme-quiet lme-icon"
          aria-label="Hide the files"
          title="Hide the files"
          onClick={onHide}
        >
          <Icon d={FICON.x} />
        </button>
      </div>
      <div className="lme-tree" role="tree" aria-label="Files" ref={tree}>
        {doing?.what === 'new' && field(doing, 0)}
        {rows.map((r) => {
          const depth = { '--lme-depth': r.depth } as CSSProperties
          if (doing?.what === 'rename' && doing.path === r.path) return field(doing, r.depth)
          if (doing?.what === 'remove' && doing.path === r.path)
            return (
              <div key={r.path} role="none" style={depth}>
                <span className="lme-tree-ask">
                  <p>Remove {r.name}?</p>
                  <span>
                    <button
                      type="button"
                      className="lm-btn lme-danger"
                      // biome-ignore lint/a11y/noAutofocus: the question the reader just asked for; Escape takes it back
                      autoFocus
                      onKeyDown={(e) => e.key === 'Escape' && cancel()}
                      onClick={() => done(removeFile(dsl, files(), r.path), entry)}
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      className="lm-btn"
                      onKeyDown={(e) => e.key === 'Escape' && cancel()}
                      onClick={cancel}
                    >
                      Cancel
                    </button>
                  </span>
                </span>
              </div>
            )
          const mark = r.folder ? undefined : marks.get(r.path)
          const kind = r.folder ? undefined : role(r.path)
          return (
            <div key={r.path} role="none" style={depth}>
              <div
                className="lme-tree-row"
                role="treeitem"
                aria-level={r.depth + 1}
                aria-selected={!r.folder && r.path === active}
                aria-expanded={r.folder ? !closed.has(r.path) : undefined}
                data-path={r.path}
                data-folder={r.folder || undefined}
                data-open={(!r.folder && open.includes(r.path)) || undefined}
                tabIndex={r.path === at ? 0 : -1}
                title={r.folder ? undefined : r.path}
                onClick={() => pick(r)}
                onKeyDown={(e) => keys(e, r)}
              >
                {r.folder && <Icon d={ICON.down} className="lme-tree-fold" />}
                <span className="lme-tree-name">{r.name}</span>
                {mark && <span className="lme-fdot" data-mark={mark} role="img" aria-label={MARK_TEXT[mark]} />}
                {kind && <span className="lme-tree-role">{kind}</span>}
              </div>
              {!r.folder && (
                <span className="lme-tree-acts">
                  <button
                    type="button"
                    className="lm-btn lme-quiet lme-icon"
                    aria-label={`Rename ${r.name}`}
                    title="Rename (F2)"
                    tabIndex={-1}
                    onClick={() => setDoing({ what: 'rename', path: r.path, value: r.path.replace(/\.loadmap$/, '') })}
                  >
                    <Icon d={FICON.pencil} />
                  </button>
                  {r.path !== entry && (
                    <button
                      type="button"
                      className="lm-btn lme-quiet lme-icon"
                      aria-label={`Remove ${r.name}`}
                      title="Remove (Delete)"
                      tabIndex={-1}
                      onClick={() => setDoing({ what: 'remove', path: r.path })}
                    >
                      <Icon d={FICON.bin} />
                    </button>
                  )}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
