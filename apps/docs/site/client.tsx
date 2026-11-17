import { wire } from './theme'

// The light and dark switch: in the top bar, the menu and the editor's bar.
wire()

// Mounts the live parts of a page. Each island loads its own code, so a page without one loads almost nothing.
const ISLANDS: Record<string, () => Promise<{ mount: (el: HTMLElement) => void }>> = {
  loadmap: () => import('./islands/live'),
  example: () => import('./islands/example'),
  editor: () => import('./islands/editor'),
  gallery: () => import('./islands/gallery'),
  framed: () => import('./islands/framed'),
  quickstart: () => import('./islands/quickstart'),
}

for (const el of document.querySelectorAll<HTMLElement>('[data-island]')) {
  const load = ISLANDS[el.dataset.island ?? '']
  if (!load) continue
  load().then(
    (m) => m.mount(el),
    (err) => console.error(`loadmap docs: the ${el.dataset.island} island failed to load`, err),
  )
}

// A snippet's copy button copies all of it, whatever is selected. "Copied" stays until the pointer or the focus leaves
// the button: no timer, so a slow reader (or screen reader) is never cut short.
const said = document.createElement('p')
said.className = 'sr-only'
said.setAttribute('role', 'status')
for (const button of navigator.clipboard ? document.querySelectorAll<HTMLButtonElement>('.snippet > .copy') : []) {
  const say = (text: string) => {
    button.textContent = text
    said.textContent = text === 'Copy' ? '' : text
  }
  button.hidden = false
  button.addEventListener('click', () => {
    if (!said.isConnected) document.body.append(said)
    const text = button.parentElement?.querySelector('pre')?.textContent ?? ''
    navigator.clipboard.writeText(text).then(
      () => say('Copied'),
      () => say('Not copied'),
    )
  })
  button.addEventListener('pointerleave', () => say('Copy'))
  button.addEventListener('blur', () => say('Copy'))
}

// A snippet becomes a read-only editor (the cursor goes in) once it is near the window: CodeMirror loads then, once,
// and never on a page without a snippet.
const snippets = document.querySelectorAll<HTMLElement>('.snippet > pre')
if (snippets.length) {
  const near = new IntersectionObserver(
    (seen) => {
      for (const entry of seen) {
        if (!entry.isIntersecting) continue
        near.unobserve(entry.target)
        import('./snippet').then(
          (m) => m.mount(entry.target as HTMLElement),
          (err) => console.error('loadmap docs: the snippets failed to load', err),
        )
      }
    },
    { rootMargin: '400px' },
  )
  for (const pre of snippets) near.observe(pre)
}

// Marks the contents entry of the section being read: the last heading above the top third of the window, none in the
// introduction, and the last one once the page is scrolled to its end (the last sections are too short to get there).
const toc = document.querySelector<HTMLElement>('.toc')
const entries = [...document.querySelectorAll<HTMLAnchorElement>('.toc a')]
const sections = entries.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1))))
let shown = -1
let queued = false
function mark() {
  queued = false
  // hidden below 1280 px: nothing to mark
  if (!toc?.offsetParent) return
  const end = innerHeight + scrollY >= document.documentElement.scrollHeight - 2
  let at = -1
  sections.forEach((h, i) => {
    if (h && h.getBoundingClientRect().top < innerHeight / 3) at = i
  })
  if (end) at = entries.length - 1
  if (at === shown) return
  entries[shown]?.removeAttribute('aria-current')
  shown = at
  const entry = entries[at]
  if (!entry) return
  entry.setAttribute('aria-current', 'location')
  // a long list scrolls inside its column: keep the entry in sight
  const top = entry.getBoundingClientRect().top - toc.getBoundingClientRect().top + toc.scrollTop
  if (top < toc.scrollTop || top + entry.offsetHeight > toc.scrollTop + toc.clientHeight)
    toc.scrollTop = top - toc.clientHeight / 3
}
const queue = () => {
  if (!queued) requestAnimationFrame(mark)
  queued = true
}
if (entries.length) {
  addEventListener('scroll', queue, { passive: true })
  addEventListener('resize', queue)
  mark()
}
