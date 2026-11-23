// "Connect to GitHub": the site's GitHub App signs the reader in, in a popup, and the token it brings is this tab's,
// for every call the editor makes: open, save, a new repository, the sealed key. With the browser's own key
// (device.ts), the site's Worker also seals GitHub's refresh token to this browser: a returning reader, or a tab whose
// 8 hours run out, is connected again without a click. Loaded on the first press, or when the bar finds a reader who
// connected before.
import { app as built, type SignIn } from './account'
import { deviceKey, devicePoint, forgetDevice, keepSession, readSession, sign } from './device'
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

/** A token is in: this tab's (8 hours, a reload keeps it), the next session kept, the next refresh planned. */
async function take(got: SignedIn, config: SignIn): Promise<void> {
  const wrong = takeToken(got.token, true, 'app')
  if (wrong) throw new Error(wrong)
  if (got.session)
    try {
      await keepSession(got.session)
    } catch {
      // not kept: a click on return
    }
  plan(got.expiresIn, config)
}

let timer: ReturnType<typeof setTimeout> | undefined

/** A tab left open past its token's hours refreshes five minutes before they end. */
function plan(seconds: number | undefined, config: SignIn): void {
  clearTimeout(timer)
  if (!seconds || seconds < 600) return
  timer = setTimeout(() => void resume({ app: config, force: true }), (seconds - 300) * 1000)
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
  const once = () => refresh(config, o)
  // two tabs never spend one refresh token: GitHub takes each once
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks ? locks.request('loadmap-github-refresh', once) : once()
}

async function refresh(config: SignIn, o: ResumeOptions): Promise<boolean> {
  // another call got here first, in this tab
  if (hasToken() && !o.force) return true
  let session: string | undefined
  let pair: CryptoKeyPair | undefined
  try {
    session = await readSession()
    pair = session ? await deviceKey() : undefined
  } catch {
    return false
  }
  if (!session || !pair) return false
  const at = (o.now ?? Date.now)()
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
  if (res.status === 401) {
    await forgetSession()
    return false
  }
  if (!res.ok) return false
  const got = (await res.json().catch(() => ({}))) as {
    access_token?: unknown
    session?: unknown
    expires_in?: unknown
  }
  if (typeof got.access_token !== 'string') return false
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

/**
 * Disconnect: the token revoked at GitHub through the Worker (its 8 hours end now), then everything this browser
 * holds for the connection forgotten, the key and the session too.
 */
export async function disconnect(o: { app?: SignIn; fetch?: typeof fetch } = {}): Promise<void> {
  const config = o.app ?? app
  const token = tokenNow()
  clearTimeout(timer)
  forget()
  await forgetSession()
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
