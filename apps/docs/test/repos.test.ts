// The reader's repositories for Open from GitHub: through the app (its installations), with a pasted token, and the
// recent list this browser keeps. GitHub answers from fakes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { client } from '../site/islands/github/api'
import { forgetRecent, listRepos, noteRecent, readRecent } from '../site/islands/github/repos'

const TOKEN = `ghu_${'a'.repeat(36)}`

/** GitHub answering `routes` by path and query; every path asked is kept. */
function github(routes: Record<string, unknown>) {
  const asked: string[] = []
  const fetch = (async (input: RequestInfo | URL) => {
    const u = new URL(String(input))
    const at = `${u.pathname}${u.search}`
    asked.push(at)
    return at in routes
      ? new Response(JSON.stringify(routes[at]), { status: 200 })
      : new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
  }) as unknown as typeof globalThis.fetch
  return { gh: client({ token: () => TOKEN, fetch }), asked }
}

const repo = (owner: string, name: string, pushed: string, shut = false) => ({
  name,
  owner: { login: owner },
  private: shut,
  pushed_at: pushed,
})

describe("the reader's repositories", () => {
  it("lists the app's installations' repositories, newest first, each once", async () => {
    const { gh, asked } = github({
      '/user/installations?per_page=100': { installations: [{ id: 1 }, { id: 2 }] },
      '/user/installations/1/repositories?per_page=100&page=1': {
        total_count: 2,
        repositories: [repo('acme', 'old', '2025-01-01T00:00:00Z'), repo('acme', 'new', '2026-11-01T00:00:00Z', true)],
      },
      '/user/installations/2/repositories?per_page=100&page=1': {
        total_count: 1,
        // the same repository through another installation
        repositories: [repo('acme', 'new', '2026-11-01T00:00:00Z', true), repo('me', 'mine', '2026-06-01T00:00:00Z')],
      },
    })
    const l = await listRepos(gh, 'app')
    expect(l.repos.map((r) => `${r.owner}/${r.name}:${r.private}`)).toEqual([
      'acme/new:true',
      'me/mine:false',
      'acme/old:false',
    ])
    expect(l.more).toBe(false)
    // one page each: GitHub said how many there are
    expect(asked).toHaveLength(3)
  })

  it('reads three pages at most, and says there are more', async () => {
    const page = (n: number) =>
      Array.from({ length: 100 }, (_, i) =>
        repo('acme', `r${n}-${i}`, `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`),
      )
    const { gh, asked } = github({
      '/user/installations?per_page=100': { installations: [{ id: 1 }] },
      ...Object.fromEntries(
        [1, 2, 3, 4].map((n) => [
          `/user/installations/1/repositories?per_page=100&page=${n}`,
          { total_count: 450, repositories: page(n) },
        ]),
      ),
    })
    const l = await listRepos(gh, 'app')
    expect(l.repos).toHaveLength(300)
    expect(l.more).toBe(true)
    expect(asked.filter((a) => a.includes('page=4'))).toEqual([])
  })

  it('lists what a pasted token sees, by its last push', async () => {
    const { gh, asked } = github({
      '/user/repos?sort=pushed&per_page=100&page=1': [repo('acme', 'a', '2026-01-01T00:00:00Z'), { name: 7 }],
    })
    const l = await listRepos(gh, 'token')
    expect(l.repos.map((r) => r.name)).toEqual(['a'])
    expect(asked).toEqual(['/user/repos?sort=pushed&per_page=100&page=1'])
  })
})

class Store implements Storage {
  private m = new Map<string, string>()
  get length() {
    return this.m.size
  }
  clear() {
    this.m.clear()
  }
  getItem(k: string) {
    return this.m.get(k) ?? null
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v))
  }
}

describe('the recent list', () => {
  let local: Store
  let tab: Store
  beforeEach(() => {
    local = new Store()
    tab = new Store()
    vi.stubGlobal('localStorage', local)
    vi.stubGlobal('sessionStorage', tab)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the last eight opened, newest first, each once, with the ref and the model', () => {
    for (let i = 0; i < 10; i++) noteRecent({ owner: 'acme', name: `r${i}`, ref: 'main', path: 'm.loadmap' }, false)
    noteRecent({ owner: 'ACME', name: 'r5', ref: 'dev', path: 'other.loadmap' }, false)
    const r = readRecent()
    expect(r).toHaveLength(8)
    expect(r[0]).toEqual({ owner: 'ACME', name: 'r5', ref: 'dev', path: 'other.loadmap' })
    expect(r.filter((x) => x.name === 'r5')).toHaveLength(1)
  })

  it("keeps a private repository's name in this tab only, as its files", () => {
    noteRecent({ owner: 'acme', name: 'public', path: 'p.loadmap' }, false)
    noteRecent({ owner: 'acme', name: 'secret', path: 'pricing.loadmap' }, true)
    expect(readRecent().map((r) => r.name)).toEqual(['secret', 'public'])
    expect(local.getItem('loadmap-github-recent')).not.toContain('secret')
    expect(tab.getItem('loadmap-github-recent')).toContain('secret')
    // made private since: it leaves the lasting list
    noteRecent({ owner: 'acme', name: 'public', path: 'p.loadmap' }, true)
    expect(local.getItem('loadmap-github-recent')).not.toContain('public')
  })

  it('reads only names GitHub could make, refs git takes, and paths to models', () => {
    local.setItem(
      'loadmap-github-recent',
      JSON.stringify([
        { owner: 'acme', name: 'ok', path: 'm.loadmap' },
        { owner: '<b>', name: 'x' },
        { owner: 'acme', name: '..' },
        { owner: '-acme', name: 'x' },
        { owner: 'acme', name: 'y', path: 'notes.txt' },
        { owner: 'acme', name: 'z', path: '../m.loadmap' },
        { owner: 'acme', name: 'w', ref: 'a..b' },
        'junk',
      ]),
    )
    expect(readRecent()).toEqual([{ owner: 'acme', name: 'ok', path: 'm.loadmap' }])
    local.setItem('loadmap-github-recent', '{')
    expect(readRecent()).toEqual([])
  })

  it('forgets both lists', () => {
    noteRecent({ owner: 'acme', name: 'r' }, false)
    noteRecent({ owner: 'acme', name: 's' }, true)
    forgetRecent()
    expect(readRecent()).toEqual([])
  })
})
