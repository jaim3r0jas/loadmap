// The one thing a static page cannot do for "Sign in with GitHub": swap the code GitHub gives the popup for a token.
// GitHub's token endpoint answers no browser (no CORS) and wants the app's client secret even with PKCE, so this
// Worker holds the secret and does that swap, nothing else: one path, the site's own origins only, the PKCE verifier
// passed through, no refresh token handed out, nothing logged. It runs on Cloudflare Workers (apps/github-auth/README.md).

export interface Env {
  /** The GitHub App's client id (public) and secret (a Worker secret, never in the page or the repository). */
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  /** The origins that may ask, comma-separated: the docs site, and a dev server if wanted. */
  ALLOWED_ORIGINS: string
}

const GITHUB = 'https://github.com/login/oauth/access_token'
/** A request larger than this is no code swap. */
const MAX_BODY = 4096
const CODE = /^[A-Za-z0-9_-]{1,128}$/
/** RFC 7636: 43 to 128 of the unreserved characters. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  })

export async function handle(req: Request, env: Env, call: typeof fetch = fetch): Promise<Response> {
  // a deploy that dropped its settings says so, plainly, rather than failing on them
  if (!env.ALLOWED_ORIGINS || !env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET)
    return json(500, { error: 'not_configured' })
  const allowed = env.ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  const origin = req.headers.get('Origin') ?? ''
  const ok = allowed.includes(origin)
  const cors: Record<string, string> = ok
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      }
    : { Vary: 'Origin' }
  if (new URL(req.url).pathname !== '/token') return json(404, { error: 'not_found' }, cors)
  if (req.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method' }, { ...cors, Allow: 'POST, OPTIONS' })
  if (!ok) return json(403, { error: 'origin' }, cors)
  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_BODY) return json(413, { error: 'too_large' }, cors)
  const text = await req.text()
  if (text.length > MAX_BODY) return json(413, { error: 'too_large' }, cors)
  let body: { code?: unknown; code_verifier?: unknown; redirect_uri?: unknown }
  try {
    body = JSON.parse(text)
  } catch {
    return json(400, { error: 'bad_request' }, cors)
  }
  const { code, code_verifier, redirect_uri } = body
  // the popup came back to the asking site: its sign-in page, never somewhere else
  const back =
    typeof redirect_uri === 'string' && allowed.some((o) => redirect_uri.startsWith(`${o}/`)) ? redirect_uri : null
  if (
    typeof code !== 'string' ||
    !CODE.test(code) ||
    typeof code_verifier !== 'string' ||
    !VERIFIER.test(code_verifier) ||
    !back
  )
    return json(400, { error: 'bad_request' }, cors)
  let res: Response
  try {
    res = await call(GITHUB, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        code_verifier,
        redirect_uri: back,
      }),
    })
  } catch {
    return json(502, { error: 'github_unreachable' }, cors)
  }
  const got = (await res.json().catch(() => ({}))) as {
    access_token?: unknown
    token_type?: unknown
    expires_in?: unknown
    error?: unknown
    error_description?: unknown
  }
  if (typeof got.access_token !== 'string') {
    const error = typeof got.error === 'string' ? got.error : 'no_token'
    const description = typeof got.error_description === 'string' ? got.error_description : undefined
    return json(400, { error, ...(description && { error_description: description }) }, cors)
  }
  // the refresh token stays out: a page that cannot keep a secret signs in again after the token's 8 hours
  return json(
    200,
    {
      access_token: got.access_token,
      token_type: typeof got.token_type === 'string' ? got.token_type : 'bearer',
      ...(typeof got.expires_in === 'number' && { expires_in: got.expires_in }),
    },
    cors,
  )
}

export default { fetch: (req: Request, env: Env) => handle(req, env) }
