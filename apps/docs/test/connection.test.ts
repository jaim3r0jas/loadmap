// The one connection to GitHub: what the bar reads before any GitHub code loads, what Connect keeps and where, what
// a refused token and Disconnect leave. Nothing reaches the real GitHub: the fake answers every call.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshText } from '../../github-auth/worker'
import type { SignIn, SignInHost } from '../site/islands/github/signin'
import { fakeGitHub } from './fake-github'

const APP: SignIn = { clientId: 'Iv23li0000', slug: 'loadmap-editor', exchange: 'https://auth.example.workers.dev' }
const ORIGIN = 'https://example.github.io'
const APP_TOKEN = `ghu_${'a'.repeat(36)}`
const PASTED = `github_pat_${'b'.repeat(40)}`

/** A browser's storage, for the node tests. */
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

let local: Store
let session: Store
/** What device.ts keeps in IndexedDB, here in memory: the key pair and the sealed session. */
let held: Map<string, unknown>

beforeEach(() => {
  local = new Store()
  session = new Store()
  vi.stubGlobal('localStorage', local)
  vi.stubGlobal('sessionStorage', session)
  vi.resetModules()
  held = new Map()
  vi.doMock('../site/islands/github/device', async (real) => {
    const d = await real<typeof import('../site/islands/github/device')>()
    return {
      ...d,
      deviceKey: async () => {
        if (!held.has('key'))
          held.set(
            'key',
            await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']),
          )
        return held.get('key') as CryptoKeyPair
      },
      readSession: async () => held.get('session') as string | undefined,
      keepSession: async (s: string) => void held.set('session', s),
      forgetDevice: async () => held.clear(),
    }
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('../site/islands/github/device')
})

/** The modules as a fresh page loads them, with GitHub answering from the fake. */
async function page(fetch: typeof globalThis.fetch) {
  vi.stubGlobal('fetch', fetch)
  const account = await import('../site/islands/github/account')
  const session = await import('../site/islands/github/session')
  const connection = await import('../site/islands/github/connection')
  return { ...account, ...session, ...connection }
}

const fake = (token: string) => fakeGitHub({ owner: 'acme', name: 'capacity', token, refs: { main: {} } })

/** A popup that answers at once, and a Worker that hands out `token`. */
function host(token: string): SignInHost {
  const popup = { closed: false } as unknown as Window
  let hear: ((e: MessageEvent) => void) | undefined
  return {
    open: (url) => {
      const state = new URL(url).searchParams.get('state')
      setTimeout(() =>
        hear?.({
          origin: ORIGIN,
          source: popup,
          data: { type: 'loadmap-github-sign-in', state, code: 'c' },
        } as MessageEvent),
      )
      return popup
    },
    listen: (on) => {
      hear = on
      return () => {
        hear = undefined
      }
    },
    origin: ORIGIN,
    back: `${ORIGIN}/loadmap/signed-in/`,
    fetch: (async () => new Response(JSON.stringify({ access_token: token }))) as unknown as typeof fetch,
  }
}

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5))
  expect(ok()).toBe(true)
}

describe('Connect to GitHub', () => {
  it('connects through the app: the token kept for the tab, the login on the bar, no secret in lasting storage', async () => {
    const gh = fake(APP_TOKEN)
    const p = await page(gh.fetch)
    expect(p.account()).toEqual({ connected: false })
    const heard: boolean[] = []
    p.onAccount((a) => heard.push(a.connected))
    await p.connect({ app: APP, host: host(APP_TOKEN) })
    await until(() => p.account().login === 'acme')
    expect(p.account()).toEqual({ connected: true, via: 'app', login: 'acme' })
    expect(heard[0]).toBe(true)
    expect(session.getItem('loadmap-github-token')).toBe(APP_TOKEN)
    expect(JSON.parse(local.getItem('loadmap-github-account')!)).toEqual({ login: 'acme', via: 'app' })
    for (let i = 0; i < local.length; i++) expect(local.getItem(local.key(i)!)).not.toContain(APP_TOKEN)
    // the login was asked of api.github.com, with the token
    expect(gh.calls.map((c) => [c.url, c.authorization])).toEqual([
      ['https://api.github.com/user', `Bearer ${APP_TOKEN}`],
    ])
  })

  it('reads a kept connection before any GitHub code loads, and a reload keeps it without a call', async () => {
    session.setItem('loadmap-github-token', APP_TOKEN)
    local.setItem('loadmap-github-account', JSON.stringify({ login: 'acme', via: 'app' }))
    const gh = fake(APP_TOKEN)
    const p = await page(gh.fetch)
    expect(p.account()).toEqual({ connected: true, login: 'acme', via: 'app' })
    expect(p.hasToken()).toBe(true)
    expect(gh.calls).toEqual([])
  })

  it('shows no login it cannot trust', async () => {
    local.setItem('loadmap-github-account', JSON.stringify({ login: '<img src=x>', via: 'app' }))
    const p = await page(fake(APP_TOKEN).fetch)
    expect(p.account()).toEqual({ connected: false })
  })

  it('a token GitHub refuses is gone, and the bar offers to connect again as the last login', async () => {
    session.setItem('loadmap-github-token', APP_TOKEN)
    local.setItem('loadmap-github-account', JSON.stringify({ login: 'acme', via: 'app' }))
    // GitHub no longer takes it: 8 hours passed, or the reader revoked the app
    const p = await page(fake(`ghu_${'z'.repeat(36)}`).fetch)
    await expect(p.gh.json('/user')).rejects.toMatchObject({ failure: 'auth' })
    expect(p.account()).toEqual({ connected: false, login: 'acme', via: 'app' })
    expect(p.hasToken()).toBe(false)
    expect(session.getItem('loadmap-github-token')).toBeNull()
  })

  it('a pasted token connects for the page, or the tab when kept, and names nobody until GitHub says whose', async () => {
    local.setItem('loadmap-github-account', JSON.stringify({ login: 'someone-else', via: 'token' }))
    const p = await page(fake(PASTED).fetch)
    expect(p.takeToken('hunter2', false)).toMatch(/not a GitHub token/)
    expect(p.takeToken(PASTED, false)).toBeUndefined()
    // the last login may not be this token's
    expect(p.account()).toEqual({ connected: true, via: 'token' })
    // a pasted token is not the app's, whatever its kind
    expect(p.signedIn()).toBe(false)
    await until(() => p.account().login === 'acme')
    expect(session.getItem('loadmap-github-token')).toBeNull()
    p.takeToken(PASTED, true)
    expect(session.getItem('loadmap-github-token')).toBe(PASTED)
  })

  it('a late refusal of an older token leaves the newer one alone', async () => {
    const old = `github_pat_${'o'.repeat(40)}`
    // GitHub refuses the old token only once the new one is taken
    let refuse: (r: Response) => void = () => {}
    const gh = fake(PASTED)
    const p = await page((async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new Headers(init?.headers).get('Authorization') === `Bearer ${old}`)
        return new Promise<Response>((r) => {
          refuse = r
        })
      return gh.fetch(input, init)
    }) as typeof fetch)
    p.takeToken(old, true)
    p.takeToken(PASTED, true)
    refuse(new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }))
    await until(() => p.account().login === 'acme')
    expect(p.hasToken()).toBe(true)
    expect(session.getItem('loadmap-github-token')).toBe(PASTED)
  })

  it('Disconnect forgets the token and the account', async () => {
    const p = await page(fake(APP_TOKEN).fetch)
    await p.connect({ app: APP, host: host(APP_TOKEN) })
    await until(() => p.account().login === 'acme')
    expect(p.signedIn()).toBe(true)
    await p.disconnect()
    expect(p.account()).toEqual({ connected: false })
    expect(p.hasToken()).toBe(false)
    expect(local.getItem('loadmap-github-account')).toBeNull()
    expect(session.getItem('loadmap-github-token')).toBeNull()
  })

  it('a reconnect names its account to GitHub, and goes into the popup the press opened', async () => {
    const p = await page(fake(APP_TOKEN).fetch)
    const h = host(APP_TOKEN)
    let hear: ((e: MessageEvent) => void) | undefined
    const asked: string[] = []
    const popup = {
      closed: false,
      location: {
        set href(url: string) {
          asked.push(url)
          const state = new URL(url).searchParams.get('state')
          setTimeout(() =>
            hear?.({
              origin: ORIGIN,
              source: popup,
              data: { type: 'loadmap-github-sign-in', state, code: 'c' },
            } as MessageEvent),
          )
        },
      },
    } as unknown as Window
    const pressed: SignInHost = {
      ...h,
      // the press opened the popup already: nothing opens another
      open: () => null,
      listen: (on) => {
        hear = on
        return () => {
          hear = undefined
        }
      },
    }
    await p.connect({ app: APP, host: pressed, popup, login: 'acme' })
    expect(new URL(asked[0]!).searchParams.get('login')).toBe('acme')
    expect(p.account()).toMatchObject({ connected: true, via: 'app' })
  })

  it('without an app, Connect says to paste a token', async () => {
    const p = await page(fake(APP_TOKEN).fetch)
    // this test's build has no VITE_GITHUB_APP_*
    expect(p.app).toBeUndefined()
    await expect(p.connect()).rejects.toThrow('paste a token')
  })
})

/** The site's Worker as the page meets it: what it was sent, and its answers. */
function worker(answers: { refresh?: Response | (() => Response); session?: string } = {}) {
  const sent: { path: string; body: Record<string, unknown> }[] = []
  const call = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname
    sent.push({ path, body: JSON.parse(String(init.body)) })
    if (path === '/refresh') {
      const r = answers.refresh
      if (r) return typeof r === 'function' ? r() : r
      return new Response(JSON.stringify({ access_token: APP_TOKEN, expires_in: 28800, session: 'next-session' }))
    }
    if (path === '/revoke') return new Response(null, { status: 204 })
    return new Response(JSON.stringify({ access_token: APP_TOKEN, expires_in: 28800, session: answers.session }))
  }) as unknown as typeof globalThis.fetch
  return { fetch: call, sent }
}

describe('coming back connected', () => {
  it("connects with this browser's key, and keeps the session the Worker sealed to it", async () => {
    const p = await page(fake(APP_TOKEN).fetch)
    const w = worker({ session: 'sealed-for-this-browser' })
    await p.connect({ app: APP, host: { ...host(APP_TOKEN), fetch: w.fetch } })
    const { x, y } = await crypto.subtle.exportKey('jwk', (held.get('key') as CryptoKeyPair).publicKey)
    expect(w.sent[0]!.body.device).toEqual({ x, y })
    expect(held.get('session')).toBe('sealed-for-this-browser')
    // the session is in IndexedDB alone: never in localStorage or the tab's storage
    for (const s of [local, session])
      for (let i = 0; i < s.length; i++) expect(s.getItem(s.key(i)!)).not.toContain('sealed')
  })

  it('refreshes with the session and a signature of this browser, then is connected again', async () => {
    const p = await page(fake(APP_TOKEN).fetch)
    held.set('session', 'the-session')
    const w = worker()
    expect(await p.resume({ app: APP, fetch: w.fetch, now: () => 1_800_000_000_000 })).toBe(true)
    const { path, body } = w.sent[0]!
    expect([path, body.session, body.at]).toEqual(['/refresh', 'the-session', 1_800_000_000_000])
    // the Worker checks the signature over the same text, with the public half it sealed in
    const pair = held.get('key') as CryptoKeyPair
    const sig = Uint8Array.from(atob(String(body.sig).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
    const text = refreshText(1_800_000_000_000, 'the-session')
    expect(
      await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        pair.publicKey,
        sig,
        new TextEncoder().encode(text),
      ),
    ).toBe(true)
    expect(p.account()).toMatchObject({ connected: true, via: 'app' })
    expect(held.get('session')).toBe('next-session')
    // a second call in this tab asks nothing more
    expect(await p.resume({ app: APP, fetch: w.fetch })).toBe(true)
    expect(w.sent).toHaveLength(1)
  })

  it('signs the text the Worker checks', async () => {
    const p = await page(fake(APP_TOKEN).fetch)
    expect(p.refreshText(5, 'abc')).toBe(refreshText(5, 'abc'))
  })

  it('drops a session the Worker refuses, and keeps one through a network failure', async () => {
    const p = await page(fake(APP_TOKEN).fetch)
    held.set('session', 'the-session')
    const offline = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    expect(await p.resume({ app: APP, fetch: offline })).toBe(false)
    expect(held.get('session')).toBe('the-session')
    const w = worker({ refresh: () => new Response(JSON.stringify({ error: 'expired' }), { status: 401 }) })
    expect(await p.resume({ app: APP, fetch: w.fetch })).toBe(false)
    expect(held.has('session')).toBe(false)
    expect(held.has('key')).toBe(false)
    expect(p.account().connected).toBe(false)
  })

  it('without a session there is nothing to ask', async () => {
    const p = await page(fake(APP_TOKEN).fetch)
    const w = worker()
    expect(await p.resume({ app: APP, fetch: w.fetch })).toBe(false)
    expect(w.sent).toEqual([])
  })

  it('Disconnect revokes the token through the Worker and forgets the key and the session', async () => {
    const p = await page(fake(APP_TOKEN).fetch)
    const w = worker({ session: 'the-session' })
    await p.connect({ app: APP, host: { ...host(APP_TOKEN), fetch: w.fetch } })
    await p.disconnect({ app: APP, fetch: w.fetch })
    expect(w.sent.at(-1)).toEqual({ path: '/revoke', body: { access_token: APP_TOKEN } })
    expect(held.size).toBe(0)
    expect(p.account()).toEqual({ connected: false })
    expect(p.hasToken()).toBe(false)
  })
})
