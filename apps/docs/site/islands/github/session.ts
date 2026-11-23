// The page's one way to GitHub, shared by the dialogs, the bar's account and the start from an address, and the token
// it goes with. The token lives in memory; a connection through the site's app, or "Keep it for this tab" for a pasted
// one, puts it in sessionStorage, gone with the tab. It never goes into localStorage, an address, a share link or a
// message. account.ts tells the bar what changed.
import { account, EXPIRES, setAccount, TOKEN } from './account'
import { client } from './api'

function kept(): string | undefined {
  try {
    return sessionStorage.getItem(TOKEN) ?? undefined
  } catch {
    return undefined
  }
}

let token = kept()

// a token GitHub refuses is gone, unless another took its place meanwhile: the bar offers to connect again
export const gh = client({
  token: () => token,
  refused: (sent) => {
    if (sent !== token) return
    dropToken()
    setAccount({ ...account(), connected: false })
  },
})

/** The kinds of token GitHub gives: fine-grained, classic, OAuth, a GitHub App's on behalf of a user. */
const SHAPE = /^(github_pat_|ghp_|gho_|ghu_)[A-Za-z0-9_]{20,255}$/

/**
 * Takes the token the reader gave (`via: 'token'`) or the app's sign-in brought (`'app'`); an error when it is not one
 * GitHub makes. The login is looked up after, for the bar.
 */
export function takeToken(given: string, keep: boolean, via: 'app' | 'token' = 'token'): string | undefined {
  const t = given.trim()
  if (!SHAPE.test(t)) return 'That is not a GitHub token: one starts with github_pat_ (or ghp_).'
  token = t
  try {
    if (keep) sessionStorage.setItem(TOKEN, t)
    else sessionStorage.removeItem(TOKEN)
  } catch {
    // refused: it stays in memory, for this page
  }
  // whose it is, only GitHub says: the bar names nobody until the lookup answers
  setAccount({ connected: true, via })
  void whoami(t)
  return undefined
}

/** The token's login, once: the bar shows it, and the next Connect names it. */
async function whoami(t: string): Promise<void> {
  try {
    const { login } = await gh.json<{ login: string }>('/user')
    // a later token, or none, took its place meanwhile
    if (token === t && typeof login === 'string') setAccount({ ...account(), connected: true, login })
  } catch {
    // the bar shows the connection without a name
  }
}

function dropToken(): void {
  token = undefined
  try {
    sessionStorage.removeItem(TOKEN)
    sessionStorage.removeItem(EXPIRES)
  } catch {
    // nothing kept
  }
}

/** Disconnect: the token and the last login, all this browser kept of the connection. */
export function disconnect(): void {
  dropToken()
  setAccount({ connected: false }, { forget: true })
}

export const hasToken = () => token != null

/** The token itself, for the one call that needs it outside the client: revoking it on Disconnect. */
export const tokenNow = () => token

/** Whether the token came from the site's GitHub App (on the reader's behalf): it does what the app may. */
export const signedIn = () => token != null && account().via === 'app'

/**
 * GitHub's page for a new fine-grained token, filled in: its name, the owner of the repository, a week, and the
 * permissions the editor needs (reading the files; writing a branch and opening a pull request for a save). The
 * reader still picks the repository there: GitHub's form takes no repository from an address.
 */
export function tokenPage(owner: string | undefined, need: 'read' | 'write' | 'create'): string {
  const q = new URLSearchParams({
    name: 'loadmap editor',
    description: 'Opens and saves .loadmap files from the loadmap editor.',
    expires_in: '7',
    contents: need === 'read' ? 'read' : 'write',
  })
  if (owner) q.set('target_name', owner)
  if (need === 'write') q.set('pull_requests', 'write')
  // making a repository is an administration right, on every repository of the account: a new one is in no list yet
  if (need === 'create') q.set('administration', 'write')
  return `https://github.com/settings/personal-access-tokens/new?${q}`
}
