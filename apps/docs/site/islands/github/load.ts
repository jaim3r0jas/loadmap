// Opening a repository's model: the commit a ref names, pinned by its sha so every file comes from the same one; the
// `.loadmap` files of its tree; then the model and every file it reaches, read the way a host must (`imports()`: the
// head, then what it names). A repository is untrusted input: its paths go through `cleanPath`, and the limits of a
// definition (MAX_FILES, MAX_TOTAL) hold before a file is downloaded where the tree's sizes can tell.
import { imports } from '@loadmap/dsl'
import { MAX_FILES, MAX_TOTAL } from '@loadmap/dsl/internal'
import { type Client, filePath, GitHubError, repoApi } from './api'
import { cleanPath, type RepoTarget, refSplits } from './parse'

/** A `.loadmap` file of the tree, as GitHub lists it. */
export interface RepoFile {
  path: string
  /** Bytes; a text holds at most as many characters. */
  size: number
  /** Executable (100755): a save keeps it so. */
  exec?: true
}

/** A repository at one commit, and its `.loadmap` files. */
export interface Listing {
  owner: string
  name: string
  /** What the reader named (or the default branch): a save offers a pull request into it. */
  ref: string
  defaultBranch: string
  /** The ref is a branch (not a tag or a commit): a pull request can go into it. */
  branch: boolean
  /** The commit every file is read from, and its tree: a save starts from both. */
  sha: string
  tree: string
  private: boolean
  files: RepoFile[]
  /** GitHub cut the tree short: files past its limit are not listed. */
  truncated: boolean
  /** The file the reader named, when it is in the tree. */
  want?: string
  /** The folder a tree address named: the list starts there. */
  folder?: string
}

/** A model opened from a repository: the files the editor gets, the path of its model, and what it names in vain. */
export interface Opened {
  listing: Listing
  path: string
  /** Each file's text, its lines ending in "\n" as the editor keeps them. */
  files: Record<string, string>
  missing: string[]
  /** The files the commit holds with "\r\n": a save writes them back that way. */
  crlf: string[]
  /** The executable files (100755) among them. */
  exec: string[]
}

/** The files under the folder an address named, else all of them. */
export const inFolder = (l: Listing) => (l.folder ? l.files.filter((f) => f.path.startsWith(`${l.folder}/`)) : l.files)

const SHA = /^[0-9a-f]{40}$/
/** A file larger than this cannot fit MAX_TOTAL characters, whatever its encoding (UTF-8 is at most 4 bytes each). */
const MAX_BYTES = MAX_TOTAL * 4

const where = (t: { owner: string; name: string }) => `${t.owner}/${t.name}`
const repoPath = repoApi

/** The repository's commit and its `.loadmap` files. Throws an error whose message the reader can act on. */
export async function list(gh: Client, target: RepoTarget): Promise<Listing> {
  /** The commit a ref names; undefined when there is no such ref (an address's next split may be the one). */
  const commit = async (ref: string) => {
    let sha: string
    try {
      sha = (await gh.text(`${repoPath(target)}/commits/${filePath(ref)}`, 'application/vnd.github.sha')).trim()
    } catch (e) {
      if (e instanceof GitHubError && (e.failure === 'missing' || e.failure === 'invalid')) return undefined
      throw e
    }
    if (!SHA.test(sha)) throw new GitHubError(`GitHub answered no commit for "${ref}".`, 'other')
    return sha
  }
  // a ref named outright is looked up beside the repository: one round trip less before the first file
  const named = !target.rest && target.ref != null ? commit(target.ref) : undefined
  named?.catch(() => {})
  let info: { default_branch: string; private: boolean }
  try {
    info = await gh.json(repoPath(target))
  } catch (e) {
    if (e instanceof GitHubError && e.failure === 'missing')
      throw new GitHubError(
        gh.signed()
          ? `${where(target)} was not found, or your token may not read it.`
          : `${where(target)} was not found. If it is private, give a token to read it.`,
        'unseen',
        404,
      )
    throw e
  }
  const splits = target.rest
    ? refSplits(target.rest)
    : [{ ref: target.ref ?? info.default_branch, path: target.path ? target.path.split('/') : [] }]
  for (const [i, { ref, path }] of splits.entries()) {
    const sha = i === 0 && named ? await named : await commit(ref)
    if (!sha) continue
    const t = await gh.json<{
      sha: string
      truncated?: boolean
      tree: { path: string; mode: string; type: string; size?: number }[]
    }>(`${repoPath(target)}/git/trees/${sha}?recursive=1`)
    const files = t.tree
      // a symlink (120000) could point anywhere; a submodule is another repository
      .filter((e) => e.type === 'blob' && e.mode !== '120000' && cleanPath(e.path) === e.path)
      .map((e) => ({ path: e.path, size: e.size ?? 0, ...(e.mode === '100755' && { exec: true as const }) }))
      .sort((a, b) => a.path.localeCompare(b.path))
    const file = path.join('/')
    const kind = target.rest?.kind ?? (file ? 'blob' : 'tree')
    // a pull request goes into a branch: the default one is, another ref is asked about (a tag or a sha is not)
    const branch = ref === info.default_branch || (await isBranch(gh, target, ref))
    // past a cut tree, a file the reader names may be there all the same: open() asks for it
    return {
      owner: target.owner,
      name: target.name,
      ref,
      defaultBranch: info.default_branch,
      branch,
      sha,
      tree: t.sha,
      private: info.private,
      files,
      truncated: !!t.truncated,
      ...(kind === 'blob' && file && (files.some((f) => f.path === file) || (t.truncated && cleanPath(file) === file))
        ? { want: file }
        : {}),
      ...(kind === 'tree' && file ? { folder: file } : {}),
    }
  }
  const wanted = target.rest ? target.rest.segments.join('/') : (target.ref ?? info.default_branch)
  throw new GitHubError(`${where(target)} has no branch, tag or commit "${wanted}".`, 'missing', 404)
}

/** The model at `path` and every file it reaches, from the listing's commit. */
export async function open(gh: Client, listing: Listing, path: string): Promise<Opened> {
  const sizes = new Map(listing.files.map((f) => [f.path, f.size]))
  // a cut tree lists only some files: one it lacks may be there, and is asked for (its size is checked once read)
  const askable = (p: string) => sizes.has(p) || (listing.truncated && cleanPath(p) === p)
  if (!askable(path)) throw new Error(`${path} is not a .loadmap file of ${where(listing)}.`)
  const read = async (p: string): Promise<string | undefined> => {
    try {
      return await (listing.private
        ? gh.text(`${repoPath(listing)}/contents/${filePath(p)}?ref=${listing.sha}`, 'application/vnd.github.raw+json')
        : gh.raw(listing.owner, listing.name, listing.sha, p))
    } catch (e) {
      if (!sizes.has(p) && e instanceof GitHubError && e.failure === 'missing') return undefined
      throw e
    }
  }
  const files: Record<string, string> = {}
  const missing: string[] = []
  const crlf: string[] = []
  let total = 0
  let level = [path]
  while (level.length) {
    const fresh = [...new Set(level)].filter((p) => !Object.hasOwn(files, p) && !missing.includes(p))
    const known = fresh.filter(askable)
    missing.push(...fresh.filter((p) => !askable(p)))
    if (Object.keys(files).length + known.length > MAX_FILES)
      throw new Error(`The model reaches more than ${MAX_FILES} files; the editor opens at most ${MAX_FILES}.`)
    for (const p of known)
      if ((sizes.get(p) ?? 0) > MAX_BYTES)
        throw new Error(`${p} is larger than a definition may be (1,000,000 characters).`)
    const texts = await Promise.all(known.map(read))
    const next: string[] = []
    for (const [i, p] of known.entries()) {
      const text = texts[i]
      if (text === undefined) {
        missing.push(p)
        continue
      }
      total += text.length
      if (total > MAX_TOTAL)
        throw new Error('The files the model reaches hold more than 1,000,000 characters, more than a definition may.')
      // the editor ends lines in "\n": a file that came with "\r\n" would otherwise read as changed throughout
      const lf = text.includes('\r\n') ? text.replace(/\r\n/g, '\n') : text
      if (lf !== text) crlf.push(p)
      Object.defineProperty(files, p, { value: lf, enumerable: true, writable: true, configurable: true })
      for (const f of imports(text, p).files) if (f.path) next.push(f.path)
    }
    level = next
  }
  const exec = listing.files.filter((f) => f.exec && Object.hasOwn(files, f.path)).map((f) => f.path)
  return { listing, path, files, missing, crlf, exec }
}

/** Whether a ref is a branch of the repository. */
async function isBranch(gh: Client, r: { owner: string; name: string }, ref: string): Promise<boolean> {
  try {
    await gh.json(`${repoApi(r)}/branches/${filePath(ref)}`)
    return true
  } catch (e) {
    if (e instanceof GitHubError && e.failure === 'missing') return false
    throw e
  }
}
