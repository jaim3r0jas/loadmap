// The docs' ModelSettings for the Ask panel: the reader's choice of model and their keys, kept by the site's Worker
// for a reader connected through the app, so a return or another device finds them set. Every call is signed by this
// browser's key (connection.ts); a key comes back only for the question that needs it, and goes nowhere but its
// provider from there.
import type { KeptSettings, ModelSettings } from '@loadmap/editor'
import { signedSettings } from './connection'

/** A refusal the reader can read. */
async function why(res: Response): Promise<Error> {
  const { error } = (await res.json().catch(() => ({}))) as { error?: unknown }
  if (error === 'busy') return new Error('Your account saved its settings many times today: try again tomorrow.')
  if (error === 'too_many' || error === 'too_large') return new Error('That is more than your account may keep.')
  if (res.status === 401) return new Error('Connect to GitHub again to reach what your account keeps.')
  return new Error("The site's service did not answer. Try again in a moment.")
}

async function call(request: object): Promise<Response> {
  const res = await signedSettings(request)
  if (!res) throw new Error('Connect to GitHub through the app to remember it for your account.')
  if (!res.ok) throw await why(res)
  return res
}

export const settings: ModelSettings = {
  where: "this site's service",
  load: async (repo): Promise<KeptSettings | null> => {
    let res: Response | undefined
    try {
      res = await signedSettings({ op: 'read', ...(repo && { repo }) })
    } catch {
      return null
    }
    // not connected through the app, or the service keeps nothing (not set up): nothing to remember with
    if (!res?.ok) return null
    const got = (await res.json().catch(() => ({}))) as { choice?: unknown; keys?: unknown; repo?: unknown }
    const c = got.choice as { provider?: unknown; model?: unknown } | undefined
    const r = got.repo as { provider?: unknown; model?: unknown; ownKey?: unknown } | undefined
    return {
      ...(typeof c?.provider === 'string' &&
        typeof c.model === 'string' && { choice: { provider: c.provider, model: c.model } }),
      keys: Array.isArray(got.keys) ? got.keys.filter((k): k is string => typeof k === 'string') : [],
      ...(typeof r?.provider === 'string' &&
        typeof r.model === 'string' && { repo: { provider: r.provider, model: r.model, ownKey: r.ownKey === true } }),
    }
  },
  key: async (provider, repo) => {
    const got = (await (await call({ op: 'key', provider, ...(repo && { repo }) })).json().catch(() => ({}))) as {
      key?: unknown
    }
    return typeof got.key === 'string' ? got.key : undefined
  },
  save: async (choice) => {
    await call({ op: 'save', ...choice })
  },
  remove: async (what) => {
    await call({ op: 'remove', what })
  },
}
