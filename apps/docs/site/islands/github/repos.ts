// The reader's repositories, for Open from GitHub to pick from: the ones the site's app is installed on (through the
// app), or those a pasted token sees; and the ones this browser opened lately. Names only, read from GitHub when the
// dialog opens; the recent list is the one thing kept, in localStorage, and Disconnect forgets it.
import type { Client } from './api'
import { cleanPath, goodRef, goodRepo } from './parse'

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
    // the installations side by side, each one's pages in turn; GitHub lists them in its own order, not by push
    const pages = await Promise.all(
      ids.slice(0, INSTALLATIONS).map(async (id) => {
        const lists: GitHubRepo[][] = []
        for (let page = 1; page <= PAGES; page++) {
          const r = await gh.json<{ total_count?: unknown; repositories?: GitHubRepo[] }>(
            `/user/installations/${id}/repositories?per_page=100&page=${page}`,
          )
          lists.push(r.repositories ?? [])
          const total = typeof r.total_count === 'number' ? r.total_count : 0
          if (page * 100 >= total) return { lists, more: false }
        }
        return { lists, more: true }
      }),
    )
    for (const p of pages) {
      for (const l of p.lists) add(l)
      if (p.more) more = true
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

export interface Recent {
  owner: string
  name: string
  /** The branch, tag or commit it was opened at. */
  ref?: string
  /** The model opened there. */
  path?: string
}

function storage(where: 'local' | 'session'): Storage | undefined {
  try {
    return where === 'local' ? localStorage : sessionStorage
  } catch {
    return undefined
  }
}

function readFrom(where: 'local' | 'session'): Recent[] {
  try {
    const list = JSON.parse(storage(where)?.getItem(RECENT) ?? '[]') as unknown
    if (!Array.isArray(list)) return []
    return list.filter(
      (r): r is Recent =>
        typeof r?.owner === 'string' &&
        typeof r?.name === 'string' &&
        goodRepo(r.owner, r.name) &&
        (r.ref === undefined || (typeof r.ref === 'string' && goodRef(r.ref))) &&
        (r.path === undefined || (typeof r.path === 'string' && cleanPath(r.path) === r.path)),
    )
  } catch {
    return []
  }
}

const same = (a: Recent, b: Recent) => `${a.owner}/${a.name}`.toLowerCase() === `${b.owner}/${b.name}`.toLowerCase()

/**
 * What this browser opened lately, newest first: names a GitHub could make, nothing else. A private repository's
 * name stays in this tab (sessionStorage), as its files do; a public one is kept in localStorage.
 */
export function readRecent(): Recent[] {
  const tab = readFrom('session')
  return [...tab, ...readFrom('local').filter((r) => !tab.some((t) => same(t, r)))].slice(0, 8)
}

/** A repository opened: first in its list, once. */
export function noteRecent(r: Recent, shut: boolean): void {
  const where = shut ? 'session' : 'local'
  const rest = readFrom(where).filter((x) => !same(x, r))
  try {
    storage(where)?.setItem(RECENT, JSON.stringify([r, ...rest].slice(0, 8)))
    // a repository that became private, or public, is listed in one place
    const other = shut ? 'local' : 'session'
    const there = readFrom(other)
    if (there.some((x) => same(x, r))) storage(other)?.setItem(RECENT, JSON.stringify(there.filter((x) => !same(x, r))))
  } catch {
    // a convenience
  }
}

export function forgetRecent(): void {
  for (const where of ['local', 'session'] as const)
    try {
      storage(where)?.removeItem(RECENT)
    } catch {
      // nothing kept
    }
}
