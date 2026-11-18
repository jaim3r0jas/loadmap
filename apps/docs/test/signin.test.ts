import { describe, expect, it } from 'vitest'
import {
  backTo,
  challengeOf,
  installUrl,
  type SignIn,
  type SignInHost,
  signIn,
  signInConfig,
} from '../site/islands/github/signin'

const APP: SignIn = { clientId: 'Iv23li0000', slug: 'loadmap-editor', exchange: 'https://auth.example.workers.dev' }
const ORIGIN = 'https://example.github.io'

/** A browser for one sign-in: the popup it opens, what it hears, what it sends the Worker. */
function host(answer: unknown = { access_token: 'ghu_abc' }, popupOpens = true) {
  const popup = { closed: false } as unknown as Window
  let hear: ((e: MessageEvent) => void) | undefined
  const sent: { url: string; body: Record<string, string> }[] = []
  const opened: string[] = []
  const h: SignInHost = {
    open: (url) => {
      opened.push(url)
      return popupOpens ? popup : null
    },
    listen: (on) => {
      hear = on
      return () => {
        hear = undefined
      }
    },
    origin: ORIGIN,
    back: `${ORIGIN}/loadmap/signed-in/`,
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) })
      return new Response(JSON.stringify(answer))
    }) as unknown as typeof fetch,
  }
  const say = (data: unknown, o: { origin?: string; source?: unknown } = {}) =>
    hear?.({ origin: o.origin ?? ORIGIN, source: o.source ?? popup, data } as MessageEvent)
  const state = () => new URL(opened[0]!).searchParams.get('state')!
  return { h, popup, say, sent, opened, state, listening: () => !!hear }
}

/** Until the popup is open: the challenge is hashed first, asynchronously. */
const opened = async (b: { opened: string[] }) => {
  while (!b.opened.length) await new Promise((r) => setTimeout(r, 5))
}

describe('Sign in with GitHub', () => {
  it("makes RFC 7636's S256 challenge", async () => {
    expect(await challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('is there only when the build was given the whole app, its exchange over https', () => {
    const env = {
      VITE_GITHUB_APP_CLIENT_ID: 'Iv23li0000',
      VITE_GITHUB_APP_SLUG: 'loadmap-editor',
      VITE_GITHUB_APP_EXCHANGE: 'https://auth.example.workers.dev/',
    }
    expect(signInConfig(env)).toEqual(APP)
    expect(signInConfig({ ...env, VITE_GITHUB_APP_SLUG: '' })).toBeUndefined()
    expect(signInConfig({ ...env, VITE_GITHUB_APP_EXCHANGE: 'http://auth.example' })).toBeUndefined()
    // plain http to this machine only, never a name that starts like it
    expect(signInConfig({ ...env, VITE_GITHUB_APP_EXCHANGE: 'http://localhost:8787' })?.exchange).toBe(
      'http://localhost:8787',
    )
    for (const bad of ['http://localhost.example.com', 'http://localhost@example.com', 'https://u:p@auth.example'])
      expect(signInConfig({ ...env, VITE_GITHUB_APP_EXCHANGE: bad }), bad).toBeUndefined()
    expect(signInConfig({})).toBeUndefined()
    expect(installUrl(APP)).toBe('https://github.com/apps/loadmap-editor/installations/new')
    expect(backTo('https://example.github.io/loadmap/editor/?repo=a/b')).toBe(
      'https://example.github.io/loadmap/signed-in/',
    )
  })

  it("opens GitHub's page with PKCE and a state, takes the code its own page posts back, and swaps it", async () => {
    const b = host()
    const token = signIn(APP, b.h)
    await opened(b)
    const asked = new URL(b.opened[0]!)
    expect(asked.origin + asked.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(Object.fromEntries(asked.searchParams)).toMatchObject({
      client_id: APP.clientId,
      redirect_uri: b.h.back,
      code_challenge_method: 'S256',
    })
    // another page, another window, another sign-in: not heard
    b.say({ type: 'loadmap-github-sign-in', state: b.state(), code: 'x' }, { origin: 'https://evil.example' })
    b.say({ type: 'loadmap-github-sign-in', state: b.state(), code: 'x' }, { source: {} })
    b.say({ type: 'loadmap-github-sign-in', state: 'another', code: 'x' })
    expect(b.listening()).toBe(true)
    b.say({ type: 'loadmap-github-sign-in', state: b.state(), code: 'the-code' })
    expect(await token).toBe('ghu_abc')
    expect(b.listening()).toBe(false)
    const [swap] = b.sent
    expect(swap!.url).toBe('https://auth.example.workers.dev/token')
    expect(swap!.body).toMatchObject({ code: 'the-code', redirect_uri: b.h.back })
    // the verifier sent is the one the challenge was made from
    expect(await challengeOf(swap!.body.code_verifier!)).toBe(asked.searchParams.get('code_challenge'))
  })

  it('says why it did not sign in: a blocked popup, a closed one, a refusal', async () => {
    await expect(signIn(APP, host(undefined, false).h)).rejects.toThrow('The browser blocked the sign-in window')
    const closed = host()
    const gone = signIn(APP, closed.h)
    await opened(closed)
    ;(closed.popup as { closed: boolean }).closed = true
    await expect(gone).rejects.toThrow('The sign-in window closed before GitHub answered.')
    const refused = host({ error: 'bad_verification_code', error_description: 'The code passed is incorrect.' })
    const no = signIn(APP, refused.h)
    await opened(refused)
    refused.say({ type: 'loadmap-github-sign-in', state: refused.state(), code: 'c' })
    await expect(no).rejects.toThrow('GitHub did not sign you in: The code passed is incorrect.')
    const denied = host()
    const nope = signIn(APP, denied.h)
    await opened(denied)
    denied.say({ type: 'loadmap-github-sign-in', state: denied.state(), code: null, error: 'access_denied' })
    await expect(nope).rejects.toThrow('GitHub did not sign you in: access_denied')
  })
})
