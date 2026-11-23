// The Ask panel's conversations, kept across reloads: a private repository's in this tab (sessionStorage), as its
// files are; a public repository's and the draft's in this browser (IndexedDB), until Disconnect or the browser
// clears them. Loaded on the panel's first read.
import type { KeptConversations } from '@loadmap/editor'

const DB = 'loadmap-ask'
const STORE = 'conversations'
const TAB = 'loadmap-ask:'
/** A scope's conversations larger than this are not kept: the newest stay in the page. */
const MAX = 400_000

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

/** A scope whose conversations stay in the tab: a private repository's. */
const inTab = (scope: string) => scope.startsWith('private:')

/** What was kept, read back as it must be: anything else is nothing. */
function valid(v: unknown): KeptConversations | undefined {
  const k = v as KeptConversations | null
  if (!k || typeof k.current !== 'string' || typeof k.conversations !== 'object' || k.conversations === null)
    return undefined
  for (const c of Object.values(k.conversations))
    if (!Array.isArray(c?.turns) || !Array.isArray(c.thread)) return undefined
  return k
}

export async function load(scope: string): Promise<KeptConversations | undefined> {
  if (inTab(scope)) {
    try {
      return valid(JSON.parse(sessionStorage.getItem(TAB + scope) ?? 'null'))
    } catch {
      return undefined
    }
  }
  return valid(await run('readonly', (s) => s.get(scope)))
}

export async function save(scope: string, kept: KeptConversations): Promise<void> {
  const text = JSON.stringify(kept)
  if (text.length > MAX) return
  if (inTab(scope)) {
    try {
      sessionStorage.setItem(TAB + scope, text)
    } catch {
      // the tab's storage is full: the page keeps them until it closes
    }
    return
  }
  await run('readwrite', (s) => s.put(JSON.parse(text), scope))
}

/** Disconnect: every conversation this browser kept. */
export function forgetConversations(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const r = indexedDB.deleteDatabase(DB)
      r.onsuccess = r.onerror = r.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}
