import { describe, expect, it } from 'vitest'
import { secretBytes, unseal } from '../seal'
import { type Env, handle, refreshText, type Session, settingsText } from '../worker'
import { fakeD1 } from './fake-d1'

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

// the secret a test deploy holds: 32 bytes, as `openssl rand -base64 32` makes them; never a real one
const SEALED: Env = { ...ENV, SEAL_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))) }
const NOW = 1_800_000_000_000

/** GitHub as the Worker meets it: the token endpoint, `/user`, and the revoke; every call kept. */
function githubAll(o: { token?: unknown; status?: number } = {}) {
  const sent: { url: string; method: string; headers: Headers; body?: Record<string, unknown> }[] = []
  const call = (async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    sent.push({
      url,
      method: init.method ?? 'GET',
      headers,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    })
    const res = (b: unknown, status = 200) =>
      new Response(b === null ? null : JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === 'https://api.github.com/user') return res({ id: 42, login: 'acme' })
    if (url.startsWith('https://api.github.com/applications/')) return res(null, 204)
    return res(
      o.token ?? { access_token: 'ghu_fresh', token_type: 'bearer', expires_in: 28800, refresh_token: 'ghr_next' },
      o.status,
    )
  }) as unknown as typeof fetch
  return { call, sent }
}

const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

/** A browser's key, as the page makes it: its public point, and a way to sign. */
async function browserKey() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
  const { x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const sign = async (text: string) =>
    b64url(
      new Uint8Array(
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(text)),
      ),
    )
  return { device: { x: x!, y: y! }, sign }
}

/** A session the Worker sealed at sign-in, for this browser. */
async function signedIn(key: Awaited<ReturnType<typeof browserKey>>) {
  const gh = githubAll({ token: { access_token: 'ghu_first', expires_in: 28800, refresh_token: 'ghr_first' } })
  const res = await handle(ask({ ...BODY, device: key.device }), SEALED, gh.call, () => NOW)
  return { body: (await res.json()) as { access_token: string; session?: string }, gh }
}

describe('coming back without a click', () => {
  it("seals GitHub's refresh token to the asking browser, and names the account in it", async () => {
    const key = await browserKey()
    const { body, gh } = await signedIn(key)
    expect(body.access_token).toBe('ghu_first')
    expect(typeof body.session).toBe('string')
    expect(JSON.stringify(body)).not.toContain('ghr_first')
    // the account, read once with the new token
    const who = gh.sent.find((c) => c.url === 'https://api.github.com/user')!
    expect([who.headers.get('Authorization'), who.headers.get('User-Agent')]).toEqual([
      'Bearer ghu_first',
      'loadmap-github-auth',
    ])
    const s = await unseal<Session>(secretBytes(SEALED.SEAL_KEY)!, 'session', body.session)
    expect(s).toEqual({ r: 'ghr_first', u: 42, k: key.device, t: NOW })
  })

  it('hands back no session without the secret, or without a browser key', async () => {
    const key = await browserKey()
    const without = await handle(ask({ ...BODY, device: key.device }), ENV, githubAll().call)
    expect(await without.json()).toEqual({ access_token: 'ghu_fresh', token_type: 'bearer', expires_in: 28800 })
    const nokey = await handle(ask(BODY), SEALED, githubAll().call)
    expect(await nokey.json()).toEqual({ access_token: 'ghu_fresh', token_type: 'bearer', expires_in: 28800 })
    expect((await handle(ask({ ...BODY, device: { x: 'short', y: 'y' } }), SEALED, githubAll().call)).status).toBe(400)
  })

  it("refreshes for the browser that signs, with GitHub's refresh grant, and seals the next refresh token", async () => {
    const key = await browserKey()
    const { body } = await signedIn(key)
    const at = NOW + 60_000
    const gh = githubAll()
    const res = await handle(
      ask({ session: body.session, at, sig: await key.sign(refreshText(at, body.session!)) }, { path: '/refresh' }),
      SEALED,
      gh.call,
      () => NOW + 61_000,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE)
    const got = (await res.json()) as { access_token: string; session: string }
    expect(got.access_token).toBe('ghu_fresh')
    expect(gh.sent.map((c) => c.body)).toEqual([
      {
        client_id: ENV.GITHUB_CLIENT_ID,
        client_secret: 'the-secret',
        grant_type: 'refresh_token',
        refresh_token: 'ghr_first',
      },
    ])
    const s = await unseal<Session>(secretBytes(SEALED.SEAL_KEY)!, 'session', got.session)
    expect(s).toEqual({ r: 'ghr_next', u: 42, k: key.device, t: NOW + 61_000 })
  })

  it('refuses a session another browser signs, a changed session, or one sealed elsewhere', async () => {
    const key = await browserKey()
    const other = await browserKey()
    const { body } = await signedIn(key)
    const session = body.session!
    const gh = githubAll()
    const refresh = async (b: Record<string, unknown>, env: Env = SEALED) =>
      handle(ask(b, { path: '/refresh' }), env, gh.call, () => NOW)
    const status = async (b: Record<string, unknown>, env?: Env) => (await refresh(b, env)).status
    expect(await status({ session, at: NOW, sig: await other.sign(refreshText(NOW, session)) })).toBe(401)
    const changed = `${session.slice(0, -2)}AA`
    expect(await status({ session: changed, at: NOW, sig: await key.sign(refreshText(NOW, changed)) })).toBe(401)
    const elsewhere = { ...SEALED, SEAL_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(9))) }
    expect(await status({ session, at: NOW, sig: await key.sign(refreshText(NOW, session)) }, elsewhere)).toBe(401)
    // a Worker without the secret says so
    expect(await status({ session, at: NOW, sig: await key.sign(refreshText(NOW, session)) }, ENV)).toBe(501)
    expect(await status({ session, at: 'now' })).toBe(400)
    expect(gh.sent).toEqual([])
  })

  it('tells a browser whose clock is off the time to sign with, and keeps the session', async () => {
    const key = await browserKey()
    const { body } = await signedIn(key)
    const old = NOW - 6 * 60_000
    const gh = githubAll()
    const res = await handle(
      ask(
        { session: body.session, at: old, sig: await key.sign(refreshText(old, body.session!)) },
        { path: '/refresh' },
      ),
      SEALED,
      gh.call,
      () => NOW,
    )
    expect([res.status, await res.json()]).toEqual([409, { error: 'clock', now: NOW }])
    expect(gh.sent).toEqual([])
  })

  it('keeps the session when GitHub fails for another reason than the refresh token', async () => {
    const key = await browserKey()
    const { body } = await signedIn(key)
    for (const [answer, status] of [
      [{ error: 'incorrect_client_credentials' }, 200],
      ['<html>unicorn</html>', 503],
    ] as const) {
      const gh = githubAll({ token: answer, status })
      const res = await handle(
        ask(
          { session: body.session, at: NOW, sig: await key.sign(refreshText(NOW, body.session!)) },
          { path: '/refresh' },
        ),
        SEALED,
        gh.call,
        () => NOW,
      )
      expect(res.status).toBe(502)
    }
  })

  it('says a session GitHub no longer refreshes is over', async () => {
    const key = await browserKey()
    const { body } = await signedIn(key)
    const gh = githubAll({ token: { error: 'bad_refresh_token' } })
    const res = await handle(
      ask(
        { session: body.session, at: NOW, sig: await key.sign(refreshText(NOW, body.session!)) },
        { path: '/refresh' },
      ),
      SEALED,
      gh.call,
      () => NOW,
    )
    expect([res.status, await res.json()]).toEqual([401, { error: 'expired' }])
  })

  it("revokes a token at GitHub with the app's credentials, and answers the page", async () => {
    const gh = githubAll()
    const res = await handle(ask({ access_token: `ghu_${'a'.repeat(36)}` }, { path: '/revoke' }), SEALED, gh.call)
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE)
    expect(gh.sent).toHaveLength(1)
    const c = gh.sent[0]!
    expect([c.method, c.url, c.body]).toEqual([
      'DELETE',
      `https://api.github.com/applications/${ENV.GITHUB_CLIENT_ID}/token`,
      { access_token: `ghu_${'a'.repeat(36)}` },
    ])
    expect(c.headers.get('Authorization')).toBe(`Basic ${btoa(`${ENV.GITHUB_CLIENT_ID}:the-secret`)}`)
    expect((await handle(ask({ access_token: 'github_pat_x' }, { path: '/revoke' }), SEALED, gh.call)).status).toBe(400)
  })
})

describe("the reader's settings", () => {
  /** A Worker with the store, a reader signed in from this browser, and a way to ask it signed. */
  async function reader(o: { now?: number } = {}) {
    const d1 = fakeD1()
    const env: Env = { ...SEALED, DB: d1.db }
    const key = await browserKey()
    const { body } = await signedIn(key)
    const session = body.session!
    const settings = async (request: unknown, p: { at?: number; by?: typeof key; now?: number } = {}) => {
      const at = p.at ?? NOW
      const text = JSON.stringify(request)
      const res = await handle(
        ask(
          { session, at, sig: await (p.by ?? key).sign(settingsText(at, session, text)), request: text },
          { path: '/settings' },
        ),
        env,
        githubAll().call,
        () => p.now ?? o.now ?? NOW,
      )
      return { status: res.status, body: res.status === 204 ? null : await res.json() }
    }
    return { d1, env, key, session, settings }
  }

  it('keeps the choice and the key sealed, hands back which keys it holds, and the key only when asked for it', async () => {
    const r = await reader()
    expect(await r.settings({ op: 'read' })).toEqual({ status: 200, body: { keys: [] } })
    expect(
      (await r.settings({ op: 'save', provider: 'openrouter', model: 'some/model', key: 'sk-or-v1-secret' })).status,
    ).toBe(204)
    expect(await r.settings({ op: 'read' })).toEqual({
      status: 200,
      body: { choice: { provider: 'openrouter', model: 'some/model' }, keys: ['openrouter'] },
    })
    expect(await r.settings({ op: 'key', provider: 'openrouter' })).toEqual({
      status: 200,
      body: { key: 'sk-or-v1-secret' },
    })
    // the table holds sealed text alone, filed under the reader's GitHub id
    const rows = [...r.d1.settings.values()]
    expect(rows.map((x) => [x.user, x.slot])).toEqual([
      [42, 'key:openrouter'],
      [42, 'default'],
    ])
    for (const x of rows) expect(x.box).not.toContain('sk-or')
    // a row moved to another slot opens nothing
    const k = r.d1.settings.get('42:key:openrouter')!
    r.d1.settings.set('42:key:anthropic', { ...k, slot: 'key:anthropic' })
    expect(await r.settings({ op: 'key', provider: 'anthropic' })).toEqual({ status: 200, body: {} })
  })

  it("keeps a repository's own choice, with a key of its own or the reader's, under GitHub's id of it", async () => {
    const r = await reader()
    await r.settings({ op: 'save', provider: 'openrouter', model: 'default/model', key: 'sk-or-default-01' })
    // its own choice and key
    expect(
      (
        await r.settings({
          op: 'save',
          repo: '7',
          provider: 'openrouter',
          model: 'repo/model',
          ownKey: true,
          key: 'sk-or-repo-0007',
        })
      ).status,
    ).toBe(204)
    expect((await r.settings({ op: 'read', repo: '7' })).body).toEqual({
      choice: { provider: 'openrouter', model: 'default/model' },
      keys: ['openrouter'],
      repo: { provider: 'openrouter', model: 'repo/model', ownKey: true },
    })
    expect((await r.settings({ op: 'key', provider: 'openrouter', repo: '7' })).body).toEqual({
      key: 'sk-or-repo-0007',
    })
    // asked for another repository's own, there is none; without a repository, the reader's
    expect((await r.settings({ op: 'key', provider: 'openrouter', repo: '8' })).body).toEqual({})
    expect((await r.settings({ op: 'key', provider: 'openrouter' })).body).toEqual({ key: 'sk-or-default-01' })
    expect((await r.settings({ op: 'read', repo: '8' })).body).not.toHaveProperty('repo')
    // a new model keeps the key it had; without a key of its own it uses the reader's
    await r.settings({ op: 'save', repo: '7', provider: 'openrouter', model: 'repo/other', ownKey: true })
    expect((await r.settings({ op: 'key', provider: 'openrouter', repo: '7' })).body).toEqual({
      key: 'sk-or-repo-0007',
    })
    // using the reader's key: a key given with it is the reader's for the provider
    await r.settings({
      op: 'save',
      repo: '7',
      provider: 'openrouter',
      model: 'repo/other',
      ownKey: false,
      key: 'sk-or-default-02',
    })
    expect((await r.settings({ op: 'read', repo: '7' })).body).toMatchObject({ repo: { ownKey: false } })
    expect((await r.settings({ op: 'key', provider: 'openrouter', repo: '7' })).body).toEqual({})
    expect((await r.settings({ op: 'key', provider: 'openrouter' })).body).toEqual({ key: 'sk-or-default-02' })
    // the reader's default stays as it was throughout
    expect((await r.settings({ op: 'read' })).body).toMatchObject({ choice: { model: 'default/model' } })
    // back to the default
    expect((await r.settings({ op: 'remove', what: { repo: '7' } })).status).toBe(204)
    expect((await r.settings({ op: 'read', repo: '7' })).body).not.toHaveProperty('repo')
    expect((await r.settings({ op: 'read', repo: 'acme/x' })).status).toBe(400)
  })

  it('forgets a key, then everything', async () => {
    const r = await reader()
    await r.settings({ op: 'save', provider: 'openrouter', model: 'm', key: 'sk-or-v1-secret' })
    await r.settings({ op: 'save', provider: 'anthropic', model: 'claude-haiku-5-5', key: 'sk-ant-secret' })
    expect((await r.settings({ op: 'remove', what: { key: 'openrouter' } })).status).toBe(204)
    expect((await r.settings({ op: 'read' })).body).toMatchObject({ keys: ['anthropic'] })
    expect((await r.settings({ op: 'remove', what: 'all' })).status).toBe(204)
    expect(r.d1.settings.size).toBe(0)
    // the day's count of writes stays: removing never buys more
    expect([...r.d1.quota.values()].map((q) => q.n)).toEqual([4])
  })

  it('answers only the browser the session is bound to, a session refreshed in the last 8 hours, a clock near ours', async () => {
    const r = await reader()
    const other = await browserKey()
    expect((await r.settings({ op: 'read' }, { by: other })).status).toBe(401)
    expect(await r.settings({ op: 'read' }, { now: NOW + 8 * 3600_000 + 1, at: NOW + 8 * 3600_000 + 1 })).toEqual({
      status: 401,
      body: { error: 'stale' },
    })
    expect((await r.settings({ op: 'read' }, { at: NOW - 600_000 })).body).toEqual({ error: 'clock', now: NOW })
    // the request signed is the request read: another one under the same signature is refused
    const text = JSON.stringify({ op: 'read' })
    const res = await handle(
      ask(
        {
          session: r.session,
          at: NOW,
          sig: await r.key.sign(settingsText(NOW, r.session, text)),
          request: JSON.stringify({ op: 'remove', what: 'all' }),
        },
        { path: '/settings' },
      ),
      r.env,
      githubAll().call,
      () => NOW,
    )
    expect(res.status).toBe(401)
  })

  it('refuses what is no setting, and more than a reader may keep', async () => {
    const r = await reader()
    for (const bad of [
      { op: 'save', provider: 'Open Router', model: 'm' },
      { op: 'save', provider: 'openrouter', model: 'm', key: 'has spaces in it' },
      { op: 'save', provider: 'openrouter', model: 'x'.repeat(201) },
      { op: 'key', provider: '../x' },
      { op: 'remove', what: { key: 'A B' } },
      { op: 'drop' },
    ])
      expect((await r.settings(bad)).status).toBe(400)
    for (let i = 0; i < 200; i++) await r.settings({ op: 'save', provider: 'openrouter', model: `m${i}` })
    // the day's 200 writes are spent
    expect(await r.settings({ op: 'save', provider: 'openrouter', model: 'one more' })).toEqual({
      status: 429,
      body: { error: 'busy' },
    })
  })

  it('says it is not set up without the database or the secret', async () => {
    const r = await reader()
    const at = NOW
    const text = JSON.stringify({ op: 'read' })
    for (const env of [SEALED, { ...ENV, DB: r.d1.db }]) {
      const res = await handle(
        ask(
          { session: r.session, at, sig: await r.key.sign(settingsText(at, r.session, text)), request: text },
          { path: '/settings' },
        ),
        env,
        githubAll().call,
        () => NOW,
      )
      expect(res.status).toBe(501)
    }
  })
})
