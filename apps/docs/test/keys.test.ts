import { describe, expect, it } from 'vitest'
import { type OpenRouterHost, openRouterSignIn } from '../site/islands/openrouter'

describe('signing in with OpenRouter', () => {
  it('asks for a key with a challenge, and swaps the code for it with the verifier that never left the page', async () => {
    let posted: Record<string, unknown> = {}
    let opened = ''
    let deliver: (data: unknown, from: Window | null) => void = () => {}
    const popup = { closed: true } as Window
    const host: OpenRouterHost = {
      open: (url) => {
        opened = url
        return popup
      },
      listen: (f) => {
        deliver = f
        return () => {}
      },
      back: 'https://docs.example/signed-in/',
      fetch: async (_input, init) => {
        posted = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ key: 'sk-or-v1-made' }), { status: 200 })
      },
    }
    const key = openRouterSignIn(host)
    await expect.poll(() => opened).not.toBe('')
    const url = new URL(opened)
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    // the state rides in the way back's fragment: OpenRouter adds its code to the address however it likes
    const back = new URL(url.searchParams.get('callback_url')!)
    expect(back.search).toBe('')
    const said = new URLSearchParams(back.hash.slice(1))
    expect(said.get('for')).toBe('openrouter')
    const state = said.get('state')!
    // a window that is not the popup, or another state, is not the answer; a popup that reads as closed (an opener
    // cut off) is not given up on
    deliver({ type: 'loadmap-openrouter-sign-in', state, code: 'x' }, {} as Window)
    deliver({ type: 'loadmap-openrouter-sign-in', state: 'other', code: 'x' }, popup)
    // the site's own channel, when OpenRouter cut the opener off
    deliver({ type: 'loadmap-openrouter-sign-in', state, code: 'c0de' }, null)
    expect(await key).toBe('sk-or-v1-made')
    expect(posted).toMatchObject({ code: 'c0de', code_challenge_method: 'S256' })
    expect(typeof posted.code_verifier).toBe('string')
  })
})
