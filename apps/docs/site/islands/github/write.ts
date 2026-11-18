// Saving the reader's changes to the repository they came from, with no clone: one tree with the changed files in it
// (on the commit's own tree), one commit on the commit the files were read from, then a new branch at it (or the
// branch this tab made, moved on), and a pull request when the reader asks. Every call is the reader's, with their
// token, after they press Save.
import { type Client, filePath, GitHubError, repoApi, repoWeb } from './api'
import type { Change } from './changes'
import { goodRef } from './parse'
import type { RepoOrigin } from './tab'

export interface SaveRequest {
  /** A new branch, or the branch this tab made, moved on with one more commit. */
  branch: string
  onto: 'new' | 'same'
  message: string
  /** Open a pull request into the branch the files came from (a new branch only). */
  pull?: { title: string; body: string }
}

export interface Saved {
  branch: string
  commit: string
  tree: string
  /** The branch on GitHub, and where to open a pull request when none was. */
  url: string
  compare: string
  pull?: { number: number; url: string }
  /** The branch is saved, but GitHub would not open the pull request: why. */
  pullError?: string
}

/** The steps a save goes through, for the dialog to say where it is. */
export type SaveStep = 'tree' | 'commit' | 'branch' | 'pull'

/** Whether this save opens a pull request: asked for, on a new branch, into the branch the files came from. */
export const wantsPull = (origin: RepoOrigin, onto: SaveRequest['onto'], asked: boolean) =>
  asked && onto === 'new' && origin.pullable

/** What the reader saves: refused before any call when there is nothing to save or the branch is no branch name. */
export function saveProblem(list: Change[], r: SaveRequest): string | undefined {
  if (!list.length) return 'Nothing changed: there is nothing to save.'
  if (!goodRef(r.branch)) return `"${r.branch}" is not a branch name GitHub takes.`
  if (!r.message.trim()) return 'Say in the message what the change is.'
  return undefined
}

export async function save(
  gh: Client,
  origin: RepoOrigin,
  list: Change[],
  r: SaveRequest,
  step: (s: SaveStep) => void = () => {},
): Promise<Saved> {
  const wrong = saveProblem(list, r)
  if (wrong) throw new Error(wrong)
  const at = repoApi(origin)
  step('tree')
  const tree = await gh.json<{ sha: string }>(`${at}/git/trees`, {
    method: 'POST',
    body: {
      base_tree: origin.tree,
      // a file removed (or renamed away) is a path with no sha: gone from the tree
      tree: list.map((c) =>
        c.after === undefined
          ? { path: c.path, mode: '100644', type: 'blob', sha: null }
          : {
              path: c.path,
              mode: origin.exec.includes(c.path) ? '100755' : '100644',
              type: 'blob',
              // a file that came with "\r\n" goes back with it: the diff on GitHub shows only what the reader changed
              content: origin.crlf.includes(c.path) ? c.after.replace(/\n/g, '\r\n') : c.after,
            },
      ),
    },
  })
  step('commit')
  const commit = await gh.json<{ sha: string }>(`${at}/git/commits`, {
    method: 'POST',
    body: { message: r.message.trim(), tree: tree.sha, parents: [origin.sha] },
  })
  step('branch')
  if (r.onto === 'new')
    await gh.json(`${at}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${r.branch}`, sha: commit.sha } })
  else {
    // only forward: a branch someone else moved meanwhile is not overwritten
    try {
      await gh.json(`${at}/git/refs/heads/${filePath(r.branch)}`, {
        method: 'PATCH',
        body: { sha: commit.sha, force: false },
      })
    } catch (e) {
      if (e instanceof GitHubError && e.failure === 'invalid' && /does not exist/i.test(e.said))
        throw new GitHubError(
          `${r.branch} is no longer on GitHub (deleted once its pull request was merged?): save as a new branch.`,
          'conflict',
          422,
        )
      if (e instanceof GitHubError && e.failure === 'invalid' && /fast.?forward/i.test(e.said))
        throw new GitHubError(
          `${r.branch} moved on GitHub since the files were read: save as a new branch instead.`,
          'conflict',
          422,
        )
      throw e
    }
  }
  const branchUrl = `${repoWeb(origin)}/tree/${filePath(r.branch)}`
  const compare = `${repoWeb(origin)}/compare/${filePath(origin.base)}...${filePath(r.branch)}?expand=1`
  const saved: Saved = { branch: r.branch, commit: commit.sha, tree: tree.sha, url: branchUrl, compare }
  if (r.pull && wantsPull(origin, r.onto, true)) {
    step('pull')
    try {
      const pr = await gh.json<{ number: number; html_url: string }>(`${at}/pulls`, {
        method: 'POST',
        body: { title: r.pull.title, body: r.pull.body, head: r.branch, base: origin.base },
      })
      saved.pull = { number: pr.number, url: pr.html_url }
    } catch (e) {
      // the branch is there: the pull request can be opened on GitHub
      saved.pullError = e instanceof Error ? e.message : 'GitHub would not open the pull request.'
    }
  }
  return saved
}

/** A branch name for the reader's changes: the model's name, as a branch takes it. */
export function branchFor(path: string): string {
  const stem = (path.split('/').pop() ?? 'model').replace(/\.loadmap$/, '')
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `loadmap/${slug || 'model'}`
}

/** The commit message the dialog starts with: the files, as few words as they take. */
export function messageFor(list: Change[]): string {
  const name = (p: string) => p.split('/').pop() ?? p
  if (list.length === 1) {
    const c = list[0]!
    return `${c.kind === 'added' ? 'Add' : c.kind === 'removed' ? 'Remove' : 'Change'} ${name(c.path)}`
  }
  if (list.length <= 3) return `Change ${list.map((c) => name(c.path)).join(', ')}`
  return `Change ${list.length} .loadmap files`
}
