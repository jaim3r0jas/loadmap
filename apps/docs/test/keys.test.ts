import { describe, expect, it } from 'vitest'
import { client } from '../site/islands/github/api'
import { type OpenRouterHost, openRouterSignIn, openRouterUrl } from '../site/islands/github/openrouter'
import { loadSealed, saveSealed, seal, unseal } from '../site/islands/github/vault'

const token = `github_pat_${'K'.repeat(40)}`

/** A GitHub that knows one reader and one repository's files, by path, for the vault's few calls. */
function github(o: { repo?: { private: boolean } } = {}) {
  let repo = o.repo
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
  })

  it('is kept in a private repository of the reader, made private the first time, and read back', async () => {
    const { gh, calls, files } = github()
    expect(await loadSealed(gh, 'openrouter')).toBeUndefined()
    await saveSealed(gh, 'openrouter', '{"sealed":1}')
    expect(calls.find((c) => c.path === '/user/repos')?.body).toMatchObject({ name: 'loadmap-keys', private: true })
    expect([...files.keys()]).toEqual(['keys/openrouter.sealed'])
    expect(await loadSealed(gh, 'openrouter')).toBe('{"sealed":1}')
    // only the sealed text left the page
    expect(JSON.stringify(calls)).not.toContain('sk-')
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
    let deliver: (e: MessageEvent) => void = () => {}
    const popup = { closed: false } as Window
    const host: OpenRouterHost = {
      open: (url) => {
        opened = url
        return popup
      },
      listen: (f) => {
        deliver = f
        return () => {}
      },
      origin: 'https://docs.example',
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
    const back = new URL(url.searchParams.get('callback_url')!)
    expect(back.searchParams.get('for')).toBe('openrouter')
    const state = back.searchParams.get('state')!
    // a message from another window, or with another state, is not the answer
    deliver({
      origin: 'https://docs.example',
      source: {},
      data: { type: 'loadmap-openrouter-sign-in', state, code: 'x' },
    } as MessageEvent)
    deliver({
      origin: 'https://docs.example',
      source: popup,
      data: { type: 'loadmap-openrouter-sign-in', state: 'other', code: 'x' },
    } as MessageEvent)
    deliver({
      origin: 'https://docs.example',
      source: popup,
      data: { type: 'loadmap-openrouter-sign-in', state, code: 'c0de' },
    } as MessageEvent)
    expect(await key).toBe('sk-or-v1-made')
    expect(posted).toMatchObject({ code: 'c0de', code_challenge_method: 'S256' })
    expect(typeof posted.code_verifier).toBe('string')
    expect(openRouterUrl({ back: 'https://docs.example/signed-in/', state: 's', challenge: 'c' })).toContain(
      'callback_url=https%3A%2F%2Fdocs.example%2Fsigned-in%2F%3Ffor%3Dopenrouter%26state%3Ds',
    )
  })
})
