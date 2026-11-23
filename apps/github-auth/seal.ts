// The Worker's sealing, with its one secret (SEAL_KEY): what it hands the page it alone opens again, and only for the
// browser that holds the key the session was bound to. Web Crypto only; nothing kept, nothing logged.

const enc = new TextEncoder()
const dec = new TextDecoder()

export const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
export const unb64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) =>
    c.charCodeAt(0),
  )

/** The secret as bytes: 32 at least (`openssl rand -base64 32`), else none. */
export function secretBytes(secret: string | undefined): Uint8Array | undefined {
  if (!secret) return undefined
  try {
    const b = Uint8Array.from(atob(secret.trim()), (c) => c.charCodeAt(0))
    return b.length >= 32 ? b : undefined
  } catch {
    return undefined
  }
}

/** One AES key per use, from the secret: a session never opens as a settings row, nor the other way. */
async function keyFor(secret: Uint8Array, use: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', secret as BufferSource, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(`loadmap github-auth ${use}`) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** `data` sealed for `use`, bound to `bind` (what it is about: a copy under another name fails to open). */
export async function seal(secret: Uint8Array, use: string, data: unknown, bind = ''): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const box = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc.encode(bind) },
    await keyFor(secret, use),
    enc.encode(JSON.stringify(data)),
  )
  return `${b64url(iv)}.${b64url(new Uint8Array(box))}`
}

/** What `seal` sealed, or undefined: a wrong key, use or binding, and a damaged text, read the same. */
export async function unseal<T>(secret: Uint8Array, use: string, sealed: unknown, bind = ''): Promise<T | undefined> {
  if (typeof sealed !== 'string' || sealed.length > 4096) return undefined
  const [iv, box, more] = sealed.split('.')
  if (!iv || !box || more !== undefined) return undefined
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64url(iv) as BufferSource, additionalData: enc.encode(bind) },
      await keyFor(secret, use),
      unb64url(box) as BufferSource,
    )
    return JSON.parse(dec.decode(plain)) as T
  } catch {
    return undefined
  }
}

/** A browser's public key, as the page sends it: a P-256 point. */
export interface Device {
  x: string
  y: string
}

const COORD = /^[A-Za-z0-9_-]{43}$/
export const isDevice = (d: unknown): d is Device =>
  typeof d === 'object' && d !== null && COORD.test((d as Device).x) && COORD.test((d as Device).y)

/** Whether `sig` (base64url, r‖s) is the device's signature of `text`. */
export async function signedBy(device: Device, text: string, sig: unknown): Promise<boolean> {
  if (typeof sig !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(sig)) return false
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: device.x, y: device.y, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      unb64url(sig) as BufferSource,
      enc.encode(text) as BufferSource,
    )
  } catch {
    return false
  }
}
