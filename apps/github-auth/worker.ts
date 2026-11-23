// What a static page cannot do for "Connect to GitHub": swap the code GitHub gives the popup for a token, bring a
// returning reader back without a click, and remember the reader's model settings. GitHub's token endpoint answers no
// browser (no CORS) and wants the app's client secret even with PKCE, so this Worker holds the secret and does those
// things, nothing else: four paths, the site's own origins only, the PKCE verifier passed through, nothing logged, and
// nothing stored but each reader's sealed settings (store.ts). GitHub's refresh token never reaches the page as it is:
// the page gets it sealed with SEAL_KEY and bound to a key its browser cannot export, and only a request signed with that
// key opens it again. It runs on Cloudflare Workers (apps/github-auth/README.md).
import { type Device, isDevice, seal, secretBytes, signedBy, unseal } from './seal'
import { type Db, isSlot, readOne, ready, remove, slots, write } from './store'

export interface Env {
  /** The GitHub App's client id (public) and secret (a Worker secret, never in the page or the repository). */
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  /** The origins that may ask, comma-separated: the docs site, and a dev server if wanted. */
  ALLOWED_ORIGINS: string
  /** 32 random bytes, base64 (a Worker secret): without it a returning reader connects with one click, as before. */
  SEAL_KEY?: string
  /** The D1 database of each reader's model settings: without it, nothing is remembered for an account. */
  DB?: Db
}

const GITHUB = 'https://github.com/login/oauth/access_token'
const API = 'https://api.github.com'
/** A request larger than this is no swap. */
const MAX_BODY = 4096
const CODE = /^[A-Za-z0-9_-]{1,128}$/
/** RFC 7636: 43 to 128 of the unreserved characters. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/
const USER_TOKEN = /^ghu_[A-Za-z0-9_]{20,255}$/
/** How far a signed request's time may be from the Worker's: a copied request is worth nothing after. */
const SKEW = 5 * 60_000

/**
 * What a sealed session holds: GitHub's refresh token, the browser it is bound to, and whose it is (GitHub's id of the
 * reader: their settings are filed under it).
 */
export interface Session {
  r: string
  u: number
  k: Device
  /** When GitHub last gave a token for it (ms): the settings answer a session refreshed in the last 8 hours. */
  t: number
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  })

type Body = Record<string, unknown>

export async function handle(
  req: Request,
  env: Env,
  call: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<Response> {
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
  const path = new URL(req.url).pathname
  if (!['/token', '/refresh', '/revoke', '/settings'].includes(path)) return json(404, { error: 'not_found' }, cors)
  if (req.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method' }, { ...cors, Allow: 'POST, OPTIONS' })
  if (!ok) return json(403, { error: 'origin' }, cors)
  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_BODY) return json(413, { error: 'too_large' }, cors)
  const text = await req.text()
  if (text.length > MAX_BODY) return json(413, { error: 'too_large' }, cors)
  let body: Body
  try {
    body = JSON.parse(text)
    if (typeof body !== 'object' || body === null) throw new Error()
  } catch {
    return json(400, { error: 'bad_request' }, cors)
  }
  const secret = secretBytes(env.SEAL_KEY)
  const answer: Answer = (status, b) =>
    b === null
      ? new Response(null, { status, headers: { ...cors, 'Cache-Control': 'no-store' } })
      : json(status, b, cors)
  if (path === '/token') return token(body, env, allowed, secret, call, now, answer)
  if (path === '/refresh') return refresh(body, env, secret, call, now, answer)
  if (path === '/settings') return settings(body, env, secret, now, answer)
  return revoke(body, env, call, answer)
}

type Answer = (status: number, body: unknown) => Response

/** GitHub's token endpoint, with the app's secret; its answer, or why not. */
async function swap(env: Env, call: typeof fetch, grant: Record<string, string>) {
  let res: Response
  try {
    res = await call(GITHUB, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, ...grant }),
    })
  } catch {
    return { failed: 'github_unreachable' as const }
  }
  const got = (await res.json().catch(() => ({}))) as Body
  // an outage, a limit, an error page: no answer about the grant at all
  if (typeof got.access_token !== 'string' && typeof got.error !== 'string') return { failed: 'github_failed' as const }
  if (typeof got.access_token !== 'string') {
    const error = got.error as string
    const description = typeof got.error_description === 'string' ? got.error_description : undefined
    return { refused: { error, ...(description && { error_description: description }) } }
  }
  return {
    token: {
      access_token: got.access_token,
      token_type: typeof got.token_type === 'string' ? got.token_type : 'bearer',
      ...(typeof got.expires_in === 'number' && { expires_in: got.expires_in }),
    },
    refresh: typeof got.refresh_token === 'string' ? got.refresh_token : undefined,
  }
}

/** The session the page keeps: GitHub's refresh token sealed, bound to the browser's key. */
const sealed = (secret: Uint8Array, s: Session) => seal(secret, 'session', s)

async function token(
  body: Body,
  env: Env,
  allowed: string[],
  secret: Uint8Array | undefined,
  call: typeof fetch,
  now: () => number,
  answer: Answer,
) {
  const { code, code_verifier, redirect_uri, device } = body
  // the popup came back to the asking site: its sign-in page, never somewhere else
  const back =
    typeof redirect_uri === 'string' && allowed.some((o) => redirect_uri.startsWith(`${o}/`)) ? redirect_uri : null
  if (
    typeof code !== 'string' ||
    !CODE.test(code) ||
    typeof code_verifier !== 'string' ||
    !VERIFIER.test(code_verifier) ||
    !back ||
    (device !== undefined && !isDevice(device))
  )
    return answer(400, { error: 'bad_request' })
  const got = await swap(env, call, { code, code_verifier, redirect_uri: back })
  if ('failed' in got) return answer(502, { error: got.failed })
  if ('refused' in got) return answer(400, got.refused)
  // the refresh token stays out, unless it can be sealed to the asking browser: then that browser alone gets it back
  if (!secret || !device || !got.refresh) return answer(200, got.token)
  const who = await whoami(call, got.token.access_token)
  if (!who) return answer(200, got.token)
  const session = await sealed(secret, { r: got.refresh, u: who.id, k: device, t: now() })
  return answer(200, { ...got.token, session })
}

/** The token's account, read once at sign-in: the session names it. */
async function whoami(call: typeof fetch, token: string): Promise<{ id: number } | undefined> {
  try {
    const res = await call(`${API}/user`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'loadmap-github-auth',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!res.ok) return undefined
    const u = (await res.json()) as Body
    return typeof u.id === 'number' ? { id: u.id } : undefined
  } catch {
    return undefined
  }
}

/** What the page signs for a refresh: the path, the time and the session, so no part is swapped for another's. */
export const refreshText = (at: number, session: string) => `loadmap refresh\n${at}\n${session}`

async function refresh(
  body: Body,
  env: Env,
  secret: Uint8Array | undefined,
  call: typeof fetch,
  now: () => number,
  answer: Answer,
) {
  if (!secret) return answer(501, { error: 'not_configured' })
  const { session, at, sig } = body
  if (typeof session !== 'string' || typeof at !== 'number' || !Number.isFinite(at))
    return answer(400, { error: 'bad_request' })
  // a clock far from ours is the browser's, not a forgery: it hears the time to sign with, and the session stays
  if (Math.abs(now() - at) > SKEW) return answer(409, { error: 'clock', now: now() })
  // one answer for every other refusal: a session that is not ours, a signature by another browser
  const s = await unseal<Session>(secret, 'session', session)
  if (!s || !isDevice(s.k) || !(await signedBy(s.k, refreshText(at, session), sig)))
    return answer(401, { error: 'session' })
  const got = await swap(env, call, { grant_type: 'refresh_token', refresh_token: s.r })
  if ('failed' in got) return answer(502, { error: got.failed })
  // GitHub refused the refresh token itself: six months passed, the reader revoked the app, or it was used already.
  // Any other refusal (the app's own credentials, a limit) is ours to mend, and the session stays.
  if ('refused' in got)
    return got.refused?.error === 'bad_refresh_token'
      ? answer(401, { error: 'expired' })
      : answer(502, { error: 'github_refused' })
  if (!got.refresh) return answer(200, got.token)
  return answer(200, { ...got.token, session: await sealed(secret, { ...s, r: got.refresh, t: now() }) })
}

/** What the page signs for its settings: the time, the session and the request, so no part is swapped for another's. */
export const settingsText = (at: number, session: string, request: string) =>
  `loadmap settings\n${at}\n${session}\n${request}`

const PROVIDER = /^[a-z0-9-]{1,32}$/
const REPO = /^[0-9]{1,15}$/

/** A repository's own choice: its provider and model, and a key of its own when it has one. */
interface RepoChoice {
  provider?: unknown
  model?: unknown
  key?: unknown
}
/** A key as providers make them: printable, no spaces, not absurdly long. */
const KEY = /^[\x21-\x7e]{8,512}$/
/** How long after its last refresh a session may read and write settings: revoking the app ends it within this. */
const AGE = 8 * 3600_000

/**
 * The reader's model settings: their choice of provider and model, the keys kept for them, and (with `repo`, GitHub's
 * id of a repository) a repository's own choice, with a key of its own or not. Only for a request signed by the browser the session is bound to, of a session GitHub refreshed in
 * the last 8 hours. A key leaves only for `key`, the one question that needs it.
 */
async function settings(body: Body, env: Env, secret: Uint8Array | undefined, now: () => number, answer: Answer) {
  if (!secret || !env.DB) return answer(501, { error: 'not_configured' })
  const db = env.DB
  const { session, at, sig, request } = body
  if (
    typeof session !== 'string' ||
    typeof at !== 'number' ||
    !Number.isFinite(at) ||
    typeof request !== 'string' ||
    request.length > 3000
  )
    return answer(400, { error: 'bad_request' })
  if (Math.abs(now() - at) > SKEW) return answer(409, { error: 'clock', now: now() })
  const s = await unseal<Session>(secret, 'session', session)
  if (!s || !isDevice(s.k) || !(await signedBy(s.k, settingsText(at, session, request), sig)))
    return answer(401, { error: 'session' })
  // the page refreshes it, then asks again
  if (typeof s.t !== 'number' || now() - s.t > AGE) return answer(401, { error: 'stale' })
  let r: Body
  try {
    r = JSON.parse(request)
    if (typeof r !== 'object' || r === null) throw new Error()
  } catch {
    return answer(400, { error: 'bad_request' })
  }
  await ready(db)
  const user = s.u
  const provider = typeof r.provider === 'string' && PROVIDER.test(r.provider) ? r.provider : undefined
  // a repository by GitHub's id: it stays through a rename
  const repo = r.repo === undefined ? undefined : typeof r.repo === 'string' && REPO.test(r.repo) ? r.repo : null
  if (repo === null) return answer(400, { error: 'bad_request' })
  const own = (id: string) => readOne<RepoChoice>(db, secret, user, `repo:${id}`)
  if (r.op === 'read') {
    // the choices alone are opened: a key is opened only for `key`
    const c = await readOne<{ provider?: unknown; model?: unknown }>(db, secret, user, 'default')
    const choice =
      typeof c?.provider === 'string' && typeof c.model === 'string'
        ? { provider: c.provider, model: c.model }
        : undefined
    const keys = (await slots(db, user)).filter((k) => k.startsWith('key:')).map((k) => k.slice(4))
    const o = repo ? await own(repo) : undefined
    const mine =
      typeof o?.provider === 'string' && typeof o.model === 'string'
        ? { provider: o.provider, model: o.model, ownKey: typeof o.key === 'string' }
        : undefined
    return answer(200, { ...(choice && { choice }), keys, ...(mine && { repo: mine }) })
  }
  if (r.op === 'key') {
    if (!provider) return answer(400, { error: 'bad_request' })
    // the repository's own key for its own provider, else the one kept for the provider
    const o = repo ? await own(repo) : undefined
    if (o?.provider === provider && typeof o.key === 'string') return answer(200, { key: o.key })
    const k = await readOne<{ key?: unknown }>(db, secret, user, `key:${provider}`)
    return answer(200, typeof k?.key === 'string' ? { key: k.key } : {})
  }
  if (r.op === 'save') {
    const model = typeof r.model === 'string' && /^[ -~]{0,200}$/.test(r.model) ? r.model : null
    const key = r.key === undefined ? undefined : typeof r.key === 'string' && KEY.test(r.key) ? r.key : null
    if (!provider || model === null || key === null) return answer(400, { error: 'bad_request' })
    const t = now()
    let why: Awaited<ReturnType<typeof write>>
    if (repo) {
      // a key of its own: the one given, or the one it had for the same provider; else the default's
      const had = r.ownKey === true && key === undefined ? await own(repo) : undefined
      const mine = key ?? (r.ownKey === true && had?.provider === provider ? had.key : undefined)
      why = await write(
        db,
        secret,
        user,
        `repo:${repo}`,
        { provider, model, ...(r.ownKey === true && typeof mine === 'string' && { key: mine }) },
        t,
      )
    } else
      why =
        (key !== undefined && (await write(db, secret, user, `key:${provider}`, { key }, t))) ||
        (await write(db, secret, user, 'default', { provider, model }, t))
    if (why === 'busy') return answer(429, { error: why })
    if (why) return answer(413, { error: why })
    return answer(204, null)
  }
  if (r.op === 'remove') {
    if (r.what === 'all') await remove(db, user)
    else {
      const w = typeof r.what === 'object' && r.what !== null ? (r.what as Body) : {}
      const slot = typeof w.repo === 'string' && REPO.test(w.repo) ? `repo:${w.repo}` : `key:${w.key}`
      if (!isSlot(slot)) return answer(400, { error: 'bad_request' })
      await remove(db, user, slot)
    }
    return answer(204, null)
  }
  return answer(400, { error: 'bad_request' })
}

/** Disconnect: the token is revoked at GitHub, so its 8 hours end now. Anyone holding a token may end it. */
async function revoke(body: Body, env: Env, call: typeof fetch, answer: Answer) {
  const { access_token } = body
  if (typeof access_token !== 'string' || !USER_TOKEN.test(access_token)) return answer(400, { error: 'bad_request' })
  try {
    await call(`${API}/applications/${encodeURIComponent(env.GITHUB_CLIENT_ID)}/token`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Basic ${btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`)}`,
        'Content-Type': 'application/json',
        'User-Agent': 'loadmap-github-auth',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ access_token }),
    })
  } catch {
    return answer(502, { error: 'github_unreachable' })
  }
  // gone already, or now: the page forgets it either way
  return answer(204, null)
}

export default { fetch: (req: Request, env: Env) => handle(req, env) }
