// A model key kept sealed in the reader's own GitHub: encrypted here with their passphrase (PBKDF2, then AES-GCM), and
// only the sealed text saved, as a file in a private repository of theirs ("loadmap-keys"). On any device: sign in,
// type the passphrase, and the key is back for the session. GitHub holds the sealed text alone; the passphrase never
// leaves this page, and a weak one is the weak point.
import { type Client, filePath, GitHubError, seg } from './api'

const REPO = 'loadmap-keys'
const ABOUT = 'Model keys for the loadmap editor, sealed with a passphrase.'
const ROUNDS = 600_000
const enc = new TextEncoder()
const dec = new TextDecoder()

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function keyOf(passphrase: string, salt: Uint8Array, rounds = ROUNDS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: rounds, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** The key sealed with the passphrase: a line of JSON with the salt, the nonce and the sealed bytes. */
export async function seal(secret: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const box = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    await keyOf(passphrase, salt),
    enc.encode(secret),
  )
  return JSON.stringify({
    v: 1,
    kdf: 'PBKDF2-SHA256',
    rounds: ROUNDS,
    salt: b64(salt),
    iv: b64(iv),
    box: b64(new Uint8Array(box)),
  })
}

/** The key, or why not: a wrong passphrase and a damaged file say the same, as they must. */
export async function unseal(sealed: string, passphrase: string): Promise<string> {
  try {
    const s = JSON.parse(sealed) as {
      v?: number
      kdf?: string
      rounds?: number
      salt?: string
      iv?: string
      box?: string
    }
    // the rounds a key was sealed with open it, whatever a later release seals with
    const rounds = s.rounds ?? ROUNDS
    if (s.v !== 1 || s.kdf !== 'PBKDF2-SHA256' || !s.salt || !s.iv || !s.box) throw new Error()
    if (!Number.isInteger(rounds) || rounds < 100_000 || rounds > 10_000_000) throw new Error()
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(s.iv) as BufferSource },
      await keyOf(passphrase, unb64(s.salt), rounds),
      unb64(s.box) as BufferSource,
    )
    return dec.decode(plain)
  } catch {
    throw new Error('That passphrase does not open the key kept on GitHub.')
  }
}

/** A refusal the reader can act on: what to do, and where on GitHub. The Ask panel shows the link after the words. */
export class VaultError extends Error {
  constructor(
    message: string,
    readonly link?: { href: string; label: string },
  ) {
    super(message)
    this.name = 'VaultError'
  }
}

/** GitHub's page for a new repository, filled in: the name, the reader as its owner, private. */
const newRepoPage = (owner: string) =>
  `https://github.com/new?${new URLSearchParams({ name: REPO, owner, visibility: 'private', description: ABOUT })}`

/** The signed-in reader's login: the repository is theirs. */
async function login(gh: Client): Promise<string> {
  return (await gh.json<{ login: string }>('/user')).login
}

const path = (provider: string) => `keys/${provider.replace(/[^a-z0-9-]/g, '')}.sealed`

/** The sealed key for a provider, from the reader's private repository; undefined when none was kept. */
export async function loadSealed(gh: Client, provider: string): Promise<string | undefined> {
  const owner = await login(gh)
  try {
    const f = await gh.json<{ content?: string; encoding?: string }>(
      `/repos/${seg(owner)}/${REPO}/contents/${filePath(path(provider))}`,
    )
    return f.content && f.encoding === 'base64' ? dec.decode(unb64(f.content.replace(/\s/g, ''))) : undefined
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return undefined
    throw e
  }
}

export interface SaveOptions {
  /**
   * For a token from Sign in with GitHub: the page where the reader picks the app's repositories. Such a token does
   * what the app may do, on the repositories it is installed on; a pasted one, what the reader gave it.
   */
  app?: string
  /** The first wait for a repository just made, in ms. */
  wait?: number
}

/**
 * The sealed key saved for a provider in the reader's private repository, made private the first time. Only the
 * sealed text leaves this page. A token that may not make the repository is told how the reader makes it.
 */
export async function saveSealed(gh: Client, provider: string, sealed: string, o: SaveOptions = {}): Promise<void> {
  const { app, wait = 500 } = o
  const owner = await login(gh)
  const at = `/repos/${seg(owner)}/${REPO}`
  const name = `${owner}/${REPO}`
  let fresh = false
  try {
    // a repository of that name the reader made public is no place for a key, sealed or not
    const repo = await gh.json<{ private?: boolean }>(at)
    if (!repo.private) throw new Error(`${name} is public: make it private on GitHub first, then keep the key there.`)
  } catch (e) {
    if (!(e instanceof GitHubError && e.status === 404)) throw e
    try {
      await gh.json('/user/repos', {
        method: 'POST',
        body: { name: REPO, private: true, auto_init: true, description: ABOUT },
      })
    } catch (err) {
      const why = err instanceof GitHubError ? err.failure : undefined
      // 403: the app lacks "Repository creation" (or the reader has not approved it), a pasted token Administration
      if (why === 'forbidden')
        throw new VaultError(
          app
            ? `The sign-in may not make ${name}. Make it on GitHub, private, and let the app reach it (all repositories, or that one). Then keep the key again.`
            : `This token may not make ${name}. Make it on GitHub, private, and give the token Contents, read and write, on it. Then keep the key again.`,
          { href: newRepoPage(owner), label: 'Make it on GitHub' },
        )
      // 422 with the name and the rest as fixed as here: the name is taken, by a repository the token does not see
      if (why === 'invalid')
        throw app
          ? new VaultError(
              `${name} seems to be there, out of the sign-in's reach. Let the app reach it (all repositories, or that one), then keep the key again.`,
              { href: app, label: "Pick the app's repositories" },
            )
          : new VaultError(
              `${name} seems to be there, out of this token's reach. Give the token Contents, read and write, on it, then keep the key again.`,
            )
      throw err
    }
    fresh = true
  }
  let sha: string | undefined
  if (!fresh)
    try {
      sha = (await gh.json<{ sha: string }>(`${at}/contents/${filePath(path(provider))}`)).sha
    } catch (e) {
      if (!(e instanceof GitHubError && e.status === 404)) throw e
    }
  const put = () =>
    gh.json(`${at}/contents/${filePath(path(provider))}`, {
      method: 'PUT',
      body: {
        message: `Keep the ${provider} key, sealed`,
        content: b64(enc.encode(sealed)),
        ...(sha && { sha }),
      },
    })
  // a repository just made gets its first commit a moment after GitHub answers: the first write waits for it
  for (let i = 0; ; i++)
    try {
      await put()
      return
    } catch (e) {
      // a sign-in's token writes wherever it reads; a pasted one may have been given the reading alone
      if (!app && e instanceof GitHubError && e.failure === 'forbidden')
        throw new VaultError(
          `This token may only read ${name}. Give it Contents, read and write, on it, then keep the key again.`,
        )
      const early = fresh && e instanceof GitHubError && (e.status === 404 || e.status === 409)
      if (!early || i >= 4) throw e
      await new Promise((r) => setTimeout(r, wait * (i + 1)))
    }
}
