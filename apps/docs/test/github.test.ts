import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compile } from '@loadmap/dsl'
import { describe, expect, it, vi } from 'vitest'
import { client, GitHubError } from '../site/islands/github/api'
import { changedCount, changedText, changes } from '../site/islands/github/changes'
import { lineDiff } from '../site/islands/github/Diff'
import { list, open } from '../site/islands/github/load'
import { cleanPath, goodRef, parseRepo, refSplits, repoQuery, targetFromQuery } from '../site/islands/github/parse'
import { takeToken, tokenPage } from '../site/islands/github/session'
import { edited, leave, type RepoTab, readAside, readTab, writeTab } from '../site/islands/github/tab'
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

  it('opens a file with "\\r\\n" line endings as the editor keeps it, and says which ones had them', async () => {
    const gh = client({
      fetch: fakeGitHub({ ...REPO, refs: { main: { 'a.loadmap': 'loadmap 1.5\r\ntitle: "A"\r\n' } } }).fetch,
    })
    const o = await open(gh, await list(gh, { owner: 'acme', name: 'capacity' }), 'a.loadmap')
    expect(o.files['a.loadmap']).toBe('loadmap 1.5\ntitle: "A"\n')
    expect(o.crlf).toEqual(['a.loadmap'])
  })

  it('says which files the model names that the repository lacks, and opens the rest', async () => {
    const gh = client({
      fetch: fakeGitHub({ ...REPO, refs: { main: { 'a.loadmap': SHOP['models/shop.loadmap'] } } }).fetch,
    })
    const l = await list(gh, { owner: 'acme', name: 'capacity' })
    const o = await open(gh, l, 'a.loadmap')
    expect(o.missing.sort()).toEqual(['platform.loadmap', 'shop.story.loadmap'])
  })

  it('asks for a file a cut tree does not list, when the model or the address names it', async () => {
    const fake = fakeGitHub({ ...REPO, truncated: true, hidden: ['models/platform.loadmap', 'models/shop.loadmap'] })
    const gh = client({ fetch: fake.fetch })
    const t = parseRepo('https://github.com/acme/capacity/blob/main/models/shop.loadmap')
    const l = await list(gh, t as Exclude<typeof t, { error: string }>)
    expect(l).toMatchObject({ truncated: true, want: 'models/shop.loadmap' })
    const o = await open(gh, l, 'models/shop.loadmap')
    expect(Object.keys(o.files).sort()).toEqual(Object.keys(SHOP).sort())
    expect(o.missing).toEqual([])
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
    // a ref that is not there is no case for a token; a repository this browser may not see is
    const ref = (await list(gh, { owner: 'acme', name: 'capacity', ref: 'nope' }).catch(
      (x: unknown) => x,
    )) as GitHubError
    expect([ref.message, ref.failure]).toEqual(['acme/capacity has no branch, tag or commit "nope".', 'missing'])
    const unseen = (await list(gh, { owner: 'acme', name: 'other' }).catch((x: unknown) => x)) as GitHubError
    expect(unseen.failure).toBe('unseen')
    const offline = client({
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    await expect(list(offline, { owner: 'acme', name: 'capacity' })).rejects.toThrow('GitHub could not be reached')
  })
})

describe('a token', () => {
  it("links to GitHub's form filled in: the owner, a week, and only what the editor needs", () => {
    const read = new URL(tokenPage('acme', 'read'))
    expect(read.origin + read.pathname).toBe('https://github.com/settings/personal-access-tokens/new')
    expect(Object.fromEntries(read.searchParams)).toMatchObject({
      target_name: 'acme',
      expires_in: '7',
      contents: 'read',
    })
    expect(read.searchParams.has('pull_requests')).toBe(false)
    const write = new URL(tokenPage('acme', 'write')).searchParams
    expect([write.get('contents'), write.get('pull_requests')]).toEqual(['write', 'write'])
    expect(read.searchParams.get('name')!.length).toBeLessThanOrEqual(40)
  })

  it('is refused unless it looks like one GitHub makes', () => {
    expect(takeToken('hunter2', false)).toMatch('not a GitHub token')
    expect(takeToken(' github_pat x ', false)).toMatch('not a GitHub token')
    expect(takeToken(`github_pat_${'A'.repeat(40)}`, false)).toBeUndefined()
  })
})

describe('what a tab keeps of a repository', () => {
  const store = new Map<string, string>()
  const fake = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
  const tab = (files: Record<string, string>, shut = true): RepoTab => ({
    origin: {
      owner: 'acme',
      name: 'p',
      ref: 'main',
      sha: 'a'.repeat(40),
      tree: 'b'.repeat(40),
      private: shut,
      originals: { 'm.loadmap': 'one', 'lib/x.loadmap': 'two' },
      model: 'm.loadmap',
      crlf: [],
    },
    path: 'm.loadmap',
    files,
  })

  it('keeps the originals once, apart from what changed, and reads them back whole', () => {
    vi.stubGlobal('sessionStorage', fake)
    try {
      const t = tab({ 'm.loadmap': 'one, edited', 'lib/x.loadmap': 'two', 'new.loadmap': 'three' })
      expect(writeTab(t)).toBe(true)
      const stored = JSON.parse(store.get('loadmap-editor-repo')!)
      expect(stored.origin.changed).toEqual({ 'm.loadmap': 'one' })
      expect(readTab()).toEqual(t)
      expect(edited(t)).toBe(true)
      expect(edited(tab({ 'm.loadmap': 'one', 'lib/x.loadmap': 'two' }))).toBe(false)
      // a path that leaves the root, or names no .loadmap file, is no tab
      store.set('loadmap-editor-repo', JSON.stringify({ ...stored, files: { ...stored.files, '../x.loadmap': '' } }))
      expect(readTab()).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
      store.clear()
    }
  })

  it('keeps a private repository with edits aside when it is left, and nothing else', () => {
    vi.stubGlobal('sessionStorage', fake)
    try {
      expect(leave(tab({ 'm.loadmap': 'one', 'lib/x.loadmap': 'two' }))).toBe(false)
      expect(leave(tab({ 'm.loadmap': 'edited', 'lib/x.loadmap': 'two' }, false))).toBe(false)
      const t = tab({ 'm.loadmap': 'edited', 'lib/x.loadmap': 'two' })
      expect(leave(t)).toBe(true)
      expect(readAside()).toEqual(t)
      expect(readTab()).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
      store.clear()
    }
  })
})

describe('what changed', () => {
  it('lists each file whose text differs from the commit, changed, added or removed, by path', () => {
    const originals = { 'm.loadmap': 'one', 'lib/x.loadmap': 'two', 'old.loadmap': 'three' }
    const files = { 'm.loadmap': 'one, edited', 'lib/x.loadmap': 'two', 'new.loadmap': 'four' }
    const t: RepoTab = {
      origin: {
        owner: 'acme',
        name: 'p',
        ref: 'main',
        sha: 'a'.repeat(40),
        tree: 'b'.repeat(40),
        private: false,
        originals,
        model: 'm.loadmap',
        crlf: [],
      },
      path: 'm.loadmap',
      files,
    }
    expect(changes(t)).toEqual([
      { path: 'm.loadmap', kind: 'changed', before: 'one', after: 'one, edited' },
      { path: 'new.loadmap', kind: 'added', after: 'four' },
      { path: 'old.loadmap', kind: 'removed', before: 'three' },
    ])
    expect(changes({ ...t, files: originals })).toEqual([])
    expect(changedCount(t)).toBe(3)
    expect([changedText(1), changedText(3)]).toEqual(['1 file changed', '3 files changed'])
  })
})

describe('a line diff', () => {
  const marks = (a: string, b: string) =>
    lineDiff(a, b)!.map((l) => `${{ same: ' ', gone: '-', new: '+' }[l.kind]}${l.text}`)

  it('marks the lines gone and new, the rest as it is, with each side numbered', () => {
    expect(marks('a\nb\nc\nd', 'a\nx\nc\nd\ne')).toEqual([' a', '-b', '+x', ' c', ' d', '+e'])
    expect(lineDiff('a\nb', 'a\nb')!.every((l) => l.kind === 'same')).toBe(true)
    const [, gone, added, after] = lineDiff('a\nb\nc', 'a\nB\nc')!
    expect([gone, added, after]).toEqual([
      { kind: 'gone', text: 'b', before: 2 },
      { kind: 'new', text: 'B', after: 2 },
      { kind: 'same', text: 'c', before: 3, after: 3 },
    ])
  })

  it('finds the shortest edit, and rebuilds both texts from it', () => {
    const a = Array.from({ length: 300 }, (_, i) => `line ${i % 7} ${i % 3}`).join('\n')
    const b = a
      .split('\n')
      .filter((_, i) => i % 11 !== 0)
      .map((l, i) => (i % 13 ? l : `${l}!`))
      .join('\n')
    const d = lineDiff(a, b)!
    expect(
      d
        .filter((l) => l.kind !== 'new')
        .map((l) => l.text)
        .join('\n'),
    ).toBe(a)
    expect(
      d
        .filter((l) => l.kind !== 'gone')
        .map((l) => l.text)
        .join('\n'),
    ).toBe(b)
  })

  it('compares long files with a few scattered edits', () => {
    const a = Array.from({ length: 12_000 }, (_, i) => `line ${i}`)
    const b = a.map((l, i) => (i % 400 === 0 ? `${l} edited` : l))
    const d = lineDiff(a.join('\n'), b.join('\n'))!
    expect(d.filter((l) => l.kind === 'new')).toHaveLength(30)
    expect(d.filter((l) => l.kind !== 'gone').map((l) => l.text)).toEqual(b)
  })

  it("gives up on texts too long and too different to compare at a reader's pace", () => {
    const many = (c: string) => Array.from({ length: 4000 }, (_, i) => `${c}${i}`).join('\n')
    expect(lineDiff(many('a'), many('b'))).toBeUndefined()
  })
})
