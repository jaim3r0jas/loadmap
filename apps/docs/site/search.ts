// The site's search: a dialog over the page, its index (search.json, every section of every page) fetched the first
// time it opens. Loaded on the first press of the top bar's button, "/" or ⌘K: never in a page's first load, so its
// styles come with it.
import type { Found } from '../pages'

const CSS = `
.search-dialog { width: min(640px, calc(100vw - 32px)); max-height: min(560px, calc(100vh - 96px)); margin: 72px auto auto; padding: 0; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); color: var(--fg); box-shadow: 0 24px 64px rgb(0 0 0 / 0.35); overflow: hidden; }
.search-dialog[open] { display: flex; flex-direction: column; }
.search-dialog::backdrop { background: rgb(0 0 0 / 0.45); }
.search-field { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.search-field input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; color: inherit; font: inherit; font-size: 1.05rem; }
.search-field kbd, .search-foot kbd { font: 0.72rem ui-monospace, Menlo, monospace; border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; color: var(--muted); }
.search-results { list-style: none; margin: 0; padding: 6px; overflow-y: auto; }
.search-results li a { display: block; padding: 8px 12px; border-radius: 8px; color: inherit; text-decoration: none; }
.search-results li[aria-selected="true"] a { background: var(--surface); outline: 1px solid var(--accent); }
.search-results .where { display: block; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.search-results .title { font-weight: 600; }
.search-results .text { display: block; margin-top: 2px; font-size: 0.85rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.search-results mark { background: none; color: var(--accent); font-weight: 600; }
.search-foot { display: flex; gap: 14px; padding: 8px 16px; border-top: 1px solid var(--line); font-size: 0.78rem; color: var(--muted); }
.search-foot [role="status"] { margin-right: auto; }
@media (max-width: 640px) { .search-dialog { margin-top: 16px; max-height: calc(100vh - 32px); } .search-foot .keys { display: none; } }
`

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

interface Hit {
  found: Found
  score: number
}

/**
 * The sections that hold every word of the query, best first: a word in the heading counts most (all the more at its
 * start, and the whole heading most of all), then in the page's title, then each time it is in the text (up to five).
 */
export function rank(index: readonly Found[], query: string, limit = 20): Found[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const whole = words.join(' ')
  const hits: Hit[] = []
  for (const found of index) {
    const h = fold(found.h)
    const p = fold(found.p)
    const t = fold(found.t)
    let score = h === whole ? 40 : 0
    let all = true
    for (const w of words) {
      const inH = h.includes(w)
      const inP = p.includes(w)
      let n = 0
      for (let at = t.indexOf(w); at >= 0 && n < 5; at = t.indexOf(w, at + w.length)) n++
      if (!inH && !inP && !n) {
        all = false
        break
      }
      score += (inH ? 10 : 0) + (inH && (h.startsWith(w) || h.includes(` ${w}`)) ? 5 : 0) + (inP ? 3 : 0) + n
    }
    if (all) hits.push({ found, score })
  }
  return hits
    .sort((a, b) => b.score - a.score || a.found.h.length - b.found.h.length)
    .slice(0, limit)
    .map((h) => h.found)
}

/**
 * A line of a section's text around the first word of the query found in it, each word marked. Found in the text as
 * written, its case aside: folding the accents could move a position, and the line is cut from the text as written.
 */
export function excerpt(text: string, query: string): string {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const lower = text.toLowerCase()
  const first = Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0))
  const from = Number.isFinite(first) ? Math.max(0, first - 40) : 0
  const piece = (from ? '…' : '') + text.slice(from, from + 160)
  const marks = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  // marked before escaping, so a word never lands inside an entity (`&lt;`)
  return piece
    .split(new RegExp(`(${marks})`, 'gi'))
    .map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part)))
    .join('')
}

let dialog: HTMLDialogElement | undefined
let index: Promise<Found[]> | undefined

/** Opens the search over the page; `root` is the site's root, where search.json and every page are. */
export function open(root: string) {
  dialog ??= build(root)
  if (dialog.open) return
  dialog.showModal()
  const input = dialog.querySelector('input')!
  input.select()
}

function build(root: string): HTMLDialogElement {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.append(style)
  const d = document.createElement('dialog')
  d.className = 'search-dialog'
  d.setAttribute('aria-label', 'Search the docs')
  d.innerHTML = `<div class="search-field"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search the docs" aria-label="Search the docs" role="combobox" aria-expanded="true" aria-controls="search-results" aria-autocomplete="list" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div><ul class="search-results" id="search-results" role="listbox" aria-label="Results"></ul><div class="search-foot"><span role="status"></span><span class="keys"><kbd>↑</kbd> <kbd>↓</kbd> to pick, <kbd>Enter</kbd> to go</span></div>`
  document.body.append(d)
  const input = d.querySelector('input')!
  const list = d.querySelector('ul')!
  const status = d.querySelector('[role="status"]')!
  let shown: Found[] = []
  let at = 0

  // fetched on the first query; one that fails is asked for again on the next
  const load = () => {
    index ??= fetch(`${root}search.json`).then((r) => {
      if (!r.ok) throw new Error(`search.json: ${r.status}`)
      return r.json() as Promise<Found[]>
    })
    return index
  }
  void load().catch(() => undefined)

  const pick = (i: number) => {
    at = i
    for (const [n, li] of [...list.children].entries()) li.setAttribute('aria-selected', String(n === i))
    const li = list.children[i] as HTMLElement | undefined
    if (li) {
      input.setAttribute('aria-activedescendant', li.id)
      li.scrollIntoView({ block: 'nearest' })
    } else input.removeAttribute('aria-activedescendant')
  }

  const show = async () => {
    const query = input.value.trim()
    if (!query) {
      shown = []
      list.innerHTML = ''
      status.textContent = ''
      return
    }
    let all: Found[]
    try {
      all = await load()
    } catch {
      index = undefined
      status.textContent = 'The search could not load its index: type again to retry.'
      return
    }
    // a newer key press may have run first
    if (input.value.trim() !== query) return
    // one more than are shown, to know whether there are more
    const ranked = rank(all, query, 21)
    shown = ranked.slice(0, 20)
    list.innerHTML = shown
      .map(
        (f, i) =>
          `<li role="option" id="search-${i}" aria-selected="false"><a href="${esc(root + f.u)}" tabindex="-1"><span class="where">${esc(f.p)}</span><span class="title">${esc(f.h)}</span><span class="text">${excerpt(f.t, query)}</span></a></li>`,
      )
      .join('')
    status.textContent = shown.length ? `${shown.length}${ranked.length > 20 ? '+' : ''} found` : 'Nothing found'
    pick(0)
  }

  input.addEventListener('input', () => void show())
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (shown.length) pick((at + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length)
    } else if (e.key === 'Enter') {
      const a = list.children[at]?.querySelector('a')
      if (!a) return
      e.preventDefault()
      d.close()
      a.click()
    }
  })
  // a click on a result goes there; one on the backdrop closes
  list.addEventListener('click', () => d.close())
  d.addEventListener('click', (e) => e.target === d && d.close())
  return d
}
