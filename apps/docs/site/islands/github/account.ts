// The reader's connection to GitHub as the editor's bar shows it, from its first draw: whether a token goes with the
// calls, whose it is, and how it came. It imports nothing, so the bar knows this before any GitHub code loads. The
// token itself is never here: session.ts holds it.

/** Where session.ts keeps the token for this tab, when it does, and when the app's token ends (ms). */
export const TOKEN = 'loadmap-github-token'
export const EXPIRES = 'loadmap-github-expires'
/** Who connected last, and how: a login is no secret, and it names the account the next Connect brings back. */
const CARD = 'loadmap-github-account'

export interface Account {
  /** A token goes with GitHub calls now. */
  connected: boolean
  /** The GitHub login, once known: connected now, or the last one (to connect again). */
  login?: string
  /** Through the site's GitHub App, or a token the reader pasted. */
  via?: 'app' | 'token'
}

export interface SignIn {
  /** The GitHub App's client id and its name on github.com (github.com/apps/<slug>). */
  clientId: string
  slug: string
  /** The Worker that swaps a code for a token. */
  exchange: string
}

/** The app this build connects with, when it was given one (`VITE_GITHUB_APP_*`); without it the reader pastes a token. */
export function signInConfig(env: Record<string, string | undefined> = import.meta.env): SignIn | undefined {
  const clientId = env.VITE_GITHUB_APP_CLIENT_ID?.trim()
  const slug = env.VITE_GITHUB_APP_SLUG?.trim()
  const exchange = env.VITE_GITHUB_APP_EXCHANGE?.trim()
  if (!clientId || !slug || !exchange) return undefined
  // https, or plain http to this machine only (a Worker run with wrangler dev): never a string prefix, which
  // http://localhost.example.com would pass
  try {
    const u = new URL(exchange)
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === 'localhost')) return undefined
    if (u.username || u.password) return undefined
  } catch {
    return undefined
  }
  return { clientId, slug, exchange: exchange.replace(/\/+$/, '') }
}

/** The app this build connects with: one reading, for the bar, the dialogs and the connection. */
export const app = signInConfig()

/** Where the reader puts the app on the repositories it may reach. */
export const installUrl = (app: SignIn) => `https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new`

function readCard(): Pick<Account, 'login' | 'via'> {
  try {
    const c = JSON.parse(localStorage.getItem(CARD) ?? 'null') as { login?: unknown; via?: unknown } | null
    // a login as GitHub makes them, and nothing else: the bar shows it as text
    if (typeof c?.login !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(c.login)) return {}
    return { login: c.login, via: c.via === 'token' ? 'token' : 'app' }
  } catch {
    return {}
  }
}

function kept(): boolean {
  try {
    return sessionStorage.getItem(TOKEN) != null
  } catch {
    return false
  }
}

let now: Account = { connected: kept(), ...readCard() }
const heard = new Set<(a: Account) => void>()

export const account = (): Account => now

/** Hears every change of the connection; the return stops it. */
export function onAccount(hear: (a: Account) => void): () => void {
  heard.add(hear)
  return () => heard.delete(hear)
}

/** The connection as it is now: the card is kept with the login, or dropped with `forget`. */
export function setAccount(next: Account, o: { forget?: boolean } = {}): void {
  now = next
  try {
    if (o.forget) localStorage.removeItem(CARD)
    else if (next.login) localStorage.setItem(CARD, JSON.stringify({ login: next.login, via: next.via }))
  } catch {
    // refused: the bar shows it for this page
  }
  for (const h of heard) h(now)
}
