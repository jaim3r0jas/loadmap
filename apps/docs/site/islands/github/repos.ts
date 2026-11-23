// The reader's repositories, for Open from GitHub to pick from: the ones the site's app is installed on (through the
// app), or those a pasted token sees; and the ones this browser opened lately. Names only, read from GitHub when the
// dialog opens; the recent list is the one thing kept, in localStorage, and Disconnect forgets it.
import type { Client } from './api'

export interface RepoEntry {
  owner: string
  name: string
  private: boolean
  /** When it was last pushed to (ISO), for the order. */
  pushed?: string
}

interface GitHubRepo {
  name?: unknown
  owner?: { login?: unknown }
  private?: unknown
  pushed_at?: unknown
}

const entry = (r: GitHubRepo): RepoEntry | undefined =>
  typeof r.name === 'string' && typeof r.owner?.login === 'string'
    ? {
        owner: r.owner.login,
        name: r.name,
        private: r.private === true,
        ...(typeof r.pushed_at === 'string' && { pushed: r.pushed_at }),
      }
    : undefined

/** Pages GitHub answers at most, per list: a few hundred repositories, newest first, is enough to pick from. */
const PAGES = 3
const INSTALLATIONS = 5

export interface RepoList {
  repos: RepoEntry[]
  /** Some were left out: more than the pages read. */
  more: boolean
}

/** The repositories the reader may open: the app's installations' through the app, else what the token sees. */
export async function listRepos(gh: Client, via: 'app' | 'token'): Promise<RepoList> {
  const found = new Map<string, RepoEntry>()
  let more = false
  const add = (list: GitHubRepo[]) => {
    for (const r of list) {
      const e = entry(r)
      if (e) found.set(`${e.owner}/${e.name}`.toLowerCase(), e)
    }
  }
  if (via === 'app') {
    const { installations = [] } = await gh.json<{ installations?: { id?: unknown }[] }>(
      '/user/installations?per_page=100',
    )
    const ids = installations.map((i) => i.id).filter((id): id is number => typeof id === 'number')
    if (ids.length > INSTALLATIONS) more = true
    for (const id of ids.slice(0, INSTALLATIONS))
      for (let page = 1; page <= PAGES; page++) {
        const r = await gh.json<{ total_count?: unknown; repositories?: GitHubRepo[] }>(
          `/user/installations/${id}/repositories?per_page=100&page=${page}`,
        )
        add(r.repositories ?? [])
        const total = typeof r.total_count === 'number' ? r.total_count : 0
        if (page * 100 >= total) break
        if (page === PAGES) more = true
      }
  } else
    for (let page = 1; page <= PAGES; page++) {
      const list = await gh.json<GitHubRepo[]>(`/user/repos?sort=pushed&per_page=100&page=${page}`)
      add(list)
      if (list.length < 100) break
      if (page === PAGES) more = true
    }
  const repos = [...found.values()].sort((a, b) => (b.pushed ?? '').localeCompare(a.pushed ?? ''))
  return { repos, more }
}

const RECENT = 'loadmap-github-recent'
const NAME = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/

export interface Recent {
  owner: string
  name: string
  /** The model opened there. */
  path?: string
}

/** What this browser opened lately, newest first: names a GitHub could make, nothing else. */
export function readRecent(): Recent[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT) ?? '[]') as unknown
    if (!Array.isArray(list)) return []
    return list
      .filter(
        (r): r is Recent =>
          typeof r?.owner === 'string' &&
          typeof r?.name === 'string' &&
          NAME.test(`${r.owner}/${r.name}`) &&
          (r.path === undefined || (typeof r.path === 'string' && r.path.endsWith('.loadmap') && r.path.length < 300)),
      )
      .slice(0, 8)
  } catch {
    return []
  }
}

/** A repository opened: first in the list, once. */
export function noteRecent(r: Recent): void {
  const key = `${r.owner}/${r.name}`.toLowerCase()
  const rest = readRecent().filter((x) => `${x.owner}/${x.name}`.toLowerCase() !== key)
  try {
    localStorage.setItem(RECENT, JSON.stringify([r, ...rest].slice(0, 8)))
  } catch {
    // a convenience
  }
}

export function forgetRecent(): void {
  try {
    localStorage.removeItem(RECENT)
  } catch {
    // nothing kept
  }
}
