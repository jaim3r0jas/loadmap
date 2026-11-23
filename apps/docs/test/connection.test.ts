// The one connection to GitHub: what the bar reads before any GitHub code loads, what Connect keeps and where, what
// a refused token and Disconnect leave. Nothing reaches the real GitHub: the fake answers every call.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

beforeEach(() => {
  local = new Store()
  session = new Store()
  vi.stubGlobal('localStorage', local)
  vi.stubGlobal('sessionStorage', session)
  vi.resetModules()
})
afterEach(() => vi.unstubAllGlobals())

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

  it('a pasted token connects for the page, or the tab when kept, and shows its own login', async () => {
    local.setItem('loadmap-github-account', JSON.stringify({ login: 'someone-else', via: 'app' }))
    const p = await page(fake(PASTED).fetch)
    expect(p.takeToken('hunter2', false)).toMatch(/not a GitHub token/)
    expect(p.takeToken(PASTED, false)).toBeUndefined()
    // the app's last login is not this token's
    expect(p.account()).toEqual({ connected: true, via: 'token', login: undefined })
    await until(() => p.account().login === 'acme')
    expect(session.getItem('loadmap-github-token')).toBeNull()
    p.takeToken(PASTED, true)
    expect(session.getItem('loadmap-github-token')).toBe(PASTED)
  })

  it('Disconnect forgets the token and the account; Forget keeps the login to connect again', async () => {
    const p = await page(fake(APP_TOKEN).fetch)
    await p.connect({ app: APP, host: host(APP_TOKEN) })
    await until(() => p.account().login === 'acme')
    p.forgetToken()
    expect(p.account()).toEqual({ connected: false, via: 'app', login: 'acme' })
    p.disconnect()
    expect(p.account()).toEqual({ connected: false })
    expect(p.hasToken()).toBe(false)
    expect(local.getItem('loadmap-github-account')).toBeNull()
    expect(session.getItem('loadmap-github-token')).toBeNull()
  })

  it('without an app, Connect says to paste a token', async () => {
    const p = await page(fake(APP_TOKEN).fetch)
    // this test's build has no VITE_GITHUB_APP_*
    expect(p.app).toBeUndefined()
    await expect(p.connect()).rejects.toThrow('paste a token')
  })
})
