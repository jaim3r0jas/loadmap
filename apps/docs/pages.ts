// The docs site's pages: Markdown in pages/, written as static HTML into site/ (the Vite root) before Vite runs. Live
// parts are islands the client mounts: a ```loadmap live fence, or a <div data-island="…"> in the Markdown.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Marked } from 'marked'

export interface Page {
  /** Where it is served, without slashes: "" for the home page, "examples/checkout". */
  route: string
  file: string
  /** Its name in the sidebar. */
  nav: string
  group?: string
  /** The page takes the whole width: the editor. */
  wide?: boolean
}

export const PAGES: readonly Page[] = [
  { route: '', file: 'index.md', nav: 'Home' },
  { route: 'getting-started', file: 'getting-started.md', nav: 'Getting started' },
  { route: 'concepts', file: 'concepts.md', nav: 'Concepts' },
  { route: 'language', file: 'language.md', nav: 'The language' },
  { route: 'reference', file: 'reference.md', nav: 'Reference' },
  { route: 'api', file: 'api.md', nav: 'API' },
  { route: 'recording', file: 'recording.md', nav: 'Recording and CI' },
  { route: 'examples/checkout', file: 'checkout.md', nav: 'Checkout', group: 'Examples' },
  { route: 'examples/alerts', file: 'alerts.md', nav: 'Alerts', group: 'Examples' },
  { route: 'templates', file: 'templates.md', nav: 'Templates', group: 'Examples' },
  { route: 'editor', file: 'editor.md', nav: 'Editor', group: 'Examples', wide: true },
]

const here = import.meta.dirname
const repo = join(here, '../..')
export const SITE = join(here, 'site')

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>|&\w+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/**
 * `@include(path, "from", "to")` on a line of its own: the lines of a repository file from the first that starts with
 * `from` up to (not including) the first after it that starts with `to`. Without `to`, to the end.
 */
export function expand(md: string): string {
  return md.replace(/^@include\(([^,)]+)(?:,\s*"([^"]*)")?(?:,\s*"([^"]*)")?\)$/gm, (_, path, from, to) => {
    const lines = readFileSync(join(repo, path.trim()), 'utf8').split('\n')
    const start = from ? lines.findIndex((l) => l.startsWith(from)) : 0
    if (start < 0) throw new Error(`docs: no line starting with "${from}" in ${path}`)
    const after = to ? lines.slice(start + 1).findIndex((l) => l.startsWith(to)) : -1
    if (to && after < 0) throw new Error(`docs: no line starting with "${to}" after "${from}" in ${path}`)
    return lines.slice(start, after < 0 ? undefined : start + 1 + after).join('\n')
  })
}

/** A page's HTML: its Markdown with islands, heading anchors, and site links made relative to where it is served. */
export function render(page: Page): { title: string; html: string } {
  const md = expand(readFileSync(join(here, 'pages', page.file), 'utf8'))
  const title = /^# (.+)$/m.exec(md)?.[1]?.replace(/`/g, '') ?? page.nav
  const up = relative(page.route)
  const marked = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens)
        return depth === 1 ? `<h1>${text}</h1>\n` : `<h${depth} id="${slug(text)}">${text}</h${depth}>\n`
      },
      code({ text, lang }) {
        if (lang === 'loadmap live')
          return `<div class="island" data-island="loadmap"><pre class="code">${esc(text)}</pre></div>\n`
        return `<pre class="code"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(text)}</code></pre>\n`
      },
      link({ href, title, tokens }) {
        const to = href.startsWith('/') && !href.startsWith('//') ? up + href.slice(1) : href
        const out = /^https?:/.test(href) ? ' rel="noopener"' : ''
        return `<a href="${esc(to)}"${title ? ` title="${esc(title)}"` : ''}${out}>${this.parser.parseInline(tokens)}</a>`
      },
    },
  })
  return { title, html: marked.parse(md, { async: false }) }
}

/** From a page's route back to the site's root: "" at the root, "../../" two levels down. */
export const relative = (route: string) => (route ? '../'.repeat(route.split('/').length) : './')

function shell(page: Page, title: string, body: string): string {
  const up = relative(page.route)
  const nav: string[] = []
  PAGES.forEach((p, i) => {
    if (i === 0 || p.group !== PAGES[i - 1]!.group) {
      if (i > 0) nav.push('</ul>')
      if (p.group) nav.push(`<p class="nav-group">${esc(p.group)}</p>`)
      nav.push('<ul>')
    }
    const current = p === page ? ' aria-current="page"' : ''
    nav.push(`<li><a href="${up}${p.route ? `${p.route}/` : ''}"${current}>${esc(p.nav)}</a></li>`)
  })
  nav.push('</ul>')
  const head = page.route ? `${title} · loadmap` : 'loadmap: interactive capacity models'
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(head)}</title>
    <meta name="description" content="loadmap draws a system's architecture with its load flowing through it, ranks the parts by when they run out, and writes the verdict." />
    <link rel="stylesheet" href="/docs.css" />
  </head>
  <body${page.wide ? ' class="wide"' : ''}>
    <header class="top">
      <a class="brand" href="${up}">loadmap</a>
      <span class="version">0.1</span>
      <span class="grow"></span>
      <a href="https://www.npmjs.com/package/@loadmap/react" rel="noopener">npm</a>
      <a href="https://github.com/jaim3r0jas/loadmap" rel="noopener">GitHub</a>
    </header>
    <nav class="side" aria-label="Pages">${nav.join('')}</nav>
    <main>
${body}
    </main>
    <script type="module" src="/client.tsx"></script>
  </body>
</html>
`
}

/**
 * Writes every page into site/, and a 404 whose links start at `base` (GitHub Pages serves it at any depth). Returns
 * the HTML files.
 */
export function writePages(base = '/'): string[] {
  const files: string[] = []
  for (const page of PAGES) {
    const { title, html } = render(page)
    const file = join(SITE, page.route, 'index.html')
    mkdirSync(dirname(file), { recursive: true })
    update(file, shell(page, title, html))
    files.push(file)
  }
  const missing = join(SITE, '404.html')
  const notFound = { route: '', file: '', nav: '' }
  const body = '<h1>Not found</h1>\n<p>No page here. The sidebar lists every page.</p>'
  update(missing, shell(notFound, 'Not found', body).replace(/href="\.\//g, `href="${base}`))
  files.push(missing)
  return files
}

/** Writes a file only when its text changes: the dev server reloads the page on every write it sees. */
function update(file: string, text: string) {
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return
  writeFileSync(file, text)
}
