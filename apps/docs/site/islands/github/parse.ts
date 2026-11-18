// What the reader names a repository by: `owner/name`, a github.com address (the repository, a folder or a file in
// it), or the editor's own query (`?repo=owner/name&ref=main&path=models/shop.loadmap`). Nothing here reaches the
// network: an address's ref and path stay one list of segments until GitHub says where the ref ends.

/** A repository, and what the reader named in it. */
export interface RepoTarget {
  owner: string
  name: string
  /** A branch, a tag or a commit; the repository's default branch when none. */
  ref?: string
  /** A `.loadmap` file from the repository's root: the model to open. */
  path?: string
  /**
   * An address's segments after `blob/` or `tree/`: a ref can hold "/", so where it ends and the path begins is for
   * GitHub to say (the loader tries the shortest ref first).
   */
  rest?: { kind: 'blob' | 'tree'; segments: string[] }
}

/** GitHub's own rules for an account's name: letters, digits and single dashes inside, 39 at most. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/
const NAME = /^[A-Za-z0-9._-]{1,100}$/
/** What `git check-ref-format` refuses, and what a query could smuggle: spaces, controls, `..`, `@{`. */
const BAD_REF = /[\s~^:?*[\\]|\.\.|@\{|\/\/|^[/.-]|[/.]$|\.lock$|^@$/

/** A control character: a name holding one is never one the reader meant. */
const control = (s: string) => [...s].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)

export function goodRef(ref: string): boolean {
  return ref.length > 0 && ref.length <= 255 && !BAD_REF.test(ref) && !control(ref)
}

/**
 * A `.loadmap` path from the repository's root as written, or undefined: no "./", "..", empty or hidden folders, no
 * "\", no control characters, nothing but `.loadmap` at the end. A repository is untrusted: its tree names are too.
 */
export function cleanPath(path: string): string | undefined {
  if (path.length > 1024 || !path.endsWith('.loadmap') || path.includes('\\') || control(path)) return undefined
  const segs = path.split('/')
  return segs.every((s) => s !== '' && s !== '.' && s !== '..') ? path : undefined
}

const repo = (owner: string, name: string): RepoTarget | { error: string } => {
  const n = name.replace(/\.git$/, '')
  if (!OWNER.test(owner) || !NAME.test(n) || n === '.' || n === '..')
    return { error: `"${owner}/${name}" is not a GitHub repository's name` }
  return { owner, name: n }
}

/** What the reader typed or pasted: `owner/name`, `github.com/owner/name/...`, `git@github.com:owner/name.git`. */
export function parseRepo(input: string): RepoTarget | { error: string } {
  const text = input.trim()
  if (!text) return { error: 'Name a repository: owner/name, or its address on GitHub' }
  const ssh = /^git@github\.com:([^/]+)\/([^/]+)$/.exec(text)
  if (ssh) return repo(ssh[1]!, ssh[2]!)
  const short = /^([^/:\s]+)\/([^/:\s]+)$/.exec(text)
  if (short && !short[1]!.includes('.')) return repo(short[1]!, short[2]!)
  let url: URL
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return { error: 'That is neither owner/name nor an address on GitHub' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'That is not an address on GitHub' }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com')
    return { error: 'Only repositories on github.com open here' }
  let segs: string[]
  try {
    segs = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return { error: 'That address does not read as a path on GitHub' }
  }
  if (segs.length < 2) return { error: 'The address names no repository: github.com/owner/name' }
  const r = repo(segs[0]!, segs[1]!)
  if ('error' in r) return r
  const kind = segs[2]
  if (kind === undefined) return r
  if ((kind !== 'blob' && kind !== 'tree') || segs.length < 4)
    return { error: 'Open the repository, a folder or a .loadmap file of it' }
  const segments = segs.slice(3)
  if (kind === 'blob' && (segments.length < 2 || !segments.at(-1)!.endsWith('.loadmap')))
    return { error: 'That file is not a .loadmap file' }
  return { ...r, rest: { kind, segments } }
}

/**
 * The editor's query: `repo` (owner/name or an address), `ref` and `path`. Undefined when the address names no
 * repository; an error when it names one badly.
 */
export function targetFromQuery(q: URLSearchParams): RepoTarget | { error: string } | undefined {
  const named = q.get('repo')
  if (named == null) return undefined
  const t = parseRepo(named)
  if ('error' in t) return t
  const ref = q.get('ref') ?? undefined
  const path = q.get('path') ?? undefined
  if (ref != null && !goodRef(ref)) return { error: `"${ref}" is not a branch, a tag or a commit` }
  if (path != null && cleanPath(path) == null) return { error: `"${path}" is not the path of a .loadmap file` }
  // what the query says outright wins over what an address left open
  return ref != null || path != null ? { owner: t.owner, name: t.name, ref, path } : t
}

/** The query that opens a repository's model in the editor: what the badge and "Copy link" write. */
export function repoQuery(t: { owner: string; name: string; ref?: string; path?: string }): string {
  const q = new URLSearchParams({ repo: `${t.owner}/${t.name}` })
  if (t.ref) q.set('ref', t.ref)
  if (t.path) q.set('path', t.path)
  return `?${q}`
}

/**
 * The ways an address's segments split into a ref and the rest, the shortest ref first. A tree address may name the
 * ref alone (the repository's root); a blob address keeps a file.
 */
export function refSplits(rest: NonNullable<RepoTarget['rest']>): { ref: string; path: string[] }[] {
  const out: { ref: string; path: string[] }[] = []
  const keep = rest.kind === 'blob' ? 1 : 0
  for (let i = 1; i <= rest.segments.length - keep; i++) {
    const ref = rest.segments.slice(0, i).join('/')
    if (goodRef(ref)) out.push({ ref, path: rest.segments.slice(i) })
  }
  return out
}
