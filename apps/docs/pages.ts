// The docs site's pages: Markdown in pages/, written as static HTML into site/ (the Vite root) before Vite runs. Live
// parts are islands the client mounts: a ```loadmap live fence, or a <div data-island="…"> in the Markdown.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Marked, type Token } from 'marked'
import { shippedReference } from '../../scripts/reference'

export interface Page {
  /** Where it is served, without slashes: "" for the home page, "examples/checkout". */
  route: string
  file: string
  /** Its name in the sidebar. */
  nav: string
  group?: string
  /**
   * `app`: the page's Markdown alone fills the window, with no top bar, pages, contents or pager (the editor); its
   * title is for readers of the page's outline. Such a page is left out of the pager and llms.txt.
   */
  frame?: 'app'
  /** Not listed in the sidebar. */
  hidden?: boolean
}

export const PAGES: readonly Page[] = [
  { route: '', file: 'index.md', nav: 'Home', group: 'Start' },
  { route: 'getting-started', file: 'getting-started.md', nav: 'Getting started', group: 'Start' },
  { route: 'concepts', file: 'concepts.md', nav: 'Concepts', group: 'Start' },
  { route: 'without-a-bundler', file: 'without-a-bundler.md', nav: 'Without a bundler', group: 'Start' },
  { route: 'language', file: 'language.md', nav: 'The language', group: 'The language' },
  { route: 'reference', file: 'reference.md', nav: 'Reference', group: 'The language' },
  { route: 'api', file: 'api.md', nav: 'API', group: 'Use it' },
  { route: 'recording', file: 'recording.md', nav: 'Recording and CI', group: 'Use it' },
  { route: 'embedding', file: 'embedding.md', nav: 'Embedding', group: 'Use it' },
  { route: 'examples/checkout', file: 'checkout.md', nav: 'Checkout', group: 'Examples' },
  { route: 'examples/alerts', file: 'alerts.md', nav: 'Alerts', group: 'Examples' },
  { route: 'templates', file: 'templates.md', nav: 'Templates', group: 'Examples' },
  { route: 'editor', file: 'editor.md', nav: 'Editor', group: 'Examples', frame: 'app' },
]

/** The pages in the site's frame: the pager and llms.txt go through these. */
const DOCS = PAGES.filter((p) => !p.frame)

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
 * `from` up to (not including) the first after it that starts with `to`. Without `to`, to the end. `%VERSION%`: the
 * packages' version.
 */
export function expand(md: string): string {
  // %VERSION% is the version of the packages, for a page that names one (a CDN link), included text too
  const version = JSON.parse(readFileSync(join(repo, 'packages/react/package.json'), 'utf8')).version
  return md
    .replace(/^@include\(([^,)]+)(?:,\s*"([^"]*)")?(?:,\s*"([^"]*)")?\)$/gm, (_, path, from, to) => {
      const lines = readFileSync(join(repo, path.trim()), 'utf8').split('\n')
      const start = from ? lines.findIndex((l) => l.startsWith(from)) : 0
      if (start < 0) throw new Error(`docs: no line starting with "${from}" in ${path}`)
      const after = to ? lines.slice(start + 1).findIndex((l) => l.startsWith(to)) : -1
      if (to && after < 0) throw new Error(`docs: no line starting with "${to}" after "${from}" in ${path}`)
      return lines.slice(start, after < 0 ? undefined : start + 1 + after).join('\n')
    })
    .replaceAll('%VERSION%', version)
}

/** The repository files the pages include, for the dev server to watch. */
export function included(): string[] {
  const files = new Set<string>()
  for (const p of PAGES)
    for (const [, path] of readFileSync(join(here, 'pages', p.file), 'utf8').matchAll(/^@include\(([^,)]+)/gm))
      files.add(join(repo, path!.trim()))
  // where %VERSION% comes from
  files.add(join(repo, 'packages/react/package.json'))
  return [...files]
}

export interface Heading {
  depth: 2 | 3
  id: string
  /** Its inline HTML, without links: it goes inside a link in the contents. */
  html: string
}

/** Where the shell puts the group above the title, and the folded contents after the introduction. */
const EYEBROW = '<!--eyebrow-->'
const CONTENTS = '<!--contents-->'

/**
 * A page's HTML: its Markdown with islands, heading anchors, and site links made relative to where it is served; and
 * its h2 and h3 headings, for the contents. Marks EYEBROW before the title and CONTENTS after the introduction (the
 * paragraph right after the title, if there is one).
 */
export function render(page: Page): { title: string; html: string; headings: Heading[] } {
  const md = expand(readFileSync(join(here, 'pages', page.file), 'utf8'))
  const title = /^# (.+)$/m.exec(md)?.[1]?.replace(/`/g, '') ?? page.nav
  const up = relative(page.route)
  const headings: Heading[] = []
  const ids = new Map<string, number>()
  const marked = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens)
        if (depth === 1) return `<h1>${text}</h1>\n`
        // a second heading with the same text gets "-2", so each entry of the contents finds its own
        const base = slug(text)
        const n = (ids.get(base) ?? 0) + 1
        ids.set(base, n)
        const id = n > 1 ? `${base}-${n}` : base
        if (depth === 2 || depth === 3) headings.push({ depth, id, html: text.replace(/<\/?a\b[^>]*>/g, '') })
        return `<h${depth} id="${id}">${text}</h${depth}>\n`
      },
      code({ text, lang }) {
        if (lang === 'loadmap live')
          return `<div class="island" data-island="loadmap" data-editor="${up}editor/"><pre class="code">${esc(text)}</pre></div>\n`
        return `<pre class="code"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(text)}</code></pre>\n`
      },
      link({ href, title, tokens }) {
        const to = href.startsWith('/') && !href.startsWith('//') ? up + href.slice(1) : href
        const out = /^https?:/.test(href) ? ' rel="noopener"' : ''
        return `<a href="${esc(to)}"${title ? ` title="${esc(title)}"` : ''}${out}>${this.parser.parseInline(tokens)}</a>`
      },
    },
  })
  const tokens = marked.lexer(md)
  const mark = (text: string): Token => ({ type: 'html', block: true, pre: false, raw: text, text })
  const h1 = tokens.findIndex((t) => t.type === 'heading' && t.depth === 1)
  if (h1 >= 0) {
    let intro = h1 + 1
    while (tokens[intro]?.type === 'space') intro++
    const next = tokens[intro]
    const after =
      next && (next.type === 'paragraph' || (next.type === 'html' && /^<p[ >]/.test(next.text))) ? intro : h1
    tokens.splice(after + 1, 0, mark(CONTENTS))
    tokens.splice(h1, 0, mark(EYEBROW))
  }
  return { title, html: marked.parser(tokens), headings }
}

/** From a page's route back to the site's root: "" at the root, "../../" two levels down. */
export const relative = (route: string) => (route ? '../'.repeat(route.split('/').length) : './')

const href = (up: string, p: Page) => `${up}${p.route ? `${p.route}/` : ''}`

/** The pages grouped as the sidebar and the phone's menu list them, the current one marked; an app is marked ⤢. */
function pageList(page: Page, up: string): string {
  const nav: string[] = []
  const listed = PAGES.filter((p) => !p.hidden)
  listed.forEach((p, i) => {
    if (i === 0 || p.group !== listed[i - 1]!.group) {
      if (i > 0) nav.push('</ul>')
      if (p.group) nav.push(`<p class="nav-group">${esc(p.group)}</p>`)
      nav.push('<ul>')
    }
    const current = p === page ? ' aria-current="page"' : ''
    const app = p.frame === 'app' ? ' <span class="app-mark" aria-hidden="true">⤢</span>' : ''
    nav.push(`<li><a href="${href(up, p)}"${current}>${esc(p.nav)}${app}</a></li>`)
  })
  nav.push('</ul>')
  return nav.join('')
}

/**
 * The page's sections, when it has enough of them to need a map: beside the text on a wide screen, folded under the
 * introduction on a narrow one (only the h2s there, when there are a few).
 */
function contents(headings: readonly Heading[]): { aside: string; folded: string } | undefined {
  const h2 = headings.filter((h) => h.depth === 2)
  if (h2.length < 3 && headings.length < 6) return undefined
  const list = (hs: readonly Heading[]) =>
    `<ul>${hs.map((h) => `<li class="h${h.depth}"><a href="#${h.id}">${h.html}</a></li>`).join('')}</ul>`
  return {
    aside: `<aside class="toc" aria-label="On this page"><p>On this page</p>${list(headings)}</aside>`,
    folded: `<details class="toc-folded"><summary>On this page</summary>${list(h2.length >= 3 ? h2 : headings)}</details>`,
  }
}

/** Previous and next in the sidebar's order. */
function pager(page: Page, up: string): string {
  const i = DOCS.indexOf(page)
  if (i < 0) return ''
  const prev = DOCS[i - 1]
  const next = DOCS[i + 1]
  const link = (p: Page, rel: 'prev' | 'next') =>
    `<a class="${rel}" rel="${rel}" href="${href(up, p)}"><small>${rel === 'prev' ? '← Previous' : 'Next →'}</small>${esc(p.nav)}</a>`
  return `<nav class="pager" aria-label="Previous and next">${prev ? link(prev, 'prev') : ''}${next ? link(next, 'next') : ''}</nav>`
}

function shell(page: Page, title: string, body: string, headings: readonly Heading[] = []): string {
  const up = relative(page.route)
  const list = pageList(page, up)
  const toc = contents(headings)
  const out = `<a href="https://www.npmjs.com/package/@loadmap/react" rel="noopener">npm</a>
        <a href="https://github.com/jaim3r0jas/loadmap" rel="noopener">GitHub</a>`
  const eyebrow = page.route && page.group ? `<p class="eyebrow">${esc(page.group)}</p>` : ''
  const text = body.replace(EYEBROW, () => eyebrow).replace(CONTENTS, () => toc?.folded ?? '')
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
  <body>
    <header class="top">
      <div class="bar">
        <a class="brand" href="${up}">loadmap</a>
        <span class="version">0.1</span>
        <span class="grow"></span>
        <span class="out">${out}</span>
        <details class="menu">
          <summary><span aria-hidden="true">☰</span> ${esc(page.nav || 'Pages')}</summary>
          <nav class="panel" aria-label="Pages">${list}<p class="out">${out}</p></nav>
        </details>
      </div>
    </header>
    <div class="frame${toc ? ' has-toc' : ''}">
      <nav class="side" aria-label="Pages">${list}</nav>
      <main>
${text}
${pager(page, up)}
      </main>
      ${toc?.aside ?? ''}
    </div>
    <script type="module" src="/client.tsx"></script>
  </body>
</html>
`
}

/**
 * An app page: its Markdown alone in the window. `data-root` leads its islands back to the site's root, wherever it is
 * served.
 */
function appShell(page: Page, title: string, body: string): string {
  const text = body.replace(EYEBROW, '').replace(CONTENTS, '')
  // the whole window, under the notch too (the app pads its own edges), and a keyboard that shrinks it rather than
  // sliding it away
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
    <title>${esc(`${title} · loadmap`)}</title>
    <link rel="stylesheet" href="/docs.css" />
  </head>
  <body class="app" data-root="${relative(page.route)}">
    <main>
${text}
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
    const { title, html, headings } = render(page)
    const file = join(SITE, page.route, 'index.html')
    mkdirSync(dirname(file), { recursive: true })
    update(file, page.frame === 'app' ? appShell(page, title, html) : shell(page, title, html, headings))
    files.push(file)
  }
  const embed = join(SITE, EMBED, 'index.html')
  mkdirSync(dirname(embed), { recursive: true })
  update(embed, EMBED_HTML)
  files.push(embed)
  const missing = join(SITE, '404.html')
  const notFound = { route: '', file: '', nav: '' }
  const body = '<h1>Not found</h1>\n<p>No page here. Every page is in the list of pages.</p>'
  update(missing, shell(notFound, 'Not found', body).replace(/href="\.\//g, `href="${base}`))
  files.push(missing)
  return files
}

/** Where the page an embed frames is served: not a page of the site, so in no list. */
export const EMBED = 'embed'

/**
 * The page an embed frames: nothing but the definition, filling the frame and never scrolling. Search engines leave
 * it out; the docs' stylesheet stays out too, so it loads only loadmap.
 */
const EMBED_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>loadmap</title>
    <style>
      html, body, #embed { height: 100%; margin: 0; overflow: hidden; }
      body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1d2330; background: #f6f7f9; }
      .embed-open { margin-left: 10px; font-size: .75rem; font-weight: 500; color: var(--lm-muted); text-decoration: none; border: 1px solid var(--lm-line); border-radius: 5px; padding: 1px 7px; white-space: nowrap; vertical-align: 2px; }
      .embed-open:hover, .embed-open:focus-visible { color: var(--lm-fg); border-color: var(--lm-accent); }
      .embed-problem { height: 100%; box-sizing: border-box; padding: 16px; display: flex; flex-direction: column; gap: 6px; align-items: center; justify-content: center; text-align: center; font-size: 14px; }
      .embed-problem code { font: 12px ui-monospace, Menlo, monospace; color: #5d6677; overflow-wrap: anywhere; }
      .embed-problem a { color: #0d6a8a; }
      /* the title, and Open ↗ with it, stays in a narrow frame, which full screen's narrow layout would hide */
      @media (min-height: 261px) { html .lm[data-full] .lm-head h2 { display: block; } }
      /* a frame of a doc's height keeps the story to its buttons: the board titles the step while it plays */
      @media (max-height: 520px) { .lm[data-full] > .lm-story p { display: none; } }
      /* a short frame keeps the diagram and one line of verdict */
      @media (max-height: 260px) {
        .lm .lm-story, .lm .lm-line .lm-range, .lm .lm-line .lm-link, .lm .lm-legend, .lm .lm-dock { display: none; }
        .lm .lm-headline { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      }
      @media (prefers-color-scheme: dark) {
        body { color: #e6e9ee; background: #14171c; }
        .embed-problem code { color: #9aa3b2; }
        .embed-problem a { color: #4fb3d9; }
      }
    </style>
  </head>
  <body>
    <div id="embed"></div>
    <script type="module" src="/embed.tsx"></script>
  </body>
</html>
`

const PUBLISHED = 'https://jaim3r0jas.github.io/loadmap/'

/**
 * For a language model: llms.txt, the site's pages by group, and llms-full.txt, the language guide and the whole
 * reference in one file with a model that uses every statement. Links are absolute, to the published site: the file
 * is often read away from where it was served.
 */
export function llms(): Record<'llms.txt' | 'llms-full.txt', string> {
  const groups = new Map<string, Page[]>()
  for (const p of DOCS) groups.set(p.group!, [...(groups.get(p.group!) ?? []), p])
  const map = [
    '# loadmap',
    '',
    '> Interactive capacity models for React: an architecture diagram whose parts are live, a ranked list of which ' +
      "component runs out first and at what multiple of today's load, and the verdict in words. Written in " +
      'TypeScript or in the `.loadmap` language; `loadmap check` tests a model in CI.',
    '',
    'The `.loadmap` reference also ships in `@loadmap/dsl`, as `dist/REFERENCE.md`.',
    '',
    ...[...groups].flatMap(([group, pages]) => [
      `## ${group}`,
      '',
      ...pages.map((p) => `- [${p.nav}](${PUBLISHED}${p.route ? `${p.route}/` : ''})`),
      '',
    ]),
    '## Optional',
    '',
    `- [llms-full.txt](${PUBLISHED}llms-full.txt): the language guide and the whole reference in one file, and one model that uses every statement`,
    '',
  ].join('\n')
  const model = readFileSync(join(repo, 'docs/every-statement.loadmap'), 'utf8').trimEnd()
  const full = [
    shippedReference().trimEnd(),
    '',
    '## A complete model',
    '',
    'Every statement and top-level property of the language at least once, and an edge with a block and one without:',
    '',
    '```',
    model,
    '```',
    '',
  ].join('\n')
  return { 'llms.txt': map, 'llms-full.txt': full }
}

/** Writes a file only when its text changes: the dev server reloads the page on every write it sees. */
function update(file: string, text: string) {
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return
  writeFileSync(file, text)
}
