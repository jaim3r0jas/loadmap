// The reader's light or dark, kept in this browser; nothing kept follows the system. It is `data-theme` on <html>,
// which docs.css and every board with theme="inherit" follow. HEAD sets it before the first paint; the switch, on
// every page and in the editor's bar (theme-switch.ts), changes it. Every page loads this, the markup apart; the
// embed loads none of it, since its link decides.
export type Choice = 'system' | 'light' | 'dark'

const KEY = 'loadmap-theme'

/** In each page's <head>, before the stylesheet: the kept choice is on <html> before anything is drawn. */
export const HEAD = `<script>try{var t=localStorage.getItem('${KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>`

/** The page's choice, as <html> carries it. */
export function current(): Choice {
  const t = document.documentElement.dataset.theme
  return t === 'light' || t === 'dark' ? t : 'system'
}

/** What this browser keeps; null when it refuses storage, and the page's own choice stands. */
function kept(): Choice | null {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return null
  }
}

function show(c: Choice) {
  const html = document.documentElement
  if (c === 'system') delete html.dataset.theme
  else html.dataset.theme = c
  for (const input of document.querySelectorAll<HTMLInputElement>('.theme input')) input.checked = input.value === c
}

function choose(c: Choice) {
  try {
    if (c === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, c)
  } catch {
    // a private window refuses storage: the choice holds on this page only
  }
  show(c)
}

/**
 * Makes every switch on the page work, the ones drawn later too (the editor's), shows the choice on them, and follows
 * a change made elsewhere: in another tab, or on another page before Back brought this one out of the cache.
 */
export function wire() {
  document.addEventListener('change', (e) => {
    const input = e.target
    if (input instanceof HTMLInputElement && input.checked && input.closest('.theme')) choose(input.value as Choice)
  })
  const again = () => {
    const c = kept()
    if (c) show(c)
  }
  addEventListener('storage', (e) => (e.key === KEY || e.key === null) && again())
  addEventListener('pageshow', (e) => e.persisted && again())
  show(current())
}
