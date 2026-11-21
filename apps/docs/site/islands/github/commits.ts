// The editor's history as commits on GitHub: the versions made since the files were opened, each one a commit with
// its own message (an assistant's with "Assisted-by:"), in order, then the branch moved once. Every call is the
// reader's, with their token, after they press Save. A new repository in the reader's account starts the same way.
import type { HistoryData } from '@loadmap/editor'
import { type Client, filePath, repoApi } from './api'

/** A version to push: its message and every file as it holds them. */
export interface Version {
  message: string
  files: Record<string, string>
}

/**
 * The versions of the branch the files are on, oldest first, after the newest one whose files are `originals` (the
 * files as the repository has them): none when no version matches, and the caller squashes instead.
 */
export function versionsSince(h: HistoryData, originals: Readonly<Record<string, string>>): Version[] | undefined {
  const line = lineOf(h)
  const base = line.findIndex((c) => sameFiles(toVersion(h, c).files, originals))
  if (base < 0) return undefined
  return line
    .slice(0, base)
    .reverse()
    .map((c) => toVersion(h, c))
}

/** Two sets of files with the same paths and the same text. */
export function sameFiles(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const paths = Object.keys(a)
  return paths.length === Object.keys(b).length && paths.every((p) => Object.hasOwn(b, p) && a[p] === b[p])
}

/** The versions, then the files as they are now when they are not the last one's (or `base`'s, with none). */
export function endingWith(
  versions: readonly Version[],
  live: Readonly<Record<string, string>>,
  base: Readonly<Record<string, string>> | null,
  message = 'Edited',
): Version[] {
  const last = versions.at(-1)?.files ?? base
  return last && sameFiles(live, last) ? [...versions] : [...versions, { message, files: { ...live } }]
}

type Stored = HistoryData['commits'][string]

/** The branch's commits, newest first. */
function lineOf(h: HistoryData): Stored[] {
  const line: Stored[] = []
  const seen = new Set<string>()
  for (let id = h.branches.find((b) => b.name === h.branch)?.head; id && !seen.has(id); ) {
    seen.add(id)
    const c = h.commits[id]
    if (!c) break
    line.push(c)
    id = c.parent ?? undefined
  }
  return line
}

/** A commit as a version to push: an assistant's message says so, with the model. */
function toVersion(h: HistoryData, c: Stored): Version {
  return {
    message: c.author === 'assistant' && c.trace ? `${c.message}\n\nAssisted-by: ${c.trace.model}` : c.message,
    files: Object.fromEntries(Object.entries(c.files).map(([p, b]) => [p, h.blobs[b] ?? ''])),
  }
}

/** Every version of the branch the files are on, oldest first: what a new repository starts with. */
export function allVersions(h: HistoryData): Version[] {
  return lineOf(h)
    .reverse()
    .map((c) => toVersion(h, c))
}

/**
 * One commit per version on `parent`, each tree written from the one before (a file gone is a path with no sha); a
 * version that changes no file (the model's path alone) makes none. Resolves to the last commit and its tree; the
 * caller moves the branch.
 */
export async function commitVersions(
  gh: Client,
  repo: { owner: string; name: string },
  start: { commit: string; tree: string; files: Readonly<Record<string, string>> },
  versions: readonly Version[],
  step: (done: number) => void = () => {},
  /** Files the repository has with "\r\n" or as executables: each commit keeps them so. */
  keep: { crlf?: readonly string[]; exec?: readonly string[] } = {},
): Promise<{ commit: string; tree: string }> {
  const at = repoApi(repo)
  let parent = start.commit
  let tree = start.tree
  let before: Readonly<Record<string, string>> = start.files
  for (const [i, v] of versions.entries()) {
    const paths = new Set([...Object.keys(before), ...Object.keys(v.files)])
    const entries = [...paths]
      .filter((p) => before[p] !== v.files[p])
      .map((p) =>
        v.files[p] === undefined
          ? { path: p, mode: '100644', type: 'blob', sha: null }
          : {
              path: p,
              mode: keep.exec?.includes(p) ? '100755' : '100644',
              type: 'blob',
              content: keep.crlf?.includes(p) ? v.files[p]!.replace(/\n/g, '\r\n') : v.files[p],
            },
      )
    if (!entries.length) {
      step(i + 1)
      continue
    }
    tree = (
      await gh.json<{ sha: string }>(`${at}/git/trees`, { method: 'POST', body: { base_tree: tree, tree: entries } })
    ).sha
    parent = (
      await gh.json<{ sha: string }>(`${at}/git/commits`, {
        method: 'POST',
        body: { message: v.message.trim() || 'Edited', tree, parents: [parent] },
      })
    ).sha
    before = v.files
    step(i + 1)
  }
  return { commit: parent, tree }
}

/** The sha of a branch's commit and its tree. */
async function headOf(gh: Client, repo: { owner: string; name: string }, branch: string) {
  const at = repoApi(repo)
  const ref = await gh.json<{ object: { sha: string } }>(`${at}/git/ref/heads/${filePath(branch)}`)
  const commit = await gh.json<{ tree: { sha: string } }>(`${at}/git/commits/${ref.object.sha}`)
  return { commit: ref.object.sha, tree: commit.tree.sha }
}

/** The branch's first commit: GitHub writes the README a moment after it answers that the repository is made. */
async function firstHead(gh: Client, repo: { owner: string; name: string }, branch: string, wait = 500) {
  for (let i = 0; ; i++) {
    try {
      return await headOf(gh, repo, branch)
    } catch (err) {
      if (i >= 5) throw err
      await new Promise((r) => setTimeout(r, wait * (i + 1)))
    }
  }
}

/** A repository made whose versions were not all written: pressing again writes them to it, without making another. */
export class RepoMade extends Error {
  constructor(
    message: string,
    readonly made: Made,
    override readonly cause: unknown,
  ) {
    super(message)
  }
}

export interface Made {
  owner: string
  name: string
  url: string
  branch: string
}

export interface NewRepo {
  name: string
  private: boolean
  description?: string
}

/**
 * A new repository in the reader's own account, then every version as a commit on its main branch. It starts with a
 * README (GitHub's git API refuses an empty repository), and the versions follow it.
 */
export async function createRepo(
  gh: Client,
  r: NewRepo,
  versions: readonly Version[],
  step: (s: 'repo' | 'commits' | 'branch', done?: number) => void = () => {},
  /** Milliseconds between reads of the new branch, more each time: 0 in a test. */
  wait = 500,
  /** The repository an earlier press made: the versions go there, and no other is made. */
  resume?: Made,
): Promise<Made> {
  if (!resume && !/^[A-Za-z0-9._-]{1,100}$/.test(r.name))
    throw new Error('A repository name is letters, digits, ".", "-" and "_".')
  let made = resume
  if (!made) {
    step('repo')
    const m = await gh.json<{ name: string; owner: { login: string }; html_url: string; default_branch: string }>(
      '/user/repos',
      {
        method: 'POST',
        body: {
          name: r.name,
          private: r.private,
          description: r.description ?? 'A loadmap model, made in the loadmap editor.',
          auto_init: true,
        },
      },
    )
    made = { owner: m.owner.login, name: m.name, url: m.html_url, branch: m.default_branch || 'main' }
  }
  const repo = { owner: made.owner, name: made.name }
  try {
    // the branch moves only at the end: until then it holds the README alone, and a second press starts from it
    const start = await firstHead(gh, repo, made.branch, wait)
    step('commits', 0)
    const last = await commitVersions(gh, repo, { ...start, files: {} }, versions, (n) => step('commits', n))
    step('branch')
    await gh.json(`${repoApi(repo)}/git/refs/heads/${filePath(made.branch)}`, {
      method: 'PATCH',
      body: { sha: last.commit, force: false },
    })
  } catch (err) {
    throw new RepoMade(
      `${made.owner}/${made.name} was made, but its versions were not written: ${(err as Error).message}`,
      made,
      err,
    )
  }
  return made
}
