// A GitHub that answers what the editor asks, from a repository held in memory: the REST calls the editor makes and
// raw.githubusercontent.com. The node tests hand it to the client as `fetch`; the site test routes Chromium's
// requests to it. Nothing here reaches the real GitHub.

export interface FakeFile {
  text: string
  /** 120000 for a symlink; a blob's 100644 otherwise. */
  mode?: string
}

export interface FakeRepo {
  owner: string
  name: string
  private?: boolean
  defaultBranch?: string
  /** Each ref (a branch with "/" too) and its commit's files. */
  refs: Record<string, Record<string, FakeFile | string>>
  truncated?: boolean
  /** The token a private repository answers to. */
  token?: string
}

export interface Call {
  method: string
  url: string
  authorization?: string
  body?: unknown
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...headers },
  })
const text = (body: string) =>
  new Response(body, { status: 200, headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' } })

/** A sha for a ref: forty hex digits from its name, the same every run. */
export function shaOf(s: string): string {
  let h = 0x811c9dc5
  let out = ''
  for (let round = 0; out.length < 40; round++) {
    for (const c of `${round}:${s}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0
    out += h.toString(16).padStart(8, '0')
  }
  return out.slice(0, 40)
}

export function fakeGitHub(repo: FakeRepo, o: { rateLimited?: boolean } = {}) {
  const calls: Call[] = []
  const commits = new Map(Object.keys(repo.refs).map((ref) => [shaOf(`commit:${ref}`), ref]))
  const files = (ref: string) =>
    Object.entries(repo.refs[ref]!).map(([path, f]) => ({
      path,
      ...(typeof f === 'string' ? { text: f, mode: '100644' } : { text: f.text, mode: f.mode ?? '100644' }),
    }))
  const at = (refOrSha: string) => (commits.has(refOrSha) ? commits.get(refOrSha)! : refOrSha)

  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input))
    const headers = new Headers(init.headers)
    const authorization = headers.get('Authorization') ?? undefined
    calls.push({
      method: init.method ?? 'GET',
      url: url.href,
      authorization,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    })
    if (o.rateLimited)
      return json(
        403,
        { message: 'API rate limit exceeded for 1.2.3.4.' },
        { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800' },
      )
    const allowed = !repo.private || (repo.token != null && authorization === `Bearer ${repo.token}`)
    if (url.origin === 'https://raw.githubusercontent.com') {
      const [, owner, name, sha, ...rest] = url.pathname.split('/').map(decodeURIComponent)
      const ref = commits.get(sha!)
      const f = ref != null && owner === repo.owner && name === repo.name && !repo.private && repo.refs[ref]
      const file = f ? files(ref!).find((x) => x.path === rest.join('/')) : undefined
      return file ? text(file.text) : new Response('404: Not Found', { status: 404 })
    }
    if (url.origin !== 'https://api.github.com') throw new TypeError('Failed to fetch')
    const base = `/repos/${repo.owner}/${repo.name}`
    const path = decodeURIComponent(url.pathname)
    if (!allowed || !path.startsWith(base)) return json(404, { message: 'Not Found' })
    const rest = path.slice(base.length)
    if (rest === '')
      return json(200, {
        full_name: `${repo.owner}/${repo.name}`,
        private: !!repo.private,
        default_branch: repo.defaultBranch ?? 'main',
      })
    if (rest.startsWith('/commits/')) {
      const ref = at(rest.slice('/commits/'.length))
      if (!repo.refs[ref]) return json(404, { message: `No commit found for SHA: ${ref}` })
      return text(shaOf(`commit:${ref}`))
    }
    if (rest.startsWith('/git/trees/')) {
      const ref = commits.get(rest.slice('/git/trees/'.length))
      if (ref == null) return json(404, { message: 'Not Found' })
      return json(200, {
        sha: shaOf(`tree:${ref}`),
        truncated: !!repo.truncated,
        tree: files(ref).map((f) => ({
          path: f.path,
          mode: f.mode,
          type: 'blob',
          sha: shaOf(`blob:${f.text}`),
          size: new TextEncoder().encode(f.text).length,
        })),
      })
    }
    if (rest.startsWith('/contents/')) {
      const ref = commits.get(url.searchParams.get('ref') ?? '')
      const file = ref != null ? files(ref).find((f) => f.path === rest.slice('/contents/'.length)) : undefined
      return file ? text(file.text) : json(404, { message: 'Not Found' })
    }
    return json(404, { message: 'Not Found' })
  }
  return { fetch, calls }
}
