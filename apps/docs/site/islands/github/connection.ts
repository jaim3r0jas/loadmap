// "Connect to GitHub": the site's GitHub App signs the reader in, in a popup, and the token it brings is this tab's,
// for every call the editor makes: open, save, a new repository, the sealed key. With the browser's own key
// (device.ts), the site's Worker also seals GitHub's refresh token to this browser: a returning reader, or a tab whose
// 8 hours run out, is connected again without a click. Loaded on the first press, or when the bar finds a reader who
// connected before.
import { app as built, EXPIRES, type SignIn } from './account'
import { deviceKey, devicePoint, dropSession, forgetDevice, keepSession, readSession, sign } from './device'
import { forgetRecent } from './repos'
import { disconnect as forget, hasToken, takeToken, tokenNow } from './session'
import { browserHost, type SignedIn, type SignInHost, signInFor } from './signin'

/** The app this build connects with; without it, Connect asks for a pasted token. */
export const app = built

export interface ConnectOptions {
  app?: SignIn
  host?: SignInHost
  /**
   * A popup the press opened already, empty: the sign-in goes there. A press that first loads this code would
   * otherwise open it too late for a browser that wants a fresh click (Safari on a phone).
   */
  popup?: Window | null
  /** The account a reconnect is for: GitHub suggests it. */
  login?: string
}

/** This browser's key, when it can keep one (no IndexedDB in some private windows: then a click on return). */
async function key(): Promise<CryptoKeyPair | undefined> {
  try {
    return await deviceKey()
  } catch {
    return undefined
  }
}

/** Connects through the app; an error whose message the reader can act on. */
export async function connect(o: ConnectOptions = {}): Promise<void> {
  const config = o.app ?? app
  if (!config) {
    o.popup?.close()
    throw new Error('This site has no GitHub App: paste a token instead.')
  }
  const host = o.host ?? browserHost()
  const opened = o.popup
  const pair = await key()
  const got = await signInFor(
    config,
    opened
      ? {
          ...host,
          open: (url) => {
            opened.location.href = url
            return opened
          },
        }
      : host,
    { login: o.login, device: pair && (await devicePoint(pair)) },
  )
  await take(got, config)
}

/**
 * A token is in: this tab's (8 hours, a reload keeps it), the session kept (or the old one dropped: it may be another
 * account's), the next refresh planned.
 */
async function take(got: SignedIn, config: SignIn): Promise<void> {
  const wrong = takeToken(got.token, true, 'app')
  if (wrong) throw new Error(wrong)
  try {
    if (got.session) await keepSession(got.session)
    else await dropSession()
  } catch {
    // not kept: a click on return
  }
  const ends = got.expiresIn ? Date.now() + got.expiresIn * 1000 : undefined
  if (ends)
    try {
      sessionStorage.setItem(EXPIRES, String(ends))
    } catch {
      // planned for this page only
    }
  plan(config, ends)
}

let timer: ReturnType<typeof setTimeout> | undefined

/** A tab left open past its token's hours refreshes five minutes before they end. */
function plan(config: SignIn, ends: number | undefined): void {
  clearTimeout(timer)
  timer = undefined
  if (!ends) return
  timer = setTimeout(() => void resume({ app: config, force: true }), Math.max(0, ends - Date.now() - 300_000))
}

/** A page that loaded with this tab's token plans its refresh again, from when the token ends. */
export function replan(config: SignIn | undefined = app): void {
  if (!config || timer) return
  try {
    const ends = Number(sessionStorage.getItem(EXPIRES))
    if (ends > 0) plan(config, ends)
  } catch {
    // nothing planned: a refused call brings the reader back
  }
}

/** Bumped by Disconnect: a refresh that was under way when it came keeps nothing. */
let generation = 0

/** Two tabs never spend one refresh token: GitHub takes each once. */
function locked<T>(run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks ? locks.request('loadmap-github-refresh', run) : run()
}

/** What the page signs for a refresh: the Worker checks the same text (apps/github-auth/worker.ts). */
export const refreshText = (at: number, session: string) => `loadmap refresh\n${at}\n${session}`

export interface ResumeOptions {
  app?: SignIn
  fetch?: typeof fetch
  now?: () => number
  /** Refresh though this tab holds a token: its hours are running out. */
  force?: boolean
}

/**
 * Connected again without a click, from the session this browser keeps: true when it worked. A session the Worker
 * refuses (GitHub no longer refreshes it, or it is another browser's) is dropped; the bar then offers one click.
 */
export async function resume(o: ResumeOptions = {}): Promise<boolean> {
  const config = o.app ?? app
  if (!config) return false
  return locked(() => refresh(config, o))
}

async function refresh(config: SignIn, o: ResumeOptions, skew = 0): Promise<boolean> {
  // another call got here first, in this tab
  if (hasToken() && !o.force) return true
  const mine = generation
  let session: string | undefined
  let pair: CryptoKeyPair | undefined
  try {
    session = await readSession()
    pair = session ? await deviceKey() : undefined
  } catch {
    return false
  }
  if (!session || !pair) return false
  const at = (o.now ?? Date.now)() + skew
  let res: Response
  try {
    res = await (o.fetch ?? fetch)(`${config.exchange}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, at, sig: await sign(pair, refreshText(at, session)) }),
      credentials: 'omit',
    })
  } catch {
    // offline, or the Worker is away: the session stays for the next try
    return false
  }
  // Disconnect came meanwhile
  if (mine !== generation) return false
  const got = (await res.json().catch(() => ({}))) as {
    access_token?: unknown
    session?: unknown
    expires_in?: unknown
    now?: unknown
  }
  // this browser's clock is off: signed again once, with the Worker's
  if (res.status === 409 && typeof got.now === 'number' && !skew)
    return refresh(config, o, got.now - (o.now ?? Date.now)() || 1)
  if (res.status === 401) {
    await forgetSession()
    return false
  }
  if (!res.ok || typeof got.access_token !== 'string') return false
  await take(
    {
      token: got.access_token,
      ...(typeof got.session === 'string' && { session: got.session }),
      ...(typeof got.expires_in === 'number' && { expiresIn: got.expires_in }),
    },
    config,
  )
  return true
}

async function forgetSession(): Promise<void> {
  try {
    await forgetDevice()
  } catch {
    // nothing kept
  }
}

/** What the page signs for its settings: the Worker checks the same text (apps/github-auth/worker.ts). */
export const settingsText = (at: number, session: string, request: string) =>
  `loadmap settings\n${at}\n${session}\n${request}`

/**
 * A request about the reader's settings, signed with this browser's key over the session it keeps: the Worker's
 * answer, or undefined when there is nothing to sign with (not connected through the app, or no session kept). A
 * session the Worker finds too old is refreshed first, and a clock off is corrected, each once.
 */
export async function signedSettings(request: object, o: ResumeOptions = {}): Promise<Response | undefined> {
  const config = o.app ?? app
  if (!config) return undefined
  const body = JSON.stringify(request)
  const send = async (skew: number) => {
    const session = await readSession().catch(() => undefined)
    const pair = session ? await deviceKey().catch(() => undefined) : undefined
    if (!session || !pair) return undefined
    const at = (o.now ?? Date.now)() + skew
    return (o.fetch ?? fetch)(`${config.exchange}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, at, sig: await sign(pair, settingsText(at, session, body)), request: body }),
      credentials: 'omit',
    })
  }
  let res = await send(0)
  if (res?.status === 409) {
    const got = (await res.json().catch(() => ({}))) as { now?: unknown }
    if (typeof got.now === 'number') res = await send(got.now - (o.now ?? Date.now)() || 1)
  }
  if (res?.status === 401) {
    const got = (await res
      .clone()
      .json()
      .catch(() => ({}))) as { error?: unknown }
    if (got.error === 'stale' && (await resume({ ...o, app: config, force: true }))) res = await send(0)
  }
  return res
}

/**
 * Disconnect: the token revoked at GitHub through the Worker (its 8 hours end now), then everything this browser
 * holds for the connection forgotten, the key and the session too.
 */
export async function disconnect(o: { app?: SignIn; fetch?: typeof fetch } = {}): Promise<void> {
  const config = o.app ?? app
  const token = tokenNow()
  generation++
  clearTimeout(timer)
  timer = undefined
  forget()
  forgetRecent()
  // after any refresh under way in another tab, which would keep its session
  await locked(forgetSession)
  if (config && token?.startsWith('ghu_'))
    try {
      await (o.fetch ?? fetch)(`${config.exchange}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: token }),
        credentials: 'omit',
      })
    } catch {
      // it ends by itself within 8 hours
    }
}
