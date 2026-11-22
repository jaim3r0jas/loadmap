// "Sign in with OpenRouter": a key made for this page with PKCE, in a popup, with no server of the site's: OpenRouter
// sends the popup back to the site's /signed-in/ page with a code, which is worth nothing without the verifier that
// never left this page, and swaps the two for a key. The key is the reader's; it stays in memory or this tab.
import { backTo, challengeOf } from './signin'

const random = () => {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...b))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

export interface OpenRouterHost {
  open: (url: string) => Window | null
  listen: (f: (e: MessageEvent) => void) => () => void
  origin: string
  back: string
  fetch: typeof fetch
}

const browser = (): OpenRouterHost => ({
  open: (url) => window.open(url, 'loadmap-openrouter', 'popup,width=520,height=720'),
  listen: (f) => {
    window.addEventListener('message', f)
    return () => window.removeEventListener('message', f)
  },
  origin: location.origin,
  back: backTo(),
  fetch: (input, init) => fetch(input, init),
})

/** The authorize page, with the way back and the challenge. */
export function openRouterUrl(o: { back: string; state: string; challenge: string }): string {
  const back = new URL(o.back)
  back.searchParams.set('for', 'openrouter')
  back.searchParams.set('state', o.state)
  const q = new URLSearchParams({
    callback_url: back.href,
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
  })
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
    const watch = setInterval(() => {
      if (popup.closed) {
        clearInterval(watch)
        stop()
        reject(new Error('The sign-in window closed before OpenRouter answered.'))
      }
    }, 500)
    stop = host.listen((e) => {
      if (e.origin !== host.origin || e.source !== popup) return
      const m = e.data as { type?: unknown; state?: unknown; code?: unknown; error?: unknown } | null
      if (m?.type !== 'loadmap-openrouter-sign-in' || m.state !== state) return
      clearInterval(watch)
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
