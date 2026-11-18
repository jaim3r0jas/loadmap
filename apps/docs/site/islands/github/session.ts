// The page's one way to GitHub, shared by the dialogs and the start from an address, and the token it goes with.
// The token lives in memory; "Keep it for this tab" puts it in sessionStorage, gone with the tab. It never goes into
// localStorage, an address, a share link or a message.
import { client } from './api'

const KEY = 'loadmap-github-token'

function kept(): string | undefined {
  try {
    return sessionStorage.getItem(KEY) ?? undefined
  } catch {
    return undefined
  }
}

let token = kept()

export const gh = client({ token: () => token })

/** The kinds of token GitHub gives: fine-grained, classic, OAuth, a GitHub App's on behalf of a user. */
const SHAPE = /^(github_pat_|ghp_|gho_|ghu_)[A-Za-z0-9_]{20,255}$/

/** Takes the token the reader gave; an error when it is not one GitHub makes. */
export function takeToken(given: string, keep: boolean): string | undefined {
  const t = given.trim()
  if (!SHAPE.test(t)) return 'That is not a GitHub token: one starts with github_pat_ (or ghp_).'
  token = t
  try {
    if (keep) sessionStorage.setItem(KEY, t)
    else sessionStorage.removeItem(KEY)
  } catch {
    // refused: it stays in memory, for this page
  }
  return undefined
}

export function forgetToken(): void {
  token = undefined
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // nothing kept
  }
}

export const hasToken = () => token != null

/**
 * GitHub's page for a new fine-grained token, filled in: its name, the owner of the repository, a week, and the
 * permissions the editor needs (reading the files; writing a branch and opening a pull request for a save). The
 * reader still picks the repository there: GitHub's form takes no repository from an address.
 */
export function tokenPage(owner: string | undefined, need: 'read' | 'write'): string {
  const q = new URLSearchParams({
    name: 'loadmap editor',
    description: 'Opens and saves .loadmap files from the loadmap editor.',
    expires_in: '7',
    contents: need,
  })
  if (owner) q.set('target_name', owner)
  if (need === 'write') q.set('pull_requests', 'write')
  return `https://github.com/settings/personal-access-tokens/new?${q}`
}
