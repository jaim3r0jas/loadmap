import { describe, expect, it } from 'vitest'
import { type Env, handle } from '../worker'

const SITE = 'https://example.github.io'
const ENV: Env = {
  GITHUB_CLIENT_ID: 'Iv23li0000000000000',
  GITHUB_CLIENT_SECRET: 'the-secret',
  ALLOWED_ORIGINS: `${SITE}, http://localhost:5173`,
}
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const BODY = { code: 'abc123', code_verifier: VERIFIER, redirect_uri: `${SITE}/loadmap/signed-in/` }

const ask = (body: unknown, o: { origin?: string; method?: string; path?: string } = {}) =>
  new Request(`https://auth.example.workers.dev${o.path ?? '/token'}`, {
    method: o.method ?? 'POST',
    headers: { Origin: o.origin ?? SITE, 'Content-Type': 'application/json' },
    ...((o.method ?? 'POST') === 'POST' && { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })

/** GitHub's token endpoint, answering `answer`; what it was sent is kept. */
function github(answer: unknown, status = 200) {
  const sent: { url: string; body: Record<string, unknown> }[] = []
  const call = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify(answer), { status, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  return { call, sent }
}

describe('the sign-in Worker', () => {
  it("swaps the code for a token with the app's secret and the PKCE verifier, and hands back no refresh token", async () => {
    const gh = github({ access_token: 'ghu_token', token_type: 'bearer', expires_in: 28800, refresh_token: 'ghr_x' })
    const res = await handle(ask(BODY), ENV, gh.call)
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ access_token: 'ghu_token', token_type: 'bearer', expires_in: 28800 })
    expect(gh.sent).toEqual([
      {
        url: 'https://github.com/login/oauth/access_token',
        body: {
          client_id: ENV.GITHUB_CLIENT_ID,
          client_secret: 'the-secret',
          code: 'abc123',
          code_verifier: VERIFIER,
          redirect_uri: BODY.redirect_uri,
        },
      },
    ])
  })

  it('answers only the origins it is given, and their preflight', async () => {
    const gh = github({ access_token: 'ghu_token' })
    const other = await handle(ask(BODY, { origin: 'https://evil.example' }), ENV, gh.call)
    expect(other.status).toBe(403)
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull()
    const pre = await handle(ask(null, { method: 'OPTIONS' }), ENV, gh.call)
    expect([pre.status, pre.headers.get('Access-Control-Allow-Methods')]).toEqual([204, 'POST'])
    expect((await handle(ask(null, { method: 'OPTIONS', origin: 'https://evil.example' }), ENV, gh.call)).status).toBe(
      403,
    )
    expect(gh.sent).toEqual([])
  })

  it('refuses anything but a well-formed swap, before asking GitHub', async () => {
    const gh = github({ access_token: 'ghu_token' })
    const refused = async (body: unknown, o = {}) => (await handle(ask(body, o), ENV, gh.call)).status
    expect(await refused(BODY, { path: '/' })).toBe(404)
    expect(await refused(null, { method: 'GET' })).toBe(405)
    expect(await refused('not json')).toBe(400)
    expect(await refused({ ...BODY, code: 'a b' })).toBe(400)
    expect(await refused({ ...BODY, code_verifier: 'short' })).toBe(400)
    // the popup must have come back to the asking site
    expect(await refused({ ...BODY, redirect_uri: 'https://evil.example/cb' })).toBe(400)
    expect(await refused({ ...BODY, redirect_uri: `${SITE}.evil.example/cb` })).toBe(400)
    expect(await refused({ ...BODY, pad: 'x'.repeat(5000) })).toBe(413)
    expect(gh.sent).toEqual([])
  })

  it('says it is not set up when a deploy dropped its settings', async () => {
    const gh = github({ access_token: 'ghu_token' })
    const res = await handle(ask(BODY), { ...ENV, ALLOWED_ORIGINS: undefined as unknown as string }, gh.call)
    expect([res.status, await res.json()]).toEqual([500, { error: 'not_configured' }])
    expect(gh.sent).toEqual([])
  })

  it("passes GitHub's refusal on, without the secret", async () => {
    const gh = github({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' })
    const res = await handle(ask(BODY), ENV, gh.call)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toEqual({
      error: 'bad_verification_code',
      error_description: 'The code passed is incorrect or expired.',
    })
    expect(JSON.stringify(body)).not.toContain('the-secret')
  })
})
