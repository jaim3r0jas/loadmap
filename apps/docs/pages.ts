// The docs site's pages: Markdown in pages/, written as static HTML into site/ (the Vite root) before Vite runs. Live
// parts are islands the client mounts: a ```loadmap live fence, or a <div data-island="…"> in the Markdown.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { LANGUAGE_VERSION } from '@loadmap/dsl'
import { Marked, type Token } from 'marked'
import { fullReference, smallReference } from '../../scripts/reference'
import { changelogFiles, releases, whatsNew } from './changelog'
import { highlight } from './highlight'
import { HEAD } from './site/theme'
import { themeSwitch } from './site/theme-switch'

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
  /** A stylesheet of its own in `site/`, for a page laid out unlike the others (the home page): no other page loads it. */
  css?: string
  /** `false`: no map of its sections (a landing, not a document). */
  toc?: false
}

export const PAGES: readonly Page[] = [
  { route: '', file: 'index.md', nav: 'Home', group: 'Start', css: 'home.css', toc: false },
  { route: 'getting-started', file: 'getting-started.md', nav: 'Getting started', group: 'Start' },
  { route: 'concepts', file: 'concepts.md', nav: 'Concepts', group: 'Start' },
  { route: 'whats-new', file: 'whats-new.md', nav: "What's new", group: 'Start' },
  { route: 'without-a-bundler', file: 'without-a-bundler.md', nav: 'Without a bundler', group: 'Start' },
  { route: 'language', file: 'language.md', nav: 'Overview', group: 'The language' },
  { route: 'language/controls', file: 'language-controls.md', nav: 'Controls and values', group: 'The language' },
  { route: 'language/formulas', file: 'language-formulas.md', nav: 'Formulas', group: 'The language' },
  { route: 'language/scenarios', file: 'language-scenarios.md', nav: 'Scenarios and stories', group: 'The language' },
  { route: 'language/how-sure', file: 'language-how-sure.md', nav: 'How sure', group: 'The language' },
  { route: 'language/published', file: 'language-published.md', nav: 'Published figures', group: 'The language' },
  { route: 'language/measured-data', file: 'language-measured-data.md', nav: 'Measured data', group: 'The language' },
  {
    route: 'language/building-blocks',
    file: 'language-building-blocks.md',
    nav: 'Building blocks',
    group: 'The language',
  },
  { route: 'language/view', file: 'language-view.md', nav: 'The view', group: 'The language' },
  { route: 'language/several-files', file: 'language-several-files.md', nav: 'Several files', group: 'The language' },
  { route: 'language/in-code', file: 'language-in-code.md', nav: 'In code', group: 'The language' },
  { route: 'language/errors', file: 'language-errors.md', nav: 'Errors and versions', group: 'The language' },
  { route: 'reference', file: 'reference.md', nav: 'Reference', group: 'The language' },
  { route: 'editor', file: 'editor.md', nav: 'Editor', group: 'The editor', frame: 'app' },
  { route: 'using-the-editor', file: 'using-the-editor.md', nav: 'Using the editor', group: 'The editor' },
  { route: 'assistant', file: 'assistant.md', nav: 'Asking a model', group: 'The editor' },
  { route: 'in-your-editor', file: 'in-your-editor.md', nav: 'In your editor', group: 'The editor' },
  { route: 'api', file: 'api.md', nav: 'API', group: 'Use it' },
  { route: 'api/model', file: 'api-model.md', nav: 'The model in TypeScript', group: 'Use it' },
  { route: 'api/react', file: 'api-react.md', nav: 'React and the page', group: 'Use it' },
  { route: 'api/styling', file: 'api-styling.md', nav: 'Styling', group: 'Use it' },
  { route: 'api/language', file: 'api-language.md', nav: 'The language in code', group: 'Use it' },
  { route: 'api/editor', file: 'api-editor.md', nav: 'The editor component', group: 'Use it' },
  { route: 'api/more', file: 'api-more.md', nav: 'Media, simulation and layout', group: 'Use it' },
  { route: 'checks', file: 'checks.md', nav: 'Checks in CI', group: 'Use it' },
  { route: 'recording', file: 'recording.md', nav: 'The command line', group: 'Use it' },
  { route: 'live-data', file: 'live-data.md', nav: 'Live data', group: 'Use it' },
  { route: 'embedding', file: 'embedding.md', nav: 'Embedding', group: 'Use it' },
  { route: 'for-agents', file: 'for-agents.md', nav: 'For agents', group: 'Use it' },
  { route: 'examples', file: 'examples.md', nav: 'All examples', group: 'Examples' },
  { route: 'examples/checkout', file: 'checkout.md', nav: 'Checkout', group: 'Examples' },
  { route: 'examples/alerts', file: 'alerts.md', nav: 'Alerts', group: 'Examples' },
  { route: 'examples/search', file: 'search.md', nav: 'Search', group: 'Examples' },
  { route: 'examples/regions', file: 'regions.md', nav: 'Two regions', group: 'Examples' },
]

/**
 * Pages that moved, by their old route: each a page that sends the reader on to where it went, in no list. The site
 * is public, so links to the old place may be out there.
 */
export const MOVED: Readonly<Record<string, string>> = { templates: 'examples/#starters' }

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
 * The version of the packages the site documents: they are versioned together, and the site deploys from the release
 * that published them (release.yml), so it is the latest on npm.
 */
export const packagesVersion = (): string =>
  JSON.parse(readFileSync(join(repo, 'packages/react/package.json'), 'utf8')).version

/**
 * `@include(path, "from", "to")` on a line of its own: the lines of a repository file from the first that starts with
 * `from` up to (not including) the first after it that starts with `to`. Without `to`, to the end. `@changelog` on a
 * line of its own: every release, from the packages' changelogs. `%VERSION%`: the packages' version; `%LANGUAGE%`: the
 * language's.
 */
export function expand(md: string): string {
  // %VERSION% is the version of the packages, for a page that names one (a CDN link), included text too
  const version = packagesVersion()
  return (
    md
      .replace(/^@include\(([^,)]+)(?:,\s*"([^"]*)")?(?:,\s*"([^"]*)")?\)$/gm, (_, path, from, to) => {
        const lines = readFileSync(join(repo, path.trim()), 'utf8').split('\n')
        const start = from ? lines.findIndex((l) => l.startsWith(from)) : 0
        if (start < 0) throw new Error(`docs: no line starting with "${from}" in ${path}`)
        const after = to ? lines.slice(start + 1).findIndex((l) => l.startsWith(to)) : -1
        if (to && after < 0) throw new Error(`docs: no line starting with "${to}" after "${from}" in ${path}`)
        return lines.slice(start, after < 0 ? undefined : start + 1 + after).join('\n')
      })
      .replace(SECTION, (_, path, heading, depth) => section(path.trim(), heading, depth ? Number(depth) : 2))
      .replaceAll('%VERSION%', version)
      .replaceAll('%LANGUAGE%', LANGUAGE_VERSION)
      // last: a release's text is shown as written, never read for an @include or a %VERSION%
      .replace(/^@changelog$/m, () => whatsNew(releases(join(repo, 'packages'))))
  )
}

/** A fence opens or closes on this line: three backticks or tildes, indented in a list or not. */
const FENCE = /^\s*(```|~~~)/

/** A Markdown heading's level, outside a fence: 0 when the line is none. */
const levelOf = (line: string) => /^(#{1,6}) /.exec(line)?.[1]?.length ?? 0

/**
 * `@section(path, "### Formulas")` on a line of its own: the section that heading starts in a repository file, up to
 * the next heading of its level or above, without the heading itself (the page says it): its own headings move up so
 * the first under it is an h2, or an h3 with `@section(path, "### Formulas", 3)` for a page that puts it under an h2
 * of its own. A `#` in a fence (a YAML comment) is no heading. The guide stays one file (it ships as the dsl package's
 * REFERENCE.md and in llms-full.txt) and the site shows it a section or two a page.
 */
export function section(path: string, heading: string, depth = 2): string {
  const lines = readFileSync(join(repo, path), 'utf8').split('\n')
  const level = levelOf(heading)
  if (!level) throw new Error(`docs: "${heading}" is not a heading`)
  const out: string[] = []
  let fence = false
  let inside = false
  for (const line of lines) {
    const at = fence ? 0 : levelOf(line)
    if (FENCE.test(line)) fence = !fence
    if (!inside) {
      inside = at === level && line === heading
      continue
    }
    if (at && at <= level) break
    out.push(at ? `${'#'.repeat(at - level + depth - 1)}${line.slice(at)}` : line)
  }
  if (!inside) throw new Error(`docs: no heading "${heading}" in ${path}`)
  return out.join('\n').trim()
}

/** The repository files the pages include, for the dev server to watch. */
export function included(): string[] {
  const files = new Set<string>()
  for (const p of PAGES) {
    const md = readFileSync(join(here, 'pages', p.file), 'utf8')
    for (const [, path] of md.matchAll(/^@(?:include|section)\(([^,)]+)/gm)) files.add(join(repo, path!.trim()))
    if (/^@changelog$/m.test(md)) for (const { file } of changelogFiles(join(repo, 'packages'))) files.add(file)
  }
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
 * A heading's id from its inline HTML, one page at a time: its text's slug, and "-2" on a second heading with the same
 * text, so each entry of the contents finds its own. `render` and `idsOf` both count with it.
 */
function headingIds(): (html: string) => string {
  const seen = new Map<string, number>()
  return (html) => {
    const base = slug(html)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n > 1 ? `${base}-${n}` : base
  }
}

/** The ids a page's h2 to h6 get, as `render` gives them, without rendering it. */
function idsOf(md: string): string[] {
  const id = headingIds()
  const inline = new Marked()
  return new Marked()
    .lexer(md)
    .flatMap((t) => (t.type === 'heading' && t.depth > 1 ? [id(inline.parseInline(t.text) as string)] : []))
}

const SECTION = /^@section\(([^,)]+),\s*"([^"]+)"(?:,\s*([2-6]))?\)$/gm

let anchorsOnce: Map<string, string> | undefined

/** The pages as the last `writePages` rendered them: the search's index reads them rather than render them again. */
let renderedOnce: Map<Page, ReturnType<typeof render>> | undefined

/** The pages the language guide is shown on: its links and its old anchors look there first. */
const isGuide = (p: Page) => p.route === 'language' || p.route.startsWith('language/') || p.route === 'checks'

/**
 * Where each section of the site is, by its id: `/route/#id` for a page's heading, and `/route/` for a heading a page
 * takes the section of (`@section`) and says in words of its own. The guide's pages first, then the others in their
 * order: the first page that has an id keeps it.
 */
export function anchors(): ReadonlyMap<string, string> {
  if (anchorsOnce) return anchorsOnce
  const map = new Map<string, string>()
  for (const p of [...DOCS.filter(isGuide), ...DOCS.filter((p) => !isGuide(p))]) {
    const raw = readFileSync(join(here, 'pages', p.file), 'utf8')
    const at = `/${p.route ? `${p.route}/` : ''}`
    for (const id of idsOf(expand(raw))) if (!map.has(id)) map.set(id, `${at}#${id}`)
    for (const [, , heading] of raw.matchAll(SECTION)) {
      const id = slug(heading!.replace(/^#+ /, ''))
      if (!map.has(id)) map.set(id, at)
    }
  }
  anchorsOnce = map
  return map
}

/**
 * The sections a page held before it was split, by the page's route: each old id to the id it has now (found through
 * `anchors()`), or to where it went (`/route/#id`). Links to them are out there. Frozen: a section renamed later keeps
 * its old id here, and the test that every one leads somewhere says so.
 */
export const OLD_ANCHORS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // the language guide, one page until it was a page a section
  language: Object.fromEntries(
    [
      'how-it-reads',
      'boxes-stages-and-components',
      'formulas',
      'scenarios-and-growth',
      'how-sure-and-what-must-hold',
      'published-figures',
      'measured-data',
      'building-blocks',
      'a-story',
      'direction-and-tiers',
      'the-view-block',
      'full-screen',
      'what-stays-code',
      'layout',
      'several-files',
      'errors',
      'versions',
      'in-code',
    ].map((id) => [id, ({ layout: 'formatting' } as Record<string, string>)[id] ?? id]),
  ),
  // the home page, a landing since: what it was for is what it does now
  '': { 'what-it-is-for': '/#what-it-does' },
  // the API, one page until it was a page a package
  api: {
    'the-model-loadmap-core': '/api/model/',
    'the-view-loadmap-layout-re-exported-by-react': '/api/model/#the-view',
    'the-page-loadmap-react': '/api/react/',
    'the-language-loadmap-dsl': '/api/language/',
    'the-editor-loadmap-editor': '/api/editor/',
    'media-loadmap-export': '/api/more/#media-loadmap-export',
    'measured-data-loadmap-providers': '/api/more/#measured-data-loadmap-providers',
    'the-catalog-loadmap-core-catalog': '/api/more/#the-catalog-loadmap-core-catalog',
    'the-simulation-loadmap-sim': '/api/more/#the-simulation-loadmap-sim',
    'the-command-line-loadmap-cli': '/api/more/#the-command-line-loadmap-cli',
  },
}

/** Each section a page held before it was split, to where it is now, but those it still holds. */
export function movedAnchors(route: string): Record<string, string> {
  const where = anchors()
  const here = route ? `/${route}/` : '/'
  const moved: Record<string, string> = {}
  for (const [old, now] of Object.entries(OLD_ANCHORS[route] ?? {})) {
    const to = now.startsWith('/') ? now : where.get(now)
    // a section still here under its old id stays
    if (to && to !== `${here}#${old}`) moved[old] = to
  }
  return moved
}

/**
 * A page's HTML: its Markdown with islands, heading anchors, and site links made relative to where it is served; and
 * its h2 and h3 headings, for the contents. Marks EYEBROW before the title and CONTENTS after the introduction (the
 * paragraph right after the title, if there is one).
 */
export function render(page: Page): { title: string; html: string; headings: Heading[] } {
  const md = expand(readFileSync(join(here, 'pages', page.file), 'utf8'))
  // a link to a section of the guide that another page holds now goes there
  const own = new Set(idsOf(md))
  const title = /^# (.+)$/m.exec(md)?.[1]?.replace(/`/g, '') ?? page.nav
  const up = relative(page.route)
  const headings: Heading[] = []
  const idOf = headingIds()
  const marked = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens)
        if (depth === 1) return `<h1>${text}</h1>\n`
        const id = idOf(text)
        if (depth === 2 || depth === 3) headings.push({ depth, id, html: text.replace(/<\/?a\b[^>]*>/g, '') })
        return `<h${depth} id="${id}">${text}</h${depth}>\n`
      },
      code({ text, lang }) {
        const live = lang === 'loadmap live'
        const snip = snippet(text, live ? 'loadmap' : (lang ?? ''), page.file)
        return live
          ? `<div class="island" data-island="loadmap" data-editor="${up}editor/">${snip}</div>\n`
          : `${snip}\n`
      },
      link({ href: written, title, tokens }) {
        const elsewhere = written.startsWith('#') && !own.has(written.slice(1)) && anchors().get(written.slice(1))
        const href = elsewhere || written
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

/**
 * A fence: its text coloured, and the button that copies it (hidden until the page's script can make it work). The
 * client puts a read-only CodeMirror view in the `<pre>`'s place; the `<pre>` stays, hidden, as the text's one source.
 */
function snippet(text: string, lang: string, file: string): string {
  // without the newlines it ends with: a <pre> draws none of them, the view a line for each, and the page would jump
  const { html, label } = highlight(text.replace(/\n+$/, ''), lang, file)
  const pre = `<pre class="code" data-lang="${esc(lang)}" data-label="${esc(label)}"><code>${html}</code></pre>`
  return `<div class="snippet">${pre}<button type="button" class="copy" hidden>Copy</button></div>`
}

/** From a page's route back to the site's root: "" at the root, "../../" two levels down. */
export const relative = (route: string) => (route ? '../'.repeat(route.split('/').length) : './')

const href = (up: string, p: Page) => `${up}${p.route ? `${p.route}/` : ''}`

/**
 * The pages grouped as the sidebar and the phone's menu list them, the current one marked; an app is marked ⤢. Each
 * group folds: the current page's is open (Start on a page in no group), the others a click away.
 */
function pageList(page: Page, up: string): string {
  const listed = PAGES.filter((p) => !p.hidden)
  const groups = [...new Set(listed.map((p) => p.group ?? ''))]
  const here = listed.includes(page) ? (page.group ?? '') : groups[0]
  return groups
    .map((group) => {
      const items = listed
        .filter((p) => (p.group ?? '') === group)
        .map((p) => {
          const current = p === page ? ' aria-current="page"' : ''
          const app = p.frame === 'app' ? ' <span class="app-mark" aria-hidden="true">⤢</span>' : ''
          return `<li><a href="${href(up, p)}"${current}>${esc(p.nav)}${app}</a></li>`
        })
        .join('')
      if (!group) return `<ul>${items}</ul>`
      return `<details class="nav-fold"${group === here ? ' open' : ''}><summary class="nav-group">${esc(group)}</summary><ul>${items}</ul></details>`
    })
    .join('')
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
  const toc = page.toc === false ? undefined : contents(headings)
  const out = `<a href="https://www.npmjs.com/package/@loadmap/react" rel="noopener">npm</a>
        <a href="https://github.com/jaim3r0jas/loadmap" rel="noopener">GitHub</a>`
  const eyebrow = page.route && page.group ? `<p class="eyebrow">${esc(page.group)}</p>` : ''
  const text = body.replace(EYEBROW, () => eyebrow).replace(CONTENTS, () => toc?.folded ?? '')
  const head = page.route ? `${title} · loadmap` : 'loadmap: interactive capacity models'
  const version = packagesVersion()
  const documents = `loadmap ${version}, language ${LANGUAGE_VERSION}`
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(head)}</title>
    <meta name="description" content="loadmap draws a system's architecture with its load flowing through it, ranks the parts by when they run out, and writes the verdict." />
    ${HEAD}
    <link rel="stylesheet" href="/docs.css" />${page.css ? `\n    <link rel="stylesheet" href="/${page.css}" />` : ''}
  </head>
  <body>
    <header class="top">
      <div class="bar">
        <a class="brand" href="${up}">loadmap</a>
        <a class="version" href="${up}whats-new/" title="This site documents ${documents}: what's new">v${version}</a>
        <span class="grow"></span>
        <button type="button" class="search-open" hidden aria-label="Search the docs" aria-keyshortcuts="/ Control+K Meta+K"><span aria-hidden="true">⌕</span><span class="label"> Search</span> <kbd>/</kbd></button>
        <span class="out">${out}</span>
        ${themeSwitch('theme-bar')}
        <details class="menu">
          <summary><span aria-hidden="true">☰</span> ${esc(page.nav || 'Pages')}</summary>
          <nav class="panel" aria-label="Pages">${themeSwitch('theme-menu')}${list}<p class="out">${out}</p></nav>
        </details>
      </div>
    </header>
    <div class="frame${toc ? ' has-toc' : ''}">
      <nav class="side" aria-label="Pages">${list}</nav>
      <main>
${text}
${pager(page, up)}${page.route in OLD_ANCHORS ? movedScript(page.route, up) : ''}
        <footer class="documents">This site documents ${documents}. <a href="${up}whats-new/">What's new</a></footer>
      </main>
      ${toc?.aside ?? ''}
    </div>
    <script type="module" src="/client.tsx"></script>
  </body>
</html>
`
}

/**
 * On a page that was split (the guide's first page, the API's): a link to a section it held before goes on to where
 * that section is now. A section still here, or an id it never had, stays.
 */
function movedScript(route: string, up: string): string {
  const to = Object.fromEntries(Object.entries(movedAnchors(route)).map(([id, at]) => [id, up + at.slice(1)]))
  const map = JSON.stringify(to).replace(/</g, '\\u003c')
  return `<script>(function(){var m=${map};var h;try{h=decodeURIComponent(location.hash.slice(1))}catch(e){return}if(h&&!document.getElementById(h)&&m[h])location.replace(m[h])})()</script>`
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
    ${HEAD}
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
  // the pages may have changed since the last write (the dev server writes them again on a change)
  anchorsOnce = undefined
  renderedOnce = new Map()
  const files: string[] = []
  for (const page of PAGES) {
    const rendered = render(page)
    renderedOnce.set(page, rendered)
    const { title, html, headings } = rendered
    const file = join(SITE, page.route, 'index.html')
    mkdirSync(dirname(file), { recursive: true })
    update(file, page.frame === 'app' ? appShell(page, title, html) : shell(page, title, html, headings))
    files.push(file)
  }
  for (const [route, to] of Object.entries(MOVED)) {
    const file = join(SITE, route, 'index.html')
    mkdirSync(dirname(file), { recursive: true })
    update(file, movedHtml(relative(route) + to))
    files.push(file)
  }
  const embed = join(SITE, EMBED, 'index.html')
  mkdirSync(dirname(embed), { recursive: true })
  update(embed, EMBED_HTML)
  files.push(embed)
  const signedIn = join(SITE, SIGNED_IN, 'index.html')
  mkdirSync(dirname(signedIn), { recursive: true })
  update(signedIn, SIGNED_IN_HTML)
  files.push(signedIn)
  const missing = join(SITE, '404.html')
  const notFound = { route: '', file: '', nav: '' }
  const body = '<h1>Not found</h1>\n<p>No page here. Every page is in the list of pages.</p>'
  update(missing, shell(notFound, 'Not found', body).replace(/href="\.\//g, `href="${base}`))
  files.push(missing)
  return files
}

/** A moved page: on at once, a link for a browser that does not follow, and search engines told where it went. */
const movedHtml = (to: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex" />
    <meta http-equiv="refresh" content="0; url=${esc(to)}" />
    <title>Moved · loadmap</title>
  </head>
  <body>
    <p>This page moved: <a href="${esc(to)}">go on</a>.</p>
  </body>
</html>
`

/** Where GitHub sends the editor's sign-in popup back: not a page of the site, so in no list. */
export const SIGNED_IN = 'signed-in'

/** It hands GitHub's answer to the editor that opened it, and closes: nothing else loads. */
const SIGNED_IN_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <meta name="referrer" content="no-referrer" />
    <title>Signing in · loadmap</title>
    <style>
      body { margin: 0; padding: 32px 16px; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1d2330; background: #f6f7f9; text-align: center; }
      @media (prefers-color-scheme: dark) { body { color: #e6e9ee; background: #14171c; } }
    </style>
  </head>
  <body>
    <p id="said">Signing in…</p>
    <script type="module" src="/signed-in.ts"></script>
  </body>
</html>
`

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
      /* the title gives way in a narrow frame, never Open ↗ beside it */
      .lm-canvas-bar > h2 { display: flex; align-items: baseline; }
      .embed-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .embed-open { flex: none; }
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

/** A section of the site, for search: where it is, its page, its heading and its text. Short keys: it is fetched whole. */
export interface Found {
  /** Its route and its heading's id, from the site's root: `language/formulas/#units`. */
  u: string
  /** The page's title. */
  p: string
  /** The section's heading; the page's title for the text before the first. */
  h: string
  /** Its text, tags taken out. */
  t: string
}

/**
 * The text of a piece of the build's own HTML, for the index: what is between its tags, a snippet's Copy button left
 * out, the entities the build writes read. Not a sanitizer: the index is data, and the search escapes what it shows.
 */
function textOfHtml(html: string): string {
  let text = ''
  let at = 0
  while (at < html.length) {
    const open = html.indexOf('<', at)
    if (open < 0) {
      text += html.slice(at)
      break
    }
    text += `${html.slice(at, open)} `
    // a button's label is no text of the page: skip to its end tag
    const button = html.startsWith('<button', open)
    const end = button ? html.indexOf('</button>', open) : html.indexOf('>', open)
    if (end < 0) break
    at = button ? html.indexOf('>', end) + 1 : end + 1
  }
  const entities: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' }
  return text
    .replace(/&(?:lt|gt|quot|#39|amp);/g, (e) => entities[e]!)
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * search.json: every page of the site cut at its h2 and h3 headings, each piece with its text. The search loads it the
 * first time it opens, never in a page's first load.
 */
export function searchIndex(): Found[] {
  const out: Found[] = []
  for (const page of DOCS) {
    const { html } = renderedOnce?.get(page) ?? render(page)
    const at = page.route ? `${page.route}/` : ''
    // the title as the page shows it, its Markdown read
    const title = /<h1>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? page.nav
    // the pieces between the headings; the first is the text under the title
    const parts = html.split(/(?=<h[23] id=")/)
    for (const part of parts) {
      const heading = /^<h([23]) id="([^"]+)">([\s\S]*?)<\/h\1>/.exec(part)
      const body = heading ? part.slice(heading[0].length) : part.replace(/^[\s\S]*?<\/h1>/, '')
      const t = textOfHtml(body)
      if (!heading && !t) continue
      out.push({
        u: heading ? `${at}#${heading[2]}` : at,
        // the home page's h1 is its tagline: it is the home page
        p: page.route ? textOfHtml(title) : page.nav,
        h: heading ? textOfHtml(heading[3]!) : page.route ? textOfHtml(title) : page.nav,
        t,
      })
    }
  }
  return out
}

const PUBLISHED = 'https://jaim3r0jas.github.io/loadmap/'

/**
 * For a language model: llms.txt, the site's pages by group, and llms-full.txt, the language guide and the whole
 * reference in one file with a model that uses every statement. Links are absolute, to the published site: the file
 * is often read away from where it was served.
 */
export function llms(): Record<'llms.txt' | 'llms-full.txt' | 'llms-small.txt', string> {
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
    `These pages document loadmap ${packagesVersion()} and language ${LANGUAGE_VERSION}.`,
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
    `- [llms-small.txt](${PUBLISHED}llms-small.txt): the statement reference and one complete model, for a model with a small window`,
    '',
  ].join('\n')
  const full = fullReference()
  return { 'llms.txt': map, 'llms-full.txt': full, 'llms-small.txt': smallReference() }
}

/** Writes a file only when its text changes: the dev server reloads the page on every write it sees. */
function update(file: string, text: string) {
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return
  writeFileSync(file, text)
}
