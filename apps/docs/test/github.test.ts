import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compile } from '@loadmap/dsl'
import { describe, expect, it } from 'vitest'
import { client, GitHubError } from '../site/islands/github/api'
import { list, open } from '../site/islands/github/load'
import { cleanPath, goodRef, parseRepo, refSplits, repoQuery, targetFromQuery } from '../site/islands/github/parse'
import { type FakeRepo, fakeGitHub, shaOf } from './fake-github'

const read = (f: string) => readFileSync(join(import.meta.dirname, '../../../docs/multi-file', f), 'utf8')
const SHOP = {
  'models/shop.loadmap': read('shop.loadmap'),
  'models/shop.story.loadmap': read('shop.story.loadmap'),
  'models/platform.loadmap': read('platform.loadmap'),
}
const REPO: FakeRepo = {
  owner: 'acme',
  name: 'capacity',
  refs: {
    main: {
      ...SHOP,
      'other/lone.loadmap': 'loadmap 1.5\ntitle: "Alone"\n',
      'README.md': '# not a model',
      'models/link.loadmap': { text: '../../etc/passwd', mode: '120000' },
    },
    'feat/new-cache': { 'shop.loadmap': read('shop.loadmap').replace(/include.*\n|import.*\n/g, '') },
  },
}

describe('naming a repository', () => {
  it('reads owner/name, an address to the repository, a folder or a file in it, and an ssh remote', () => {
    expect(parseRepo('acme/capacity')).toEqual({ owner: 'acme', name: 'capacity' })
    expect(parseRepo(' https://github.com/acme/capacity.git ')).toEqual({ owner: 'acme', name: 'capacity' })
    expect(parseRepo('github.com/acme/capacity/')).toEqual({ owner: 'acme', name: 'capacity' })
    expect(parseRepo('git@github.com:acme/capacity.git')).toEqual({ owner: 'acme', name: 'capacity' })
    expect(parseRepo('https://github.com/acme/capacity/blob/feat/new-cache/models/shop.loadmap')).toEqual({
      owner: 'acme',
      name: 'capacity',
      rest: { kind: 'blob', segments: ['feat', 'new-cache', 'models', 'shop.loadmap'] },
    })
    expect(parseRepo('https://github.com/acme/capacity/tree/main/models')).toMatchObject({
      rest: { kind: 'tree', segments: ['main', 'models'] },
    })
  })

  it('refuses what is not a repository on github.com, in a plain sentence', () => {
    for (const bad of [
      '',
      'acme',
      'https://gitlab.com/acme/capacity',
      'javascript:alert(1)',
      '-acme/capacity',
      'acme/..',
      'https://github.com/acme/capacity/issues/3',
      'https://github.com/acme/capacity/blob/main/README.md',
    ])
      expect(parseRepo(bad), bad).toHaveProperty('error')
  })

  it('splits an address into a ref and a path, the shortest ref first', () => {
    expect(refSplits({ kind: 'blob', segments: ['feat', 'x', 'a.loadmap'] })).toEqual([
      { ref: 'feat', path: ['x', 'a.loadmap'] },
      { ref: 'feat/x', path: ['a.loadmap'] },
    ])
    expect(refSplits({ kind: 'tree', segments: ['main'] })).toEqual([{ ref: 'main', path: [] }])
  })

  it("takes the editor's query, and refuses a ref or a path that is not one", () => {
    const q = (s: string) => targetFromQuery(new URLSearchParams(s))
    expect(q('template=x')).toBeUndefined()
    expect(q('repo=acme/capacity&ref=feat/x&path=models/shop.loadmap')).toEqual({
      owner: 'acme',
      name: 'capacity',
      ref: 'feat/x',
      path: 'models/shop.loadmap',
    })
    expect(q('repo=acme/capacity&ref=a..b')).toHaveProperty('error')
    expect(q('repo=acme/capacity&path=../x.loadmap')).toHaveProperty('error')
    expect(q('repo=acme/capacity&path=x.ts')).toHaveProperty('error')
    expect(repoQuery({ owner: 'acme', name: 'capacity', ref: 'main', path: 'm/a.loadmap' })).toBe(
      '?repo=acme%2Fcapacity&ref=main&path=m%2Fa.loadmap',
    )
  })

  it('keeps a path only when it stays in the repository and names a .loadmap file', () => {
    expect(cleanPath('models/shop.loadmap')).toBe('models/shop.loadmap')
    for (const bad of ['/a.loadmap', 'a/../b.loadmap', './a.loadmap', 'a//b.loadmap', 'a\\b.loadmap', 'a\n.loadmap'])
      expect(cleanPath(bad), bad).toBeUndefined()
    expect(goodRef('feat/new-cache')).toBe(true)
    for (const bad of ['', 'a b', 'a..b', '-x', 'x/', 'x.lock', 'a@{1}', 'a\u0000b'])
      expect(goodRef(bad), bad).toBe(false)
  })
})

describe('opening a repository', () => {
  it('pins the commit, lists the .loadmap files but symlinks, and opens the model with every file it reaches', async () => {
    const fake = fakeGitHub(REPO)
    const gh = client({ fetch: fake.fetch })
    const l = await list(gh, { owner: 'acme', name: 'capacity' })
    expect(l).toMatchObject({ ref: 'main', sha: shaOf('commit:main'), tree: shaOf('tree:main'), private: false })
    expect(l.files.map((f) => f.path)).toEqual([...Object.keys(SHOP).sort(), 'other/lone.loadmap'])
    const o = await open(gh, l, 'models/shop.loadmap')
    expect(Object.keys(o.files).sort()).toEqual(Object.keys(SHOP).sort())
    expect(o.missing).toEqual([])
    // the files read as one definition, as the editor will compile them
    expect(compile(o.files[o.path]!, { path: o.path, files: o.files }).diagnostics).toEqual([])
    // the public files come from raw.githubusercontent.com at the pinned commit, never by a branch's name
    const raws = fake.calls.filter((c) => c.url.startsWith('https://raw.githubusercontent.com/'))
    expect(raws).toHaveLength(3)
    for (const c of raws) expect(c.url).toContain(`/acme/capacity/${shaOf('commit:main')}/models/`)
  })

  it('finds where a ref with a "/" ends in an address, and the file it names', async () => {
    const gh = client({ fetch: fakeGitHub(REPO).fetch })
    const t = parseRepo('https://github.com/acme/capacity/blob/feat/new-cache/shop.loadmap')
    const l = await list(gh, t as Exclude<typeof t, { error: string }>)
    expect(l).toMatchObject({ ref: 'feat/new-cache', want: 'shop.loadmap' })
  })

  it('reads a private repository through the API with the token, never through raw.githubusercontent.com', async () => {
    const fake = fakeGitHub({ ...REPO, private: true, token: 'github_pat_x' })
    const without = client({ fetch: fake.fetch })
    await expect(list(without, { owner: 'acme', name: 'capacity' })).rejects.toThrow(
      'acme/capacity was not found. If it is private, give a token to read it.',
    )
    const gh = client({ fetch: fake.fetch, token: () => 'github_pat_x' })
    const l = await list(gh, { owner: 'acme', name: 'capacity' })
    expect(l.private).toBe(true)
    const o = await open(gh, l, 'models/shop.loadmap')
    expect(Object.keys(o.files)).toHaveLength(3)
    for (const c of fake.calls) {
      expect(c.url.startsWith('https://api.github.com/')).toBe(true)
      expect(c.url).not.toContain('github_pat_x')
    }
  })

  it('says which files the model names that the repository lacks, and opens the rest', async () => {
    const gh = client({
      fetch: fakeGitHub({ ...REPO, refs: { main: { 'a.loadmap': SHOP['models/shop.loadmap'] } } }).fetch,
    })
    const l = await list(gh, { owner: 'acme', name: 'capacity' })
    const o = await open(gh, l, 'a.loadmap')
    expect(o.missing.sort()).toEqual(['platform.loadmap', 'shop.story.loadmap'])
  })

  it("holds a definition's limits: too many files, or too much text, is refused before or after reading", async () => {
    const many: Record<string, string> = {
      'm.loadmap': `loadmap 1.5\n${Array.from({ length: 70 }, (_, i) => `include "./p${i}.loadmap"`).join('\n')}\n`,
    }
    for (let i = 0; i < 70; i++) many[`p${i}.loadmap`] = 'loadmap 1.5\npart of "./m.loadmap"\n'
    const gh = client({ fetch: fakeGitHub({ ...REPO, refs: { main: many } }).fetch })
    await expect(open(gh, await list(gh, { owner: 'acme', name: 'capacity' }), 'm.loadmap')).rejects.toThrow(
      'more than 64 files',
    )
    const big = client({
      fetch: fakeGitHub({ ...REPO, refs: { main: { 'big.loadmap': `# ${'x'.repeat(1_000_001)}` } } }).fetch,
    })
    await expect(open(big, await list(big, { owner: 'acme', name: 'capacity' }), 'big.loadmap')).rejects.toThrow(
      'more than 1,000,000 characters',
    )
  })

  it('says why GitHub refused, as the reader can act on it', async () => {
    const limited = client({ fetch: fakeGitHub(REPO, { rateLimited: true }).fetch, now: () => 1_000_000 })
    const e = await list(limited, { owner: 'acme', name: 'capacity' }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(GitHubError)
    expect((e as GitHubError).message).toBe(
      "GitHub's hourly limit for reading without a token is used up. It resets in 14 minutes. A token raises it.",
    )
    const gh = client({ fetch: fakeGitHub(REPO).fetch })
    await expect(list(gh, { owner: 'acme', name: 'capacity', ref: 'nope' })).rejects.toThrow(
      'acme/capacity has no branch, tag or commit "nope".',
    )
    const offline = client({
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    await expect(list(offline, { owner: 'acme', name: 'capacity' })).rejects.toThrow('GitHub could not be reached')
  })
})
