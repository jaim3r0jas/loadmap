// The page GitHub sends the editor's sign-in popup back to: it hands the code (and the state the editor sent, to
// match) to the editor that opened it, on this site only, and closes. The code is worth nothing without the PKCE
// verifier, which never left the editor.
const q = new URLSearchParams(location.search)
const said = document.getElementById('said')
const editor = window.opener as Window | null
if (editor && q.get('state')) {
  editor.postMessage(
    {
      type: q.get('for') === 'openrouter' ? 'loadmap-openrouter-sign-in' : 'loadmap-github-sign-in',
      state: q.get('state'),
      code: q.get('code'),
      error: q.get('error_description') ?? q.get('error'),
    },
    location.origin,
  )
  // the code leaves the address before anything else could read it
  history.replaceState(null, '', location.pathname)
  window.close()
} else if (said)
  said.textContent = 'This page is where GitHub sends a sign-in from the loadmap editor: open the editor.'

export {}
