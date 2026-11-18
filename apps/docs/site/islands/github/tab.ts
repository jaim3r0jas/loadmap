// What this tab opened from GitHub: the repository at its commit, the files as they came, and the files as they are
// now. It lives in sessionStorage (this tab only, gone with it), so a reload keeps the files and where they came from,
// and a private repository's text never reaches localStorage, where the reader's own draft lives. A private
// repository left with edits (another text took its place) is kept aside, one click away, as the draft is. No network
// here: the editor's page reads it before anything else loads.
import { cleanPath } from './parse'

/** Where the files came from: what a save starts from. */
export interface RepoOrigin {
  owner: string
  name: string
  ref: string
  /** The branch the files first came from: a pull request goes into it. */
  base: string
  /** The ref is a branch this tab saved: a save can add a commit to it. */
  made: boolean
  /** The commit the files were read from, and its tree. */
  sha: string
  tree: string
  private: boolean
  /** Every file as the commit holds it, by its path (lines ending in "\n"). */
  originals: Record<string, string>
  /** The model that was opened: what an undo of everything opens again. */
  model: string
  /** The files the commit holds with "\r\n" line endings. */
  crlf: string[]
}

export interface RepoTab {
  origin: RepoOrigin
  /** The model's path, and every file as the reader left it. */
  path: string
  files: Record<string, string>
}

const KEY = 'loadmap-editor-repo'
const ASIDE = 'loadmap-editor-repo-aside'

/**
 * As stored: the originals only where they differ from the files (a file the reader removed, or changed), so an
 * unchanged repository takes its room once.
 */
interface Stored {
  origin: Omit<RepoOrigin, 'originals'> & { paths: string[]; changed: Record<string, string> }
  path: string
  files: Record<string, string>
}

/** A file's text by its path, never a name every object has ("constructor"). */
export const own = (o: Readonly<Record<string, string>>, k: string) => (Object.hasOwn(o, k) ? o[k] : undefined)

const isFiles = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.entries(v).every(([p, t]) => typeof t === 'string' && cleanPath(p) === p)

function pack(t: RepoTab): Stored {
  const { originals, ...rest } = t.origin
  const changed: Record<string, string> = {}
  for (const [p, text] of Object.entries(originals)) if (own(t.files, p) !== text) changed[p] = text
  return { origin: { ...rest, paths: Object.keys(originals), changed }, path: t.path, files: t.files }
}

function unpack(raw: string | null): RepoTab | undefined {
  try {
    const t = JSON.parse(raw ?? 'null') as Partial<Stored> | null
    const o = t?.origin
    if (!t || !o || typeof t.path !== 'string' || !isFiles(t.files) || !Object.hasOwn(t.files, t.path)) return undefined
    for (const k of ['owner', 'name', 'ref', 'base', 'sha', 'tree', 'model'] as const)
      if (typeof o[k] !== 'string') return undefined
    if (typeof o.private !== 'boolean' || typeof o.made !== 'boolean' || !Array.isArray(o.paths) || !isFiles(o.changed))
      return undefined
    if (!Array.isArray(o.crlf) || !o.crlf.every((p) => typeof p === 'string')) return undefined
    const originals: Record<string, string> = {}
    for (const p of o.paths) {
      const text = typeof p === 'string' && cleanPath(p) === p ? (own(o.changed, p) ?? own(t.files, p)) : undefined
      if (text === undefined) return undefined
      originals[p] = text
    }
    const { paths: _, changed: __, ...origin } = o
    return { origin: { ...origin, originals } as RepoOrigin, path: t.path, files: t.files }
  } catch {
    return undefined
  }
}

function put(key: string, t: RepoTab | undefined): boolean {
  try {
    if (t) sessionStorage.setItem(key, JSON.stringify(pack(t)))
    else sessionStorage.removeItem(key)
    return true
  } catch {
    // full or refused: the files stay in the editor until the tab closes, and the page says so
    return false
  }
}

function get(key: string): RepoTab | undefined {
  try {
    return unpack(sessionStorage.getItem(key))
  } catch {
    return undefined
  }
}

/** This tab's repository, when it opened one and has not left it. */
export const readTab = () => get(KEY)

/** Keeps the tab's repository, or forgets it (`undefined`). False when the tab could not keep it. */
export const writeTab = (t: RepoTab | undefined) => put(KEY, t)

/** Whether the reader changed anything of what came. */
export function edited(t: RepoTab): boolean {
  const { originals } = t.origin
  const paths = Object.keys(t.files)
  return paths.length !== Object.keys(originals).length || paths.some((p) => own(originals, p) !== t.files[p])
}

/**
 * Another text takes the repository's place: a private one with edits is kept aside (it is in no draft), the tab
 * forgets the rest. True when something was kept aside.
 */
export function leave(t: RepoTab | undefined): boolean {
  const aside = !!t && t.origin.private && edited(t) && put(ASIDE, t)
  put(KEY, undefined)
  return aside
}

/** A private repository's files left with edits, one click away. */
export const readAside = () => get(ASIDE)
export const clearAside = () => put(ASIDE, undefined)
