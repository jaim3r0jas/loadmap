// The page a sign-in popup comes back to (GitHub's, or OpenRouter's): it hands the code, and the state the editor sent
// to match, to the editor that opened it, on this site only, and closes. The code is worth nothing without the PKCE
// verifier, which never left the editor.
const q = new URLSearchParams(location.search)
// OpenRouter's way back carries the state in the fragment, and its code after it or before it
const h = new URLSearchParams(location.hash.slice(1).replace('?', '&'))
const openrouter = h.get('for') === 'openrouter'
const state = openrouter ? h.get('state') : q.get('state')
const said = document.getElementById('said')
const editor = window.opener as Window | null
if (state) {
  const message = {
    type: openrouter ? 'loadmap-openrouter-sign-in' : 'loadmap-github-sign-in',
    state,
    code: q.get('code') ?? h.get('code'),
    error: q.get('error_description') ?? q.get('error') ?? h.get('error'),
  }
  if (editor) editor.postMessage(message, location.origin)
  // a provider that cut the opener off (Cross-Origin-Opener-Policy) leaves no window to answer: the site's channel
  else if (openrouter && typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('loadmap-sign-in')
    channel.postMessage(message)
    channel.close()
  }
  // the code leaves the address before anything else could read it
  history.replaceState(null, '', location.pathname)
  window.close()
} else if (said)
  said.textContent = 'This page is where a sign-in from the loadmap editor comes back to: open the editor.'

export {}
