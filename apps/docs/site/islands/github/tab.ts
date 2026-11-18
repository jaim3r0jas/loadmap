// What this tab opened from GitHub: the repository at its commit, the files as they came, and the files as they are
// now. It lives in sessionStorage (this tab only, gone with it), so a reload keeps the files and where they came from,
// and a private repository's text never reaches localStorage, where the reader's own draft lives. No network here:
// the editor's page reads it before anything else loads.

/** Where the files came from: what a save starts from. */
export interface RepoOrigin {
  owner: string
  name: string
  ref: string
  /** The commit the files were read from, and its tree. */
  sha: string
  tree: string
  private: boolean
  /** Every file as the commit holds it, by its path. */
  originals: Record<string, string>
}

export interface RepoTab {
  origin: RepoOrigin
  /** The model's path, and every file as the reader left it. */
  path: string
  files: Record<string, string>
}

const KEY = 'loadmap-editor-repo'

const isTexts = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((t) => typeof t === 'string')

/** This tab's repository, when it opened one and has not left it. */
export function readTab(): RepoTab | undefined {
  try {
    const t = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Partial<RepoTab> | null
    const o = t?.origin as Partial<RepoOrigin> | undefined
    if (!t || !o || typeof t.path !== 'string' || !isTexts(t.files) || !Object.hasOwn(t.files, t.path)) return undefined
    for (const k of ['owner', 'name', 'ref', 'sha', 'tree'] as const) if (typeof o[k] !== 'string') return undefined
    if (typeof o.private !== 'boolean' || !isTexts(o.originals)) return undefined
    return t as RepoTab
  } catch {
    return undefined
  }
}

/** Keeps the tab's repository, or forgets it (`undefined`): another definition took its place. */
export function writeTab(t: RepoTab | undefined): void {
  try {
    if (t) sessionStorage.setItem(KEY, JSON.stringify(t))
    else sessionStorage.removeItem(KEY)
  } catch {
    // full or refused: the files stay in the editor until the tab closes
  }
}
