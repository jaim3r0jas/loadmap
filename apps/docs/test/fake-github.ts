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
  /** Files past the cut of a truncated tree: there, but not listed. */
  hidden?: string[]
  /** The token a private repository answers to, and the one that may write to any. */
  token?: string
  /** GitHub refuses a pull request with this message. */
  refusePull?: string
  /**
   * `POST /user/repos` makes this repository (its `refs` as GitHub's README leaves them); the first reads of its branch
   * answer 404 this many times, as GitHub does while it writes the README.
   */
  creatable?: { notYet?: number }
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
  /** Branches made through the API, and the parent of each commit made, by sha. */
  const made = new Map<string, string>()
  const parents = new Map<string, string>()
  const commits = new Map(Object.keys(repo.refs).map((ref) => [shaOf(`commit:${ref}`), ref]))
  const files = (ref: string) =>
    Object.entries(repo.refs[ref]!).map(([path, f]) => ({
      path,
      ...(typeof f === 'string' ? { text: f, mode: '100644' } : { text: f.text, mode: f.mode ?? '100644' }),
    }))
  const at = (refOrSha: string) => (commits.has(refOrSha) ? commits.get(refOrSha)! : refOrSha)
  const tip = (b: string) => made.get(b) ?? (repo.refs[b] ? shaOf(`commit:${b}`) : undefined)

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
    const signed = repo.token != null && authorization === `Bearer ${repo.token}`
    const allowed = !repo.private || signed
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
    // the token's own account: the bar shows its login
    if (path === '/user' && (init.method ?? 'GET') === 'GET') {
      if (!authorization) return json(401, { message: 'Requires authentication' })
      return signed ? json(200, { login: repo.owner, id: 1 }) : json(401, { message: 'Bad credentials' })
    }
    if (path === '/user/repos' && init.method === 'POST') {
      if (repo.token == null || authorization !== `Bearer ${repo.token}`)
        return json(403, { message: 'Resource not accessible by personal access token' })
      const body = JSON.parse(String(init.body ?? '{}'))
      if (!repo.creatable || body.name !== repo.name)
        return json(422, { message: 'name already exists on this account' })
      repo.private = !!body.private
      return json(201, {
        name: repo.name,
        owner: { login: repo.owner },
        html_url: `https://github.com/${repo.owner}/${repo.name}`,
        default_branch: repo.defaultBranch ?? 'main',
      })
    }
    if (!allowed || !path.startsWith(base)) return json(404, { message: 'Not Found' })
    const rest = path.slice(base.length)
    const method = init.method ?? 'GET'
    if (method !== 'GET') {
      if (!authorization) return json(401, { message: 'Requires authentication' })
      if (!signed) return json(403, { message: 'Resource not accessible by personal access token' })
      const body = JSON.parse(String(init.body ?? '{}'))
      if (method === 'POST' && rest === '/git/trees') return json(201, { sha: shaOf(`tree:${init.body}`) })
      if (method === 'POST' && rest === '/git/commits') {
        const sha = shaOf(`made:${init.body}`)
        parents.set(sha, body.parents[0])
        return json(201, { sha })
      }
      if (method === 'POST' && rest === '/git/refs') {
        const b = String(body.ref).replace(/^refs\/heads\//, '')
        if (tip(b)) return json(422, { message: 'Reference already exists' })
        made.set(b, body.sha)
        return json(201, { ref: body.ref, object: { sha: body.sha } })
      }
      if (method === 'PATCH' && rest.startsWith('/git/refs/heads/')) {
        const b = rest.slice('/git/refs/heads/'.length)
        if (!tip(b)) return json(422, { message: 'Reference does not exist' })
        // a fast forward: the branch's commit is among the new one's ancestors, however many commits back
        const ahead = (sha: string | undefined, n = 0): boolean =>
          sha != null && n < 1000 && (sha === tip(b) || ahead(parents.get(sha), n + 1))
        if (!body.force && body.sha !== tip(b) && !ahead(parents.get(body.sha)))
          return json(422, { message: 'Update is not a fast forward' })
        made.set(b, body.sha)
        return json(200, { ref: `refs/heads/${b}`, object: { sha: body.sha } })
      }
      if (method === 'POST' && rest === '/pulls') {
        if (repo.refusePull) return json(422, { message: repo.refusePull })
        return json(201, { number: 7, html_url: `https://github.com/${repo.owner}/${repo.name}/pull/7` })
      }
      return json(404, { message: 'Not Found' })
    }
    if (rest.startsWith('/git/ref/heads/')) {
      const b = rest.slice('/git/ref/heads/'.length)
      if (repo.creatable?.notYet) {
        repo.creatable.notYet--
        return json(404, { message: 'Not Found' })
      }
      return tip(b)
        ? json(200, { ref: `refs/heads/${b}`, object: { sha: tip(b) } })
        : json(404, { message: 'Not Found' })
    }
    if (rest.startsWith('/git/commits/')) {
      const ref = commits.get(rest.slice('/git/commits/'.length))
      return ref == null ? json(404, { message: 'Not Found' }) : json(200, { tree: { sha: shaOf(`tree:${ref}`) } })
    }
    if (rest === '')
      return json(200, {
        full_name: `${repo.owner}/${repo.name}`,
        private: !!repo.private,
        default_branch: repo.defaultBranch ?? 'main',
      })
    if (rest.startsWith('/branches/')) {
      const b = rest.slice('/branches/'.length)
      return repo.refs[b] || made.has(b) ? json(200, { name: b }) : json(404, { message: 'Branch not found' })
    }
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
        tree: files(ref)
          .filter((f) => !repo.hidden?.includes(f.path))
          .map((f) => ({
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
  /** A branch moves on GitHub, as when someone else pushes to it. */
  const push = (branch: string, sha: string) => void made.set(branch, sha)
  return { fetch, calls, made, push }
}
