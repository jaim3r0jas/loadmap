// A model key kept sealed in the reader's own GitHub: encrypted here with their passphrase (PBKDF2, then AES-GCM), and
// only the sealed text saved, as a file in a private repository of theirs ("loadmap-keys"). On any device: sign in,
// type the passphrase, and the key is back for the session. GitHub holds the sealed text alone; the passphrase never
// leaves this page, and a weak one is the weak point.
import { type Client, filePath, GitHubError, seg } from './api'

const REPO = 'loadmap-keys'
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

/**
 * The sealed key saved for a provider in the reader's private repository, made private the first time. Only the
 * sealed text leaves this page.
 */
export async function saveSealed(gh: Client, provider: string, sealed: string, wait = 500): Promise<void> {
  const owner = await login(gh)
  const at = `/repos/${seg(owner)}/${REPO}`
  let fresh = false
  try {
    // a repository of that name the reader made public is no place for a key, sealed or not
    const repo = await gh.json<{ private?: boolean }>(at)
    if (!repo.private)
      throw new Error(`${owner}/${REPO} is public: make it private on GitHub first, then keep the key there.`)
  } catch (e) {
    if (!(e instanceof GitHubError && e.status === 404)) throw e
    try {
      await gh.json('/user/repos', {
        method: 'POST',
        body: {
          name: REPO,
          private: true,
          auto_init: true,
          description: 'Model keys for the loadmap editor, sealed with a passphrase.',
        },
      })
    } catch (err) {
      throw new Error(
        `${(err as Error).message} Keeping a key makes ${owner}/${REPO}, which needs a token that may create repositories; or make it on GitHub yourself, private, and give the token Contents on it.`,
      )
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
      const early = fresh && e instanceof GitHubError && (e.status === 404 || e.status === 409)
      if (!early || i >= 4) throw e
      await new Promise((r) => setTimeout(r, wait * (i + 1)))
    }
}
