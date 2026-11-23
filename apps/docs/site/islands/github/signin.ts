// "Sign in with GitHub": the GitHub App's authorization in a popup, with PKCE, and the code it gives back swapped for a
// token by the site's Worker (apps/github-auth), which holds the app's secret: GitHub's token endpoint answers no
// browser. Only when the build was given the app (VITE_GITHUB_APP_*); without it the reader pastes a token.

import type { SignIn } from './account'

export { installUrl, type SignIn, signInConfig } from './account'

/** Where the popup comes back to: the site's own page for it, next to the editor. */
export const backTo = (page: string = location.href) => new URL('../signed-in/', page).href

export const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

/** RFC 7636's S256: the challenge is the verifier's SHA-256, base64url. */
export async function challengeOf(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}

/** A PKCE verifier or a state: 32 random bytes, base64url. */
export const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)))

/** GitHub's authorization page for the app, for this sign-in. */
export function authorizeUrl(
  app: SignIn,
  o: { state: string; challenge: string; back: string; login?: string },
): string {
  const q = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: o.back,
    state: o.state,
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
  })
  // a reconnect names the account it is for: GitHub suggests it, and offers to switch when another is signed in
  if (o.login) q.set('login', o.login)
  return `https://github.com/login/oauth/authorize?${q}`
}

export interface SignInHost {
  open: (url: string) => Window | null
  /** Hears what the popup's page posts back. */
  listen: (on: (e: MessageEvent) => void) => () => void
  origin: string
  back: string
  fetch: typeof fetch
}

/** The browser's own way: a popup, its messages, this page's origin. */
export const browserHost = (): SignInHost => ({
  open: (url) => window.open(url, 'loadmap-github-sign-in', 'popup,width=520,height=720'),
  listen: (on) => {
    addEventListener('message', on)
    return () => removeEventListener('message', on)
  },
  origin: location.origin,
  back: backTo(),
  fetch: (input, init) => fetch(input, init),
})

/** What a sign-in brings: the token, and with a browser key the session sealed to it, for coming back. */
export interface SignedIn {
  token: string
  session?: string
  /** The token's lifetime in seconds, when GitHub says. */
  expiresIn?: number
}

/** Signs in through the popup; what it brings, or an error whose message the reader can act on. */
export async function signInFor(
  app: SignIn,
  host: SignInHost = browserHost(),
  o: { login?: string; device?: { x: string; y: string } } = {},
): Promise<SignedIn> {
  const login = o.login
  const state = random()
  const verifier = random()
  const popup = host.open(authorizeUrl(app, { state, challenge: await challengeOf(verifier), back: host.back, login }))
  if (!popup) throw new Error('The browser blocked the sign-in window: allow pop-ups for this page and try again.')
  const code = await new Promise<string>((resolve, reject) => {
    let watch: ReturnType<typeof setInterval> | undefined
    let stop = () => {}
    const done = (then: () => void) => {
      clearInterval(watch)
      stop()
      then()
    }
    // the popup closed with no answer: the reader gave up, or GitHub never came back
    watch = setInterval(() => {
      if (popup.closed) done(() => reject(new Error('The sign-in window closed before GitHub answered.')))
    }, 500)
    stop = host.listen((e) => {
      // only the site's own page, in that popup, for this sign-in
      if (e.origin !== host.origin || e.source !== popup) return
      const m = e.data as { type?: unknown; state?: unknown; code?: unknown; error?: unknown } | null
      if (m?.type !== 'loadmap-github-sign-in' || m.state !== state) return
      if (typeof m.code === 'string' && m.code) done(() => resolve(m.code as string))
      else
        done(() => reject(new Error(`GitHub did not sign you in${typeof m.error === 'string' ? `: ${m.error}` : '.'}`)))
    })
  })
  let res: Response
  try {
    res = await host.fetch(`${app.exchange}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        redirect_uri: host.back,
        ...(o.device && { device: o.device }),
      }),
      credentials: 'omit',
    })
  } catch {
    throw new Error('The sign-in service could not be reached. Try again, or paste a token.')
  }
  const got = (await res.json().catch(() => ({}))) as {
    access_token?: unknown
    session?: unknown
    expires_in?: unknown
    error_description?: unknown
  }
  if (typeof got.access_token !== 'string')
    throw new Error(
      `GitHub did not sign you in${typeof got.error_description === 'string' ? `: ${got.error_description}` : '.'}`,
    )
  return {
    token: got.access_token,
    ...(typeof got.session === 'string' && { session: got.session }),
    ...(typeof got.expires_in === 'number' && { expiresIn: got.expires_in }),
  }
}

/** Signs in through the popup; the token alone. */
export async function signIn(app: SignIn, host: SignInHost = browserHost(), login?: string): Promise<string> {
  return (await signInFor(app, host, { login })).token
}
