import { describe, expect, it } from 'vitest'
import { client } from '../site/islands/github/api'
import { loadSealed, saveSealed, seal, unseal } from '../site/islands/github/vault'
import { type OpenRouterHost, openRouterSignIn } from '../site/islands/openrouter'

const token = `github_pat_${'K'.repeat(40)}`

/** A GitHub that knows one reader and one repository's files, by path, for the vault's few calls. */
function github(o: { repo?: { private: boolean }; early?: number } = {}) {
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
      repo = { private: body.private }
      return json(201, { name: body.name })
    }
    if (url.pathname === '/repos/reader/loadmap-keys')
      return repo ? json(200, { private: repo.private }) : json(404, { message: 'Not Found' })
    const at = '/repos/reader/loadmap-keys/contents/'
    if (url.pathname.startsWith(at)) {
      const path = url.pathname.slice(at.length)
      if (method === 'PUT') {
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
  return { gh: client({ fetch, token: () => token }), calls, files }
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
    await saveSealed(gh, 'openrouter', '{"sealed":1}', 0)
    expect(calls.find((c) => c.path === '/user/repos')?.body).toMatchObject({ name: 'loadmap-keys', private: true })
    expect([...files.keys()]).toEqual(['keys/openrouter.sealed'])
    expect(await loadSealed(gh, 'openrouter')).toBe('{"sealed":1}')
    // only the sealed text left the page
    expect(JSON.stringify(calls)).not.toContain('sk-')
  })

  it('waits for a repository it just made to take its first write', async () => {
    const { gh, files } = github({ early: 2 })
    await saveSealed(gh, 'openrouter', '{"sealed":1}', 0)
    expect([...files.keys()]).toEqual(['keys/openrouter.sealed'])
  })

  it('refuses a repository of that name the reader made public', async () => {
    const { gh, files } = github({ repo: { private: false } })
    await expect(saveSealed(gh, 'openrouter', '{}')).rejects.toThrow(
      'reader/loadmap-keys is public: make it private on GitHub first, then keep the key there.',
    )
    expect(files.size).toBe(0)
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
