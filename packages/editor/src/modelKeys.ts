/**
 * Where a model's key is kept: in this page's memory, gone with it, or in this tab (sessionStorage) when the reader
 * ticks it, gone when the tab closes. Never localStorage, an address, a share link, the text or a log: the GitHub
 * token's rule. "Forget" takes it out of both at once.
 */

const memory = new Map<string, string>()
const KEY = (provider: string) => `loadmap-assist-key:${provider}`

function tab(): Storage | undefined {
  try {
    return sessionStorage
  } catch {
    return undefined
  }
}

export function readKey(provider: string): { key: string; kept: boolean } | undefined {
  // the tab's copy first: a key kept there is kept, whether this page has it in memory too or not
  try {
    const t = tab()?.getItem(KEY(provider))
    if (t) return { key: t, kept: true }
  } catch {}
  const m = memory.get(provider)
  return m ? { key: m, kept: false } : undefined
}

export function takeKey(provider: string, key: string, keep: boolean): void {
  const k = key.trim()
  if (!k) return
  memory.set(provider, k)
  try {
    if (keep) tab()?.setItem(KEY(provider), k)
    else tab()?.removeItem(KEY(provider))
  } catch {}
}

export function forgetKey(provider: string): void {
  memory.delete(provider)
  try {
    tab()?.removeItem(KEY(provider))
  } catch {}
}
