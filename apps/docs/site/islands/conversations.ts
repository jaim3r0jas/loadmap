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

/** The newest that fit: the conversations after the one drawn go first, then its oldest turns. */
function fit(kept: KeptConversations): KeptConversations | undefined {
  const conversations = { ...kept.conversations }
  const size = () => JSON.stringify({ current: kept.current, conversations }).length
  const others = Object.keys(conversations).filter((k) => k !== kept.current)
  while (size() > MAX && others.length) delete conversations[others.pop()!]
  const now = conversations[kept.current]
  if (now && size() > MAX) {
    const turns = [...now.turns]
    const thread = [...now.thread]
    // a question and its answer at a time, from the oldest
    while (size() > MAX && (turns.length > 2 || thread.length > 2)) {
      turns.splice(0, 2)
      thread.splice(0, 2)
      conversations[kept.current] = { turns, thread }
    }
  }
  return size() > MAX ? undefined : { current: kept.current, conversations }
}

export async function save(scope: string, kept: KeptConversations): Promise<void> {
  const fits = fit(kept)
  if (!fits) return
  if (inTab(scope)) {
    try {
      sessionStorage.setItem(TAB + scope, JSON.stringify(fits))
    } catch {
      // the tab's storage is full: the page keeps them until it closes
    }
    return
  }
  await run('readwrite', (s) => s.put(fits, scope))
}

/** Disconnect: every conversation this browser kept, and this tab's. */
export function forgetConversations(): Promise<void> {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(TAB)) sessionStorage.removeItem(k)
  } catch {
    // nothing kept in the tab
  }
  return new Promise((resolve) => {
    try {
      const r = indexedDB.deleteDatabase(DB)
      r.onsuccess = r.onerror = r.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}
