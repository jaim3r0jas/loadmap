// "Sign in with OpenRouter": a key made for this page with PKCE, in a popup, with no server of the site's. OpenRouter
// sends the popup back to the site's /signed-in/ page with a code, worth nothing without the verifier that never left
// this page, and the two are swapped for a key. The key is the reader's; it stays in memory or this tab. This file
// talks to openrouter.ai alone, and loads only when the reader presses the button.
import { backTo, challengeOf, random } from './github/signin'

export interface OpenRouterHost {
  open: (url: string) => Window | null
  /** Hears what /signed-in/ says: by the opener's window when it has one, and on a channel of this site when not. */
  listen: (f: (data: unknown, from: Window | null) => void) => () => void
  back: string
  fetch: typeof fetch
}

/** How long a sign-in may take before the page stops waiting: the reader may make an account on the way. */
const WAIT = 10 * 60_000

const browser = (): OpenRouterHost => ({
  open: (url) => window.open(url, 'loadmap-openrouter', 'popup,width=520,height=720'),
  listen: (f) => {
    const on = (e: MessageEvent) => e.origin === location.origin && f(e.data, e.source as Window | null)
    window.addEventListener('message', on)
    // a page that cuts the opener off (Cross-Origin-Opener-Policy) leaves /signed-in/ without one: it says it here
    const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('loadmap-sign-in')
    if (channel) channel.onmessage = (e) => f(e.data, null)
    return () => {
      window.removeEventListener('message', on)
      channel?.close()
    }
  },
  back: backTo(),
  fetch: (input, init) => fetch(input, init),
})

/**
 * The authorize page, with the way back and the challenge. The state rides in the way back's fragment: OpenRouter adds
 * `?code=` to the address it was given, and a fragment survives however it adds it.
 */
export function openRouterUrl(o: { back: string; state: string; challenge: string }): string {
  const back = new URL(o.back)
  back.hash = new URLSearchParams({ for: 'openrouter', state: o.state }).toString()
  const q = new URLSearchParams({ callback_url: back.href, code_challenge: o.challenge, code_challenge_method: 'S256' })
  return `https://openrouter.ai/auth?${q}`
}

/** A key from OpenRouter for this reader: a popup, then the code swapped for the key with the verifier. */
export async function openRouterSignIn(host: OpenRouterHost = browser()): Promise<string> {
  const state = random()
  const verifier = random()
  const popup = host.open(openRouterUrl({ back: host.back, state, challenge: await challengeOf(verifier) }))
  if (!popup) throw new Error('The browser blocked the sign-in window: allow pop-ups for this page and try again.')
  const code = await new Promise<string>((resolve, reject) => {
    let stop = () => {}
    // the popup's `closed` says nothing once OpenRouter cuts the opener off: the page waits for the answer, or gives up
    const give = setTimeout(() => {
      stop()
      reject(new Error('OpenRouter did not answer in 10 minutes: try again, or paste a key.'))
    }, WAIT)
    stop = host.listen((data, from) => {
      // the window opened, or the site's own channel; and the state this sign-in sent
      if (from !== null && from !== popup) return
      const m = data as { type?: unknown; state?: unknown; code?: unknown; error?: unknown } | null
      if (m?.type !== 'loadmap-openrouter-sign-in' || m.state !== state) return
      clearTimeout(give)
      stop()
      if (typeof m.code === 'string' && m.code) resolve(m.code)
      else reject(new Error(`OpenRouter did not sign you in${typeof m.error === 'string' ? `: ${m.error}` : '.'}`))
    })
  })
  let res: Response
  try {
    res = await host.fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
      credentials: 'omit',
    })
  } catch {
    throw new Error('OpenRouter could not be reached. Try again, or paste a key.')
  }
  const got = (await res.json().catch(() => ({}))) as { key?: unknown }
  if (typeof got.key !== 'string') throw new Error('OpenRouter did not give a key. Try again, or paste one.')
  return got.key
}
