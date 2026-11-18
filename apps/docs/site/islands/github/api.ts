// The one way the editor talks to GitHub. Two hosts and no other: the REST API, and raw.githubusercontent.com for a
// public file's text (it answers any origin and counts against no API limit). The token, when there is one, goes to
// the API only, never into an address, a message or a log.

export const API = 'https://api.github.com'
export const RAW = 'https://raw.githubusercontent.com'

/** Why a call failed, as the reader can act on it. */
export type GitHubFailure =
  | 'missing' // 404: no such repository, ref or file, or a private one this browser may not see
  | 'auth' // 401: the token is wrong or expired
  | 'forbidden' // 403: the token may not do this
  | 'rate' // the hourly limit is used up
  | 'exists' // 422 on a ref: the branch is there already
  | 'invalid' // another 422: GitHub refused what was sent
  | 'conflict' // 409: an empty repository, or a ref that moved
  | 'network' // no answer at all
  | 'other'

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly failure: GitHubFailure,
    readonly status = 0,
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

export interface ClientOptions {
  /** The token for this tab, read at each call so a token given later counts; undefined without one. */
  token?: () => string | undefined
  fetch?: typeof fetch
  /** The time in ms, for "the limit resets in N minutes": the tests set it. */
  now?: () => number
}

/** One segment of an API path: a name from the reader or a repository never adds a "/" or a "?" of its own. */
export const seg = (s: string) => encodeURIComponent(s)
/** A path in a repository, each folder encoded on its own. */
export const filePath = (path: string) => path.split('/').map(seg).join('/')

export interface Client {
  /** A JSON call to the API: `path` from the API's root (`/repos/o/r`). */
  json<T>(path: string, init?: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown }): Promise<T>
  /** A text answer from the API: a file's raw text, a commit's sha. */
  text(path: string, accept: string): Promise<string>
  /** A public file's text at a commit, from raw.githubusercontent.com. */
  raw(owner: string, name: string, sha: string, path: string): Promise<string>
  /** Whether a token goes with the calls now. */
  signed(): boolean
}

export function client(o: ClientOptions = {}): Client {
  const call = o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))
  const now = o.now ?? (() => Date.now())
  const token = () => o.token?.() || undefined

  async function send(url: string, init: RequestInit): Promise<Response> {
    let res: Response
    try {
      res = await call(url, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' })
    } catch {
      throw new GitHubError('GitHub could not be reached. Check the connection and try again.', 'network')
    }
    if (res.ok) return res
    throw await failure(res, Boolean((init.headers as Record<string, string> | undefined)?.Authorization))
  }

  async function failure(res: Response, signed: boolean): Promise<GitHubError> {
    let said = ''
    try {
      const body = (await res.json()) as { message?: unknown }
      if (typeof body.message === 'string') said = body.message
    } catch {
      // a body that is not JSON says nothing more
    }
    const s = res.status
    const left = res.headers.get('x-ratelimit-remaining')
    if (s === 429 || (s === 403 && (left === '0' || /rate limit/i.test(said)))) {
      const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000
      const mins = Number.isFinite(reset) && reset > 0 ? Math.max(1, Math.ceil((reset - now()) / 60_000)) : 0
      const when = mins ? ` It resets in ${mins} minute${mins === 1 ? '' : 's'}.` : ''
      return new GitHubError(
        signed
          ? `GitHub's hourly limit for your token is used up.${when}`
          : `GitHub's hourly limit for reading without a token is used up.${when} A token raises it.`,
        'rate',
        s,
      )
    }
    if (s === 401)
      return new GitHubError('GitHub refused the token: it may be wrong or expired. Give a new one.', 'auth', s)
    if (s === 403) return new GitHubError('GitHub refused: the token may not do this here.', 'forbidden', s)
    if (s === 404) return new GitHubError('GitHub has nothing there.', 'missing', s)
    if (s === 409)
      return new GitHubError('GitHub refused: the repository is empty or changed meanwhile.', 'conflict', s)
    if (s === 422 && /already exists/i.test(said))
      return new GitHubError('A branch with that name is there already. Pick another name.', 'exists', s)
    if (s === 422) return new GitHubError(`GitHub refused what was sent: ${short(said)}`, 'invalid', s)
    return new GitHubError(`GitHub answered ${s}. Try again in a moment.`, 'other', s)
  }

  const headers = (accept: string): Record<string, string> => {
    const t = token()
    return {
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    }
  }

  const api = (path: string) => {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error(`not an API path: ${path}`)
    return `${API}${path}`
  }

  return {
    async json<T>(path: string, init: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {}) {
      const h = headers('application/vnd.github+json')
      if (init.body !== undefined) h['Content-Type'] = 'application/json'
      const res = await send(api(path), {
        method: init.method ?? 'GET',
        headers: h,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      })
      return (await res.json()) as T
    },
    async text(path: string, accept: string) {
      return (await send(api(path), { headers: headers(accept) })).text()
    },
    async raw(owner: string, name: string, sha: string, path: string) {
      // no token here: raw.githubusercontent.com refuses one from a browser, and it must never leave the API
      const res = await send(`${RAW}/${seg(owner)}/${seg(name)}/${seg(sha)}/${filePath(path)}`, {})
      return res.text()
    },
    signed: () => !!token(),
  }
}

/** GitHub's own words, cut to a sentence's length: shown as text, never as markup. */
function short(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > 160 ? `${one.slice(0, 157)}…` : one || 'no reason given'
}
