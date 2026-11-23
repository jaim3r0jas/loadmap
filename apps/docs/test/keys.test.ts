import { describe, expect, it } from 'vitest'
import { client } from '../site/islands/github/api'
import { loadSealed, saveSealed, seal, unseal, VaultError } from '../site/islands/github/vault'
import { type OpenRouterHost, openRouterSignIn } from '../site/islands/openrouter'

const token = `github_pat_${'K'.repeat(40)}`

/** A GitHub that knows one reader and one repository's files, by path, for the vault's few calls. */
function github(o: { repo?: { private: boolean }; early?: number; create?: number; write?: number } = {}) {
  let repo = o.repo
  let early = o.early ?? 0
  const files = new Map<string, { content: string; sha: string }>()
  const calls: { method: string; path: string; body?: unknown }[] = []
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path: url.pathname, body })
    if (url.pathname === '/user') return json(200, { login: 'reader' })
    if (url.pathname === '/user/repos' && method === 'POST') {
      // a token that may not make repositories (403), or a name taken by a repository it does not see (422)
      if (o.create === 403) return json(403, { message: 'Resource not accessible by integration' })
      if (o.create === 422) return json(422, { message: 'Repository creation failed.' })
      repo = { private: body.private }
      return json(201, { name: body.name })
    }
    if (url.pathname === '/repos/reader/loadmap-keys')
      return repo ? json(200, { private: repo.private }) : json(404, { message: 'Not Found' })
    const at = '/repos/reader/loadmap-keys/contents/'
    if (url.pathname.startsWith(at)) {
      const path = url.pathname.slice(at.length)
      if (method === 'PUT') {
        if (o.write) return json(o.write, { message: 'Resource not accessible by personal access token' })
        // a repository just made, before its first commit
        if (early-- > 0) return json(409, { message: 'Git Repository is empty.' })
        files.set(path, { content: body.content, sha: `sha${files.size + 1}` })
        return json(201, {})
      }
      const f = files.get(path)
      return f ? json(200, { content: f.content, encoding: 'base64', sha: f.sha }) : json(404, { message: 'Not Found' })
    }
    return json(404, { message: 'Not Found' })
  }
  /** The reader makes the repository on GitHub, by hand. */
  const make = (made: { private: boolean }) => {
    repo = made
  }
  return { gh: client({ fetch, token: () => token }), calls, files, make }
}

describe('a model key kept sealed', () => {
  it('opens with the passphrase it was sealed with, and says the same for a wrong one and a damaged file', async () => {
    const sealed = await seal('sk-or-v1-secret', 'a long passphrase here')
    expect(sealed).not.toContain('secret')
    expect(JSON.parse(sealed)).toMatchObject({ v: 1, kdf: 'PBKDF2-SHA256', rounds: 600_000 })
    expect(await unseal(sealed, 'a long passphrase here')).toBe('sk-or-v1-secret')
    const refusal = 'That passphrase does not open the key kept on GitHub.'
    await expect(unseal(sealed, 'another passphrase')).rejects.toThrow(refusal)
    await expect(unseal('{"v":1}', 'a long passphrase here')).rejects.toThrow(refusal)
    // the rounds the file says are the ones that open it: other rounds, another key; rounds out of reason, refused
    const other = JSON.stringify({ ...JSON.parse(sealed), rounds: 200_000 })
    await expect(unseal(other, 'a long passphrase here')).rejects.toThrow(refusal)
    const absurd = JSON.stringify({ ...JSON.parse(sealed), rounds: 1e12 })
    await expect(unseal(absurd, 'a long passphrase here')).rejects.toThrow(refusal)
  })

  it('is kept in a private repository of the reader, made private the first time, and read back', async () => {
    const { gh, calls, files } = github()
    expect(await loadSealed(gh, 'openrouter')).toBeUndefined()
    await saveSealed(gh, 'openrouter', '{"sealed":1}', { wait: 0 })
    expect(calls.find((c) => c.path === '/user/repos')?.body).toMatchObject({ name: 'loadmap-keys', private: true })
    expect([...files.keys()]).toEqual(['keys/openrouter.sealed'])
    expect(await loadSealed(gh, 'openrouter')).toBe('{"sealed":1}')
    // only the sealed text left the page
    expect(JSON.stringify(calls)).not.toContain('sk-')
  })

  it('waits for a repository it just made to take its first write', async () => {
    const { gh, files } = github({ early: 2 })
    await saveSealed(gh, 'openrouter', '{"sealed":1}', { wait: 0 })
    expect([...files.keys()]).toEqual(['keys/openrouter.sealed'])
  })

  it('refuses a repository of that name the reader made public', async () => {
    const { gh, files } = github({ repo: { private: false } })
    await expect(saveSealed(gh, 'openrouter', '{}')).rejects.toThrow(
      'reader/loadmap-keys is public: make it private on GitHub first, then keep the key there.',
    )
    expect(files.size).toBe(0)
  })

  const app = 'https://github.com/apps/loadmap-editor/installations/new'
  const signed = { signedIn: true, app, wait: 0 }
  const pick = { href: app, label: "Pick the app's repositories" }
  const refusal = (p: Promise<void>) =>
    p.then(
      () => undefined,
      (e: unknown) => e as VaultError,
    )

  it('tells a signed-in reader whose app may not make repositories how to make it, and keeps the key once it is there', async () => {
    const { gh, files, make } = github({ create: 403 })
    const e = await refusal(saveSealed(gh, 'openrouter', '{"sealed":1}', signed))
    expect(e).toBeInstanceOf(VaultError)
    expect(e?.message).toBe(
      'The sign-in may not make reader/loadmap-keys. Make it on GitHub, private. If it is there already, let the app reach it (all repositories, or that one). Then keep the key again.',
    )
    // made by hand where the app does not reach, GitHub answers the same: the way to the app's repositories is there
    expect(e?.links.map((l) => l.label)).toEqual(['Make it on GitHub', "Pick the app's repositories"])
    expect(e?.links[1]).toEqual(pick)
    const page = new URL(e?.links[0]?.href ?? '')
    expect(page.origin + page.pathname).toBe('https://github.com/new')
    expect(Object.fromEntries(page.searchParams)).toMatchObject({
      name: 'loadmap-keys',
      owner: 'reader',
      visibility: 'private',
    })
    expect(files.size).toBe(0)
    // made by hand, the same press keeps the key: nothing is made twice
    make({ private: true })
    await saveSealed(gh, 'openrouter', '{"sealed":1}', signed)
    expect(await loadSealed(gh, 'openrouter')).toBe('{"sealed":1}')
  })

  it('tells a reader with a pasted token what the token needs', async () => {
    const { gh } = github({ create: 403 })
    // a build that knows the app says nothing of it to a pasted token
    const e = await refusal(saveSealed(gh, 'openrouter', '{}', { app }))
    expect(e?.message).toBe(
      'This token may not make reader/loadmap-keys. Make it on GitHub, private, and give the token Contents, read and write, on it (a classic token: the repo scope). Then keep the key again.',
    )
    expect(e?.links.map((l) => l.label)).toEqual(['Make it on GitHub'])
    const mayRead = github({ repo: { private: true }, write: 403 })
    const read = await refusal(saveSealed(mayRead.gh, 'openrouter', '{}'))
    expect(read?.message).toBe(
      'This token may only read reader/loadmap-keys. Give it Contents, read and write, on it (a classic token: the repo scope), then keep the key again.',
    )
    expect(read?.links).toEqual([])
  })

  it('tells a signed-in reader whose write is refused to sign in again, or to let the app reach it', async () => {
    const { gh } = github({ repo: { private: true }, write: 403 })
    const e = await refusal(saveSealed(gh, 'openrouter', '{}', signed))
    expect(e?.message).toBe(
      'The sign-in may not write to reader/loadmap-keys. Sign in again; if it stays so, let the app reach it (all repositories, or that one).',
    )
    expect(e?.links).toEqual([pick])
    // a sign-in's token in a build that does not know the app: the words, without the way
    expect((await refusal(saveSealed(gh, 'openrouter', '{}', { signedIn: true })))?.links).toEqual([])
  })

  it("says so when the repository is there, out of the token's reach", async () => {
    const { gh } = github({ create: 422 })
    const e = await refusal(saveSealed(gh, 'openrouter', '{}', signed))
    expect(e?.message).toBe(
      "reader/loadmap-keys seems to be there, out of the sign-in's reach. Let the app reach it (all repositories, or that one), then keep the key again.",
    )
    expect(e?.links).toEqual([pick])
    const pasted = await refusal(saveSealed(gh, 'openrouter', '{}'))
    expect(pasted?.message).toBe(
      "reader/loadmap-keys seems to be there, out of this token's reach. Give the token Contents, read and write, on it (a classic token: the repo scope), then keep the key again.",
    )
    expect(pasted?.links).toEqual([])
  })

  it('waits for a repository made by hand that is empty still, and says what to do when it stays so', async () => {
    const late = github({ repo: { private: true }, early: 2 })
    await saveSealed(late.gh, 'openrouter', '{"sealed":1}', { wait: 0 })
    expect([...late.files.keys()]).toEqual(['keys/openrouter.sealed'])
    const never = github({ repo: { private: true }, early: 99 })
    const e = await refusal(saveSealed(never.gh, 'openrouter', '{}', { wait: 0 }))
    expect(e?.message).toBe(
      'reader/loadmap-keys did not take the key. If it is empty, add a README to it on GitHub, then keep the key again.',
    )
    expect(e?.links).toEqual([{ href: 'https://github.com/reader/loadmap-keys', label: 'Open it on GitHub' }])
    expect(never.calls.filter((c) => c.method === 'PUT')).toHaveLength(5)
  })
})

describe('signing in with OpenRouter', () => {
  it('asks for a key with a challenge, and swaps the code for it with the verifier that never left the page', async () => {
    let posted: Record<string, unknown> = {}
    let opened = ''
    let deliver: (data: unknown, from: Window | null) => void = () => {}
    const popup = { closed: true } as Window
    const host: OpenRouterHost = {
      open: (url) => {
        opened = url
        return popup
      },
      listen: (f) => {
        deliver = f
        return () => {}
      },
      back: 'https://docs.example/signed-in/',
      fetch: async (_input, init) => {
        posted = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ key: 'sk-or-v1-made' }), { status: 200 })
      },
    }
    const key = openRouterSignIn(host)
    await expect.poll(() => opened).not.toBe('')
    const url = new URL(opened)
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    // the state rides in the way back's fragment: OpenRouter adds its code to the address however it likes
    const back = new URL(url.searchParams.get('callback_url')!)
    expect(back.search).toBe('')
    const said = new URLSearchParams(back.hash.slice(1))
    expect(said.get('for')).toBe('openrouter')
    const state = said.get('state')!
    // a window that is not the popup, or another state, is not the answer; a popup that reads as closed (an opener
    // cut off) is not given up on
    deliver({ type: 'loadmap-openrouter-sign-in', state, code: 'x' }, {} as Window)
    deliver({ type: 'loadmap-openrouter-sign-in', state: 'other', code: 'x' }, popup)
    // the site's own channel, when OpenRouter cut the opener off
    deliver({ type: 'loadmap-openrouter-sign-in', state, code: 'c0de' }, null)
    expect(await key).toBe('sk-or-v1-made')
    expect(posted).toMatchObject({ code: 'c0de', code_challenge_method: 'S256' })
    expect(typeof posted.code_verifier).toBe('string')
  })
})
