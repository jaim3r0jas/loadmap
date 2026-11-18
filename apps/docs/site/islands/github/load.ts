// Opening a repository's model: the commit a ref names, pinned by its sha so every file comes from the same one; the
// `.loadmap` files of its tree; then the model and every file it reaches, read the way a host must (`imports()`: the
// head, then what it names). A repository is untrusted input: its paths go through `cleanPath`, and the limits of a
// definition (MAX_FILES, MAX_TOTAL) hold before a file is downloaded where the tree's sizes can tell.
import { imports } from '@loadmap/dsl'
import { MAX_FILES, MAX_TOTAL } from '@loadmap/dsl/internal'
import { type Client, filePath, GitHubError, seg } from './api'
import { cleanPath, type RepoTarget, refSplits } from './parse'

/** A `.loadmap` file of the tree, as GitHub lists it. */
export interface RepoFile {
  path: string
  /** Bytes; a text holds at most as many characters. */
  size: number
}

/** A repository at one commit, and its `.loadmap` files. */
export interface Listing {
  owner: string
  name: string
  /** What the reader named (or the default branch): a save offers a pull request into it. */
  ref: string
  defaultBranch: string
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
  files: Record<string, string>
  missing: string[]
}

const SHA = /^[0-9a-f]{40}$/
/** A file larger than this cannot fit MAX_TOTAL characters, whatever its encoding (UTF-8 is at most 4 bytes each). */
const MAX_BYTES = MAX_TOTAL * 4

const where = (t: { owner: string; name: string }) => `${t.owner}/${t.name}`
const repoPath = (t: { owner: string; name: string }) => `/repos/${seg(t.owner)}/${seg(t.name)}`

/** The repository's commit and its `.loadmap` files. Throws an error whose message the reader can act on. */
export async function list(gh: Client, target: RepoTarget): Promise<Listing> {
  let info: { default_branch: string; private: boolean }
  try {
    info = await gh.json(repoPath(target))
  } catch (e) {
    if (e instanceof GitHubError && e.failure === 'missing')
      throw new GitHubError(
        gh.signed()
          ? `${where(target)} was not found, or your token may not read it.`
          : `${where(target)} was not found. If it is private, give a token to read it.`,
        'missing',
        404,
      )
    throw e
  }
  const splits = target.rest
    ? refSplits(target.rest)
    : [{ ref: target.ref ?? info.default_branch, path: target.path ? target.path.split('/') : [] }]
  for (const { ref, path } of splits) {
    let sha: string
    try {
      sha = (await gh.text(`${repoPath(target)}/commits/${filePath(ref)}`, 'application/vnd.github.sha')).trim()
    } catch (e) {
      // a ref that is not there: an address's next split may be the one
      if (e instanceof GitHubError && (e.failure === 'missing' || e.failure === 'invalid')) continue
      throw e
    }
    if (!SHA.test(sha)) throw new GitHubError(`GitHub answered no commit for "${ref}".`, 'other')
    const t = await gh.json<{
      sha: string
      truncated?: boolean
      tree: { path: string; mode: string; type: string; size?: number }[]
    }>(`${repoPath(target)}/git/trees/${sha}?recursive=1`)
    const files = t.tree
      // a symlink (120000) could point anywhere; a submodule is another repository
      .filter((e) => e.type === 'blob' && e.mode !== '120000' && cleanPath(e.path) === e.path)
      .map((e) => ({ path: e.path, size: e.size ?? 0 }))
      .sort((a, b) => a.path.localeCompare(b.path))
    const named = path.join('/')
    const kind = target.rest?.kind ?? (named ? 'blob' : 'tree')
    return {
      owner: target.owner,
      name: target.name,
      ref,
      defaultBranch: info.default_branch,
      sha,
      tree: t.sha,
      private: info.private,
      files,
      truncated: !!t.truncated,
      ...(kind === 'blob' && named && files.some((f) => f.path === named) ? { want: named } : {}),
      ...(kind === 'tree' && named ? { folder: named } : {}),
    }
  }
  const named = target.rest ? target.rest.segments.join('/') : (target.ref ?? info.default_branch)
  throw new GitHubError(`${where(target)} has no branch, tag or commit "${named}".`, 'missing', 404)
}

/** The model at `path` and every file it reaches, from the listing's commit. */
export async function open(gh: Client, listing: Listing, path: string): Promise<Opened> {
  const sizes = new Map(listing.files.map((f) => [f.path, f.size]))
  if (!sizes.has(path)) throw new Error(`${path} is not a .loadmap file of ${where(listing)}.`)
  const read = (p: string) =>
    listing.private
      ? gh.text(`${repoPath(listing)}/contents/${filePath(p)}?ref=${listing.sha}`, 'application/vnd.github.raw+json')
      : gh.raw(listing.owner, listing.name, listing.sha, p)
  const files: Record<string, string> = {}
  const missing: string[] = []
  let total = 0
  let level = [path]
  while (level.length) {
    const fresh = [...new Set(level)].filter((p) => !Object.hasOwn(files, p) && !missing.includes(p))
    const known = fresh.filter((p) => sizes.has(p))
    missing.push(...fresh.filter((p) => !sizes.has(p)))
    if (Object.keys(files).length + known.length > MAX_FILES)
      throw new Error(`The model reaches more than ${MAX_FILES} files; the editor opens at most ${MAX_FILES}.`)
    for (const p of known)
      if (sizes.get(p)! > MAX_BYTES) throw new Error(`${p} is larger than a definition may be (1,000,000 characters).`)
    const texts = await Promise.all(known.map(read))
    const next: string[] = []
    for (const [i, p] of known.entries()) {
      const text = texts[i]!
      total += text.length
      if (total > MAX_TOTAL)
        throw new Error('The files the model reaches hold more than 1,000,000 characters, more than a definition may.')
      Object.defineProperty(files, p, { value: text, enumerable: true, writable: true, configurable: true })
      for (const f of imports(text, p).files) if (f.path) next.push(f.path)
    }
    level = next
  }
  return { listing, path, files, missing }
}
