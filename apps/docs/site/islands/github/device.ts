// This browser's part in coming back connected: a signing key it cannot export, and the session the site's Worker
// sealed to it, both in IndexedDB. A copy of the session is worth nothing without the key, and the key never leaves
// the browser: the Worker hears only its public half and its signatures. Disconnect deletes both.

const DB = 'loadmap-github'
const STORE = 'device'

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

async function run<T>(mode: IDBTransactionMode, act: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = d.transaction(STORE, mode)
      const r = act(t.objectStore(STORE))
      t.oncomplete = () => resolve(r.result)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
  } finally {
    d.close()
  }
}

const get = <T>(k: string) => run<T | undefined>('readonly', (s) => s.get(k) as IDBRequest<T | undefined>)
const put = (k: string, v: unknown) => run('readwrite', (s) => s.put(v, k))
const del = (k: string) => run('readwrite', (s) => s.delete(k))

/** The public half the Worker binds a session to: a P-256 point. */
export interface Device {
  x: string
  y: string
}

/** This browser's key pair: made once, the private half not exportable. */
export async function deviceKey(): Promise<CryptoKeyPair> {
  const had = await get<CryptoKeyPair>('key')
  if (had) return had
  const made = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
  await put('key', made)
  return made
}

export async function devicePoint(pair: CryptoKeyPair): Promise<Device> {
  const { x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey)
  return { x: x!, y: y! }
}

const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

export async function sign(pair: CryptoKeyPair, text: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.privateKey,
    new TextEncoder().encode(text) as BufferSource,
  )
  return b64url(new Uint8Array(sig))
}

export const readSession = () => get<string>('session')
export const keepSession = (s: string) => put('session', s)

/** Disconnect: the key and the session, all this browser holds for coming back. */
export async function forgetDevice(): Promise<void> {
  await del('session')
  await del('key')
}
