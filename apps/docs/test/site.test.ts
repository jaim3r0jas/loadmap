import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { encodeShare } from '@loadmap/dsl'
import { TEMPLATES } from '@loadmap/editor/templates'
import { type Browser, chromium, type Frame, type Page } from 'playwright'
import { build, type PreviewServer, preview } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shippedReference } from '../../../scripts/reference'
import { FENCES, highlight } from '../highlight'
import { included, MOVED, PAGES, relative, render } from '../pages'
import { fakeGitHub } from './fake-github'

const config = join(import.meta.dirname, '../vite.config.ts')
const routeOf = (href: string, from: string) => new URL(href, `http://x/${from ? `${from}/` : ''}`).pathname
const routes = new Set(PAGES.map((p) => `/${p.route ? `${p.route}/` : ''}`))
/** The pages in the site's frame; the others (the editor) fill the window. */
const DOCS = PAGES.filter((p) => !p.frame)

/** Every link of a page leads to a page of the site, or to a heading on the same page. */
function expectLinks(html: string, route: string, label: string) {
  // data-editor: where an island's Edit link leads
  for (const [, href] of html.matchAll(/(?:href|data-editor)="([^"]+)"/g)) {
    // vscode: opens the extension's page in a desktop VS Code
    if (/^(https?:|mailto:|vscode:|\/assets\/)/.test(href!)) continue
    if (href!.startsWith('#')) expect(html, `${label} links to ${href}`).toContain(`id="${href!.slice(1)}"`)
    else {
      const path = routeOf(href!, route).replace(/#.*$/, '')
      expect(routes.has(path), `${label} links to ${href} (${path})`).toBe(true)
    }
  }
}

/** Chromium's calls to GitHub, answered by a fake: nothing reaches the real one. */
async function routeGitHub(page: Page, fetch: ReturnType<typeof fakeGitHub>['fetch']) {
  await page.route(/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, async (route) => {
    const req = route.request()
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-GitHub-Api-Version, Accept',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH',
    }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const res = await fetch(req.url(), {
      method: req.method(),
      headers: req.headers(),
      body: req.postData() ?? undefined,
    })
    await route.fulfill({
      status: res.status,
      headers: { ...Object.fromEntries(res.headers), ...cors },
      body: await res.text(),
    })
  })
}

/** The text a piece of the build's own HTML shows: what is between its tags, the three entities the build writes read. */
const textOf = (html: string) =>
  html
    .split(/<[^>]*>/)
    .join('')
    .split('&lt;')
    .join('<')
    .split('&gt;')
    .join('>')
    .split('&amp;')
    .join('&')

describe('the pages', () => {
  const rendered = PAGES.map((p) => ({ page: p, ...render(p) }))

  it('each have a title and every include resolved', () => {
    for (const { page, title, html } of rendered) {
      expect(title, page.file).not.toBe(page.nav === 'Home' ? '' : undefined)
      expect(html, page.file).toContain('<h1>')
      expect(html, page.file).not.toContain('@include')
    }
  })

  it('link only to pages that exist', () => {
    for (const { page, html } of rendered) expectLinks(html, page.route, page.file)
  })

  it('carry the language guide and the whole reference from docs/dsl.md', () => {
    const html = (route: string) => rendered.find((r) => r.page.route === route)!.html
    expect(html('language')).toContain('id="boxes-stages-and-components"')
    expect(html('language')).not.toContain('id="the-top-level"')
    // the setup for editors has a page of its own, from the same lines
    expect(html('language')).not.toContain('vim.lsp.config')
    expect(html('in-your-editor')).toContain('vim.lsp.config')
    expect(html('in-your-editor')).toContain('href="vscode:extension/jaim3r0jas.loadmap"')
    for (const statement of ['flow', 'node', 'scenario', 'expect', 'step', 'fanout'])
      expect(html('reference')).toContain(`<h3 id="${statement}">${statement}</h3>`)
  })

  it('draw the quick start exactly as the react README writes it', () => {
    const readme = readFileSync(join(import.meta.dirname, '../../../packages/react/README.md'), 'utf8')
    const code = /```tsx\n([\s\S]*?)```/.exec(readme)![1]!
    const island = readFileSync(join(import.meta.dirname, '../site/islands/quickstart-app.tsx'), 'utf8')
    expect(island.slice(island.indexOf('\n') + 1)).toBe(code)
    expect(rendered.find((r) => r.page.route === 'getting-started')!.html).toContain('defineView(shop, {')
  })

  it("name the packages' version where a page links a CDN", () => {
    const version = JSON.parse(
      readFileSync(join(import.meta.dirname, '../../../packages/react/package.json'), 'utf8'),
    ).version
    const html = rendered.find((r) => r.page.route === 'without-a-bundler')!.html
    expect(html).toContain(`@loadmap/react@${version}`)
    expect(rendered.filter((r) => r.html.includes('%VERSION%')).map((r) => r.page.route)).toEqual([])
  })

  it('tell the dev server which repository files they include', () => {
    const files = included().map((f) => f.slice(f.lastIndexOf('/', f.lastIndexOf('/') - 1) + 1))
    // and the package.json %VERSION% comes from
    expect(files.sort()).toEqual([
      'alerts/alerts.loadmap',
      'checkout/checkout.loadmap',
      'docs/dsl.md',
      'react/README.md',
      'react/package.json',
      'regions/region.loadmap',
      'regions/regions.loadmap',
      'search/search.loadmap',
      'shop-live/live.tsx',
      'shop-live/shop.loadmap',
    ])
  })

  it("show checkout's promises as its text writes them", () => {
    const html = rendered.find((r) => r.page.route === 'examples/checkout')!.html
    // without the spans that colour it
    expect(textOf(html)).toContain('expect "Today keeps 7×" { underTarget: 7 }\nexpect "Proposed keeps 14×"')
  })

  it('colour every fence at build time, each in a language it names, its text unchanged', () => {
    const loadmap =
      'node db "Database" {\n  store # the <primary> & its replicas\n  capacity: estimated(3_000, "queries/s")\n}'
    const out = highlight(loadmap, 'loadmap', 'x.md')
    expect(textOf(out.html)).toBe(loadmap)
    expect(out.label).toBe('loadmap')
    for (const [cls, token] of [
      ['tok-keyword', 'node'],
      ['tok-def', 'db'],
      ['tok-string', '"Database"'],
      ['tok-comment', '# the &lt;primary&gt; &amp; its replicas'],
      ['tok-property', 'capacity'],
      ['tok-accent', 'estimated'],
      ['tok-number', '3_000'],
    ])
      expect(out.html).toContain(`<span class="${cls}">${token}</span>`)
    const sample = 'const a = { "b": [1, true], c: "<d>" } // e\n'
    for (const lang of FENCES) {
      const { html } = highlight(sample, lang, 'x.md')
      expect(textOf(html), lang).toBe(sample)
      // every language but plain text finds something to colour
      expect(html.includes('<span class="tok-'), lang).toBe(lang !== 'text')
    }
    expect(() => highlight('x', '', 'x.md')).toThrow('x.md has a fence with no language')
    expect(() => highlight('x', 'rust', 'x.md')).toThrow('a fence in "rust"')
    let fences = 0
    for (const p of PAGES) {
      const { html } = render(p)
      const pres = [...html.matchAll(/<pre class="code"([^>]*)>/g)]
      fences += pres.length
      for (const [, attrs] of pres) expect(attrs, p.file).toMatch(/ data-lang="\w+" data-label="[\w ]+"$/)
      // each with the button that copies it, hidden until the page's script makes it work
      expect(html.match(/<button type="button" class="copy" hidden>/g)?.length ?? 0, p.file).toBe(pres.length)
    }
    expect(fences).toBeGreaterThan(80)
  })

  it('find the site root from any depth', () => {
    expect([relative(''), relative('api'), relative('examples/checkout')]).toEqual(['./', '../', '../../'])
  })
})

describe('the built site', () => {
  let out: string
  let server: PreviewServer
  let url: string

  beforeAll(async () => {
    out = await mkdtemp(join(tmpdir(), 'loadmap-docs-'))
    // the runner: the config reads the editor's highlighter, a workspace package in TypeScript (apps/docs/CLAUDE.md)
    await build({
      configFile: config,
      configLoader: 'runner',
      logLevel: 'error',
      build: { outDir: out, emptyOutDir: true },
    })
    // GitHub Pages answers any origin (Access-Control-Allow-Origin: *): a sandboxed frame loads the scripts there too
    server = await preview({
      configFile: config,
      configLoader: 'runner',
      logLevel: 'error',
      build: { outDir: out },
      preview: { port: 0, cors: true },
    })
    url = server.resolvedUrls!.local[0]!
  }, 120_000)
  afterAll(async () => {
    await server?.close()
    if (out) await rm(out, { recursive: true })
  })

  it('is static HTML: a page per route with its text, and a 404', () => {
    for (const p of PAGES) {
      const file = join(out, p.route, 'index.html')
      expect(existsSync(file), p.route).toBe(true)
      expect(readFileSync(file, 'utf8')).toContain(render(p).title.replace(/&/g, '&amp;'))
    }
    expect(readFileSync(join(out, 'reference/index.html'), 'utf8')).toContain('Each unit is copied to several stages')
    expect(existsSync(join(out, '404.html'))).toBe(true)
  })

  it('sends a moved page on to where it went, from no list', () => {
    for (const [route, to] of Object.entries(MOVED)) {
      const html = readFileSync(join(out, route, 'index.html'), 'utf8')
      expect(html).toContain(`<meta http-equiv="refresh" content="0; url=${relative(route)}${to}" />`)
      const [page, hash] = to.split('#')
      expect(routes.has(`/${page}`), to).toBe(true)
      expect(readFileSync(join(out, page!, 'index.html'), 'utf8')).toContain(`id="${hash}"`)
      expect(readFileSync(join(out, 'llms.txt'), 'utf8')).not.toContain(`/${route}/`)
    }
  })

  it('has an llms.txt that links every page, and an llms-full.txt with the reference and the complete model', () => {
    const published = 'https://jaim3r0jas.github.io/loadmap/'
    const links = [...readFileSync(join(out, 'llms.txt'), 'utf8').matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]!)
    for (const p of DOCS) expect(links, p.route).toContain(`${published}${p.route ? `${p.route}/` : ''}`)
    for (const l of links) {
      expect(l.startsWith(published), l).toBe(true)
      const path = l.slice(published.length)
      expect(existsSync(join(out, path === '' || path.endsWith('/') ? `${path}index.html` : path)), l).toBe(true)
    }
    const full = readFileSync(join(out, 'llms-full.txt'), 'utf8')
    expect(full).toContain(shippedReference().trimEnd())
    expect(full).not.toContain('<!--')
    expect(full).toContain(
      readFileSync(join(import.meta.dirname, '../../../docs/every-statement.loadmap'), 'utf8').trimEnd(),
    )
  })

  it('marks the current page, and links the previous, the next and its sections only to what exists', () => {
    DOCS.forEach((p, i) => {
      const html = readFileSync(join(out, p.route, 'index.html'), 'utf8')
      const side = /<nav class="side"[^>]*>([\s\S]*?)<\/nav>/.exec(html)![1]!
      expect(
        [...side.matchAll(/aria-current="page">([^<]+)</g)].map((m) => m[1]),
        p.route,
      ).toEqual([p.nav])
      const pager = /<nav class="pager"[^>]*>([\s\S]*?)<\/nav>/.exec(html)![1]!
      expect(pager.includes('rel="prev"'), p.route).toBe(i > 0)
      expect(pager.includes('rel="next"'), p.route).toBe(i < DOCS.length - 1)
      expectLinks(html, p.route, p.route || 'home')
    })
    // an app page has none of the frame; the sidebar marks it as one
    const editor = readFileSync(join(out, 'editor/index.html'), 'utf8')
    for (const frame of ['class="top"', 'class="side"', 'class="pager"', 'class="toc'])
      expect(editor).not.toContain(frame)
    expect(editor).toContain('<body class="app" data-root="../">')
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain(
      'href="./editor/">Editor <span class="app-mark" aria-hidden="true">⤢</span>',
    )
    const reference = readFileSync(join(out, 'reference/index.html'), 'utf8')
    expect(reference).toContain('<aside class="toc"')
    expect(reference).toContain('<a href="#flow">flow</a>')
    expect(readFileSync(join(out, 'examples/checkout/index.html'), 'utf8')).not.toContain('class="toc')
    // folded under the introduction, before the first section
    const concepts = readFileSync(join(out, 'concepts/index.html'), 'utf8')
    const intro = concepts.indexOf('</p>', concepts.indexOf('</h1>'))
    expect(concepts.slice(intro, concepts.indexOf('<h2'))).toMatch(/^<\/p>\s*<details class="toc-folded">/)
    expect(concepts).toMatch(/<p class="eyebrow">Start<\/p>\s*<h1>/)
  })

  it('loads a few kB on a page of text: the islands come only where they are', () => {
    const html = readFileSync(join(out, 'recording/index.html'), 'utf8')
    const first = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]!)
    expect(first.length).toBeGreaterThan(0)
    const kb = first.reduce((s, f) => s + gzipSync(readFileSync(join(out, f))).length, 0) / 1024
    // with the light and dark switch, on every page (0.6 kB), and the snippets' copy button and colours (0.7 kB): an
    // island is tens, and CodeMirror (72 kB) comes only once a snippet is near the window. The client holds the names
    // of the chunks each island preloads, about 16 bytes each (the GitHub dialog's split `files.ts` out: 6.23 kB)
    expect(kb).toBeLessThan(6.25)
    expect(first.some((f) => /snippet|dist-/.test(f))).toBe(false)
  })

  it('draws the live parts in Chromium: examples, the quick start, a definition, the editor', async () => {
    const browser = await chromium.launch()
    try {
      for (const [route, nodes] of [
        ['', 6],
        ['examples/checkout/', 6],
        ['examples/alerts/', 10],
        ['examples/search/', 8],
        // both regions closed, each one box
        ['examples/regions/', 4],
        ['examples/', 4],
        ['getting-started/', 3],
        ['concepts/', 3 + 8],
        ['editor/', 6],
      ] as const) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
        const errors: string[] = []
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
        page.on('pageerror', (e) => errors.push(e.message))
        await page.goto(`${url}${route}`)
        await page.waitForFunction((n) => document.querySelectorAll('[data-node]').length >= n, nodes, {
          timeout: 30_000,
        })
        expect(await page.evaluate(() => document.querySelectorAll('[data-node]').length), route).toBe(nodes)
        if (/^examples\/./.test(route))
          expect(await page.evaluate(() => Boolean((globalThis as { __loadmap?: object }).__loadmap))).toBe(true)
        // every board of the docs pans and zooms, but the quick start's, which is the react README's code; the
        // landing board leaves its headroom chart to the example's page
        if (route !== 'editor/') {
          const zoom = page.locator('.island .lm-zoom')
          if (route === 'getting-started/') expect(await zoom.count(), route).toBe(0)
          else await zoom.first().waitFor({ timeout: 10_000 })
          const boards = await page.locator('.island .lm').count()
          expect(await page.locator('.island [data-panel="headroom"]').count(), route).toBe(route === '' ? 0 : boards)
        }
        expect(errors, route).toEqual([])
        await page.close()
      }
    } finally {
      await browser.close()
    }
  }, 120_000)

  it('runs the fan-out in concepts down by its shape, on a wide screen, and frames an embed on its page', async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      await page.goto(`${url}concepts/`)
      const fan = page.locator('.island .lm', { has: page.locator('[data-node="stock"]') })
      await fan.locator('[data-node="db"]').waitFor({ timeout: 30_000 })
      // each box's middle: a box is drawn at its own size in the middle of its slot
      const top = (id: string) =>
        fan.locator(`[data-node="${id}"]`).evaluate((n) => {
          const r = n.getBoundingClientRect()
          return Math.round(r.top + r.height / 2)
        })
      expect(await top('gateway')).toBeLessThan(await top('search'))
      expect(await top('search')).toBeLessThan(await top('db'))
      // the five services side by side, in one row
      expect(new Set(await Promise.all(['search', 'cart', 'orders', 'profile', 'stock'].map(top))).size).toBe(1)

      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(`${url}embedding/`)
      const frame = (await (await page.waitForSelector('.island iframe')).contentFrame())!
      await frame.waitForFunction(() => document.querySelectorAll('[data-node]').length === 6, null, {
        timeout: 30_000,
      })
      // the HTML shown is the frame's own link
      const src = await page.locator('.island iframe').getAttribute('src')
      expect(src).toMatch(/\/embed\/#v1\./)
      expect(await page.locator('.island details code').textContent()).toContain(`src="${src}"`)
      expect(errors).toEqual([])
    } finally {
      await browser.close()
    }
  }, 120_000)

  it('centers the page, keeps the text to a readable line and gives the diagrams the width', async () => {
    const browser = await chromium.launch()
    try {
      for (const width of [390, 1366, 1920]) {
        for (const route of ['', 'concepts/', 'reference/']) {
          const page = await browser.newPage({ viewport: { width, height: 900 } })
          await page.goto(`${url}${route}`)
          if (route !== 'reference/')
            await page.waitForFunction(() => document.querySelectorAll('[data-node]').length > 0, null, {
              timeout: 30_000,
            })
          const at = `${route || 'home'} at ${width}`
          const m = await page.evaluate(() => {
            const box = (s: string) => document.querySelector(s)?.getBoundingClientRect()
            const frame = box('.frame')!
            return {
              scroll: document.documentElement.scrollWidth,
              left: frame.left,
              right: innerWidth - frame.right,
              text: Math.max(...[...document.querySelectorAll('main > p')].map((p) => p.getBoundingClientRect().width)),
              island: box('main > .island')?.width ?? 0,
            }
          })
          expect(m.scroll, at).toBeLessThanOrEqual(width)
          expect(m.text, at).toBeLessThanOrEqual(760)
          if (width === 1920) expect(Math.abs(m.left - m.right), at).toBeLessThanOrEqual(1)
          if (width >= 1366 && m.island) expect(m.island, at).toBeGreaterThan(m.text + 50)
          await page.close()
        }
      }
    } finally {
      await browser.close()
    }
  }, 120_000)

  it('keeps the pages and the sections in view, and lists every page in the phone menu', async () => {
    const browser = await chromium.launch()
    try {
      const wide = await browser.newPage({ viewport: { width: 1366, height: 900 } })
      await wide.goto(`${url}reference/`)
      await wide.evaluate(() => document.getElementById('flow')!.scrollIntoView())
      await wide.waitForFunction(() => document.querySelector('.toc a[aria-current]')?.textContent === 'flow')
      await wide.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
      const side = await wide.evaluate(() => document.querySelector('.side')!.getBoundingClientRect().top)
      expect(side).toBeGreaterThanOrEqual(0)
      expect(side).toBeLessThan(100)
      // the last sections are too short to reach the top third: at the end of the page the last one is marked
      await wide.waitForFunction(() => document.querySelector('.toc li:last-child a')?.hasAttribute('aria-current'))
      expect(await wide.locator('.toc a[aria-current]').count()).toBe(1)

      expect(await wide.locator('.menu').isVisible()).toBe(false)

      const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
      await phone.goto(`${url}reference/`)
      expect(await phone.locator('.side').isVisible()).toBe(false)
      await phone.locator('.menu summary').click()
      const links = phone.locator('.menu .panel ul a')
      expect(await links.count()).toBe(PAGES.filter((p) => !p.hidden).length)
      for (const link of await links.all()) expect(await link.isVisible()).toBe(true)
      expect(await phone.locator('.menu [aria-current="page"]').textContent()).toBe('Reference')
    } finally {
      await browser.close()
    }
  }, 120_000)

  it('opens a shared link for readers: the diagram and the inspector, the text one click away', async () => {
    const source = readFileSync(join(import.meta.dirname, '../../../examples/checkout/checkout.loadmap'), 'utf8')
    const hash = await encodeShare(source, { load: 30 })
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      await page.goto(`${url}editor/#${hash}`)
      await page.waitForSelector('.lme-inspector')
      expect(await page.locator('.lme-left').isHidden()).toBe(true)
      // the old link opens the same model, at the values it carries
      expect(await page.locator('.lme-title').first().textContent()).toBe('Checkout pipeline')
      // the slider's input holds its place on the track; the load is what it says
      expect(await page.locator('.lm .lm-load input').first().getAttribute('aria-valuetext')).toMatch(/^30×/)
      await page.locator('.lme-preview [data-node="gateway"]').click()
      await page.waitForFunction(() => document.querySelector('.lme-inspector h3')?.textContent === 'API gateway')
      await page.getByRole('button', { name: 'Show code' }).click()
      expect(await page.locator('.lme-left').isVisible()).toBe(true)
      // without a link, the editor opens with the text
      const plain = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      await plain.goto(`${url}editor/`)
      await plain.waitForSelector('.lme-left')
      expect(await plain.locator('.lme-inspector').count()).toBe(0)
    } finally {
      await browser.close()
    }
  }, 120_000)

  describe('the embed page', () => {
    const checkout = readFileSync(join(import.meta.dirname, '../../../examples/checkout/checkout.loadmap'), 'utf8')
    let browser: Browser
    beforeAll(async () => {
      browser = await chromium.launch()
    })
    afterAll(() => browser?.close())

    /** A page of iframes of the embed page, as a doc frames it; each frame once it has drawn or said why not. */
    async function framed(frames: { query?: string; hash: string; w: number; h: number; sandbox?: string }[], o = {}) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 1600 }, ...o })
      const errors: string[] = []
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(url)
      await page.setContent(
        frames
          .map(
            (f, i) =>
              `<iframe id="f${i}" src="${url}embed/${f.query ?? ''}#${f.hash}" width="${f.w}" height="${f.h}"${f.sandbox ? ` sandbox="${f.sandbox}"` : ''} style="border: 0; display: block"></iframe>`,
          )
          .join(''),
      )
      const out: Frame[] = []
      for (const [i] of frames.entries()) {
        const frame = (await (await page.$(`#f${i}`))!.contentFrame())!
        await frame.waitForFunction(() => document.querySelector('[data-node], [role=alert]'), null, {
          timeout: 30_000,
        })
        out.push(frame)
      }
      return { page, frames: out, errors }
    }

    it('draws a shared link filling its frame, never scrolling, at any size and sandboxed', async () => {
      const hash = await encodeShare(checkout, { load: 25 })
      const sizes = [
        { w: 860, h: 440 },
        { w: 520, h: 320, sandbox: 'allow-scripts' },
        { w: 340, h: 230 },
      ]
      const { page, frames, errors } = await framed(sizes.map((s) => ({ ...s, hash })))
      for (const [i, frame] of frames.entries()) {
        await frame.waitForFunction(() => document.querySelectorAll('[data-node]').length === 6)
        const m = await frame.evaluate(() => {
          const root = document.querySelector<HTMLElement>('.lm')!
          const r = root.getBoundingClientRect()
          const b = root.querySelector('.lm-board')!.getBoundingClientRect()
          return {
            full: root.dataset.full,
            fills: [r.width, r.height],
            scrolls: [
              document.documentElement.scrollWidth - innerWidth,
              document.documentElement.scrollHeight - innerHeight,
              root.scrollHeight - root.clientHeight,
            ],
            board: b.width > 0 && b.height > 0 && b.right <= innerWidth + 0.5 && b.bottom <= innerHeight + 0.5,
            load: root.querySelector('.lm-headline b')?.textContent,
            fullScreen: [...root.querySelectorAll('button')].some((x) => x.textContent?.includes('Full screen')),
            open: root.querySelector('.embed-open')?.getAttribute('href') ?? null,
          }
        })
        const { w, h } = sizes[i]!
        expect(m, `${w}×${h}`).toMatchObject({
          full: 'fill',
          fills: [w, h],
          scrolls: [0, 0, 0],
          board: true,
          load: '25×',
          fullScreen: false,
        })
        // Open ↗ opens the same link in the editor; a short frame keeps only the diagram and a line of verdict
        if (h > 260) expect(m.open).toBe(`${url}editor/#${hash}`)
        else expect(m.open === null || !(await frame.locator('.embed-open').isVisible())).toBe(true)
      }
      // a block resized tall and narrow in the doc: the diagram runs top to bottom, still without scrolling the page
      await page.evaluate(() =>
        document.querySelector('#f0')!.setAttribute('style', 'border: 0; width: 360px; height: 720px'),
      )
      const board = () =>
        frames[0]!.evaluate(() => document.querySelector('.lm-board')!.getBoundingClientRect().toJSON())
      await expect.poll(async () => (await board()).height > (await board()).width, { timeout: 15_000 }).toBe(true)
      expect(await frames[0]!.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBe(0)
      expect(errors).toEqual([])
      await page.close()
    }, 120_000)

    it('takes its options from the query: the panels, the theme, the story played when in view', async () => {
      const hash = await encodeShare(checkout)
      const { page, frames, errors } = await framed([
        { query: '?mode=panels&panels=verdict,limits&theme=dark', hash, w: 900, h: 700 },
        { query: '?play=1', hash, w: 860, h: 440 },
        { query: '?mode=sideways&theme=purple', hash, w: 860, h: 440 },
      ])
      const [panels, play, unknown] = frames as [Frame, Frame, Frame]
      const root = (f: Frame) =>
        f.evaluate(() => {
          const el = document.querySelector<HTMLElement>('.lm')!
          return {
            theme: el.dataset.theme ?? null,
            mode: el.dataset.mode,
            minis: [...el.querySelectorAll<HTMLElement>('[data-mini]')].map((m) => m.dataset.mini),
          }
        })
      expect(await root(panels)).toEqual({ theme: 'dark', mode: 'panels', minis: ['limits'] })
      // a value it does not know is the default: the diagram first, the reader's theme
      expect(await root(unknown)).toMatchObject({ theme: null, mode: 'focus' })
      await play.waitForSelector('.lm-story[data-playing]', { timeout: 10_000 })
      expect(errors).toEqual([])
      await page.close()
      // never by itself with reduced motion
      const still = await framed([{ query: '?play=1', hash, w: 860, h: 440 }], { reducedMotion: 'reduce' })
      await still.frames[0]!.waitForFunction(() => document.querySelectorAll('[data-node]').length === 6)
      await still.page.waitForTimeout(1500)
      expect(await still.frames[0]!.locator('.lm-story[data-playing]').count()).toBe(0)
      await still.page.close()
    }, 120_000)

    it('refuses a bad link with a plain message and a way to the editor', async () => {
      const broken = await encodeShare('node a "A" {\n  brokr: 1\n}\n')
      const { page, frames, errors } = await framed([
        { hash: '', w: 420, h: 200 },
        { hash: 'v1.@@@@', w: 420, h: 200 },
        { hash: broken, w: 420, h: 200 },
      ])
      const said = await Promise.all(frames.map((f) => f.locator('[role=alert]').innerText()))
      expect(said[0]).toBe('This link holds no loadmap model.\nMake one in the editor')
      expect(said[1]).toBe('This link holds no loadmap model.\nThis link is cut or garbled.\nMake one in the editor')
      expect(said[2]).toMatch(/^This model doesn't compile\.\nembed\.loadmap:1:1 .+\nOpen it in the editor to fix it$/)
      expect(await frames[2]!.locator('[role=alert] a').getAttribute('href')).toBe(`${url}editor/#${broken}`)
      expect(errors).toEqual([])
      await page.close()
    }, 120_000)
  })

  it('keeps the draft aside when an example takes its place in the editor, its images in Export', async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      await page.goto(`${url}editor/`)
      const mine = readFileSync(join(import.meta.dirname, '../site/uploads.loadmap'), 'utf8').replace(
        'title: "Photo uploads"',
        'title: "My uploads"',
      )
      await page.evaluate((s) => localStorage.setItem('loadmap-editor-draft', s), mine)
      await page.reload()
      await page.waitForFunction(() => document.querySelector('.lme-title')?.textContent === 'My uploads')
      const example = async (name: string) => {
        await page.getByRole('button', { name: 'New', exact: true }).click()
        await page.getByRole('menuitem', { name, exact: true }).click()
      }
      await example('Checkout')
      await page.waitForFunction(() => document.querySelector('.lme-title')?.textContent === 'Checkout pipeline')
      expect(await page.evaluate(() => localStorage.getItem('loadmap-editor-draft-earlier'))).toBe(mine)
      await example('Your earlier draft')
      await page.waitForFunction(() => document.querySelector('.lme-title')?.textContent === 'My uploads')
      // the name in the bar follows the text
      expect(await page.locator('.lme-title').textContent()).toBe('My uploads')
      await page.getByRole('button', { name: 'Export', exact: true }).click()
      // each item's name, its line apart, once the menu has drawn them
      await page.getByRole('menuitem', { name: 'GIF' }).waitFor()
      const items = await page.getByRole('menu', { name: 'Export' }).locator('.lme-item > span').allTextContents()
      expect(items).toEqual(['Download .loadmap', 'PNG', 'Poster', 'GIF'])
    } finally {
      await browser.close()
    }
  }, 120_000)

  it('fills the window with the editor as a canvas, the whole diagram in view, and keeps how the reader left it', async () => {
    const browser = await chromium.launch()
    try {
      for (const [width, height] of [
        [1440, 900],
        [2560, 1440],
      ] as const) {
        const page = await browser.newPage({ viewport: { width, height } })
        await page.goto(`${url}editor/`)
        await page.waitForSelector('[data-node]')
        // fitted once the layout and the view are in: every box between the code's panel and the side panel
        await page.waitForFunction(() => {
          const code = document.querySelector('.lme-left')!.getBoundingClientRect()
          const panel = document.querySelector('.lme-panel')!.getBoundingClientRect()
          const boxes = [...document.querySelectorAll('.lme-preview [data-node]')].map((n) => n.getBoundingClientRect())
          return boxes.every((b) => b.left > code.right && b.right < panel.left && b.top > 0 && b.bottom < innerHeight)
        })
        const m = await page.evaluate(() => {
          const lme = document.querySelector('.lme')!.getBoundingClientRect()
          const text = document.querySelector('.lme-left')!.getBoundingClientRect()
          const canvas = document.querySelector('.lme-canvas')!.getBoundingClientRect()
          const panel = document.querySelector('.lme-panel')!.getBoundingClientRect()
          return {
            frame: document.querySelectorAll('.top, .side, .pager').length,
            scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
            lme: [lme.width, lme.height],
            // the code, the canvas and the panel side by side, the code from the window's left edge, as tall as all
            // the bar leaves
            beside:
              text.left === 0 &&
              Math.abs(canvas.left - text.right) < 1 &&
              Math.abs(panel.left - canvas.right) < 1 &&
              panel.right === innerWidth &&
              text.bottom === innerHeight,
            panel: document.querySelector<HTMLElement>('.lme-panel')!.dataset.mode,
          }
        })
        const at = `${width}x${height}`
        expect(m.frame, at).toBe(0)
        expect(m.scroll, at).toEqual([width, height])
        expect(m.lme, at).toEqual([width, height])
        expect(m.beside, at).toBe(true)
        expect(m.panel, at).toBe('pinned')
        await page.close()
      }
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      await page.goto(`${url}editor/`)
      const edge = page.getByRole('separator', { name: 'Resize the code' })
      expect(await edge.getAttribute('aria-valuenow')).toBe('440')
      await edge.focus()
      for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
      expect(await edge.getAttribute('aria-valuenow')).toBe('520')
      await page.reload()
      expect(await edge.getAttribute('aria-valuenow')).toBe('520')
      const wide = await page.evaluate(() => document.querySelector('.lme-left')!.getBoundingClientRect().width)
      expect(Math.abs(wide - 520)).toBeLessThan(2)
      // the panel's width stays so
      const side = page.getByRole('separator', { name: 'Resize the panel' })
      await side.focus()
      await page.keyboard.press('ArrowLeft')
      expect(await side.getAttribute('aria-valuenow')).toBe('356')
      await page.reload()
      expect(await side.getAttribute('aria-valuenow')).toBe('356')
      // the code and the panel folded stay so
      await page.getByRole('button', { name: 'Hide code' }).click()
      await page.getByRole('button', { name: 'Hide the panel' }).click()
      await page.reload()
      await page.waitForSelector('.lme-rail[data-side="start"]')
      expect(await page.locator('.lme-left').isHidden()).toBe(true)
      expect(await page.locator('.lme-rail[data-side="end"]').isVisible()).toBe(true)
      await page.getByRole('button', { name: 'Help' }).click()
      expect(await page.locator('#help').isVisible()).toBe(true)
      await page.keyboard.press('Escape')
      expect(await page.locator('#help').isHidden()).toBe(true)
    } finally {
      await browser.close()
    }
  }, 120_000)

  it('shows the walkthroughs and the starters on one page, each card with what its model shows', async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(`${url}examples/`)
      const checkout = page.locator('.island').getByRole('link', { name: /^Checkout/ })
      expect(await checkout.getAttribute('href')).toBe('../examples/checkout/')
      expect(await checkout.locator('.chips i').allTextContents()).toContain('tiers')
      expect(await checkout.textContent()).toContain('Grown from Queue and workers')
      // a starter picked: drawn below, its text to download, and the walkthrough grown from it
      await page.getByRole('button', { name: /^Queue and workers/ }).click()
      await page.waitForSelector('[data-node]')
      expect(await page.getByRole('link', { name: 'Grown up: Checkout →' }).getAttribute('href')).toBe(
        '../examples/checkout/',
      )
      const t = TEMPLATES.find((x) => x.id === 'queue-workers')!
      const download = page.getByRole('link', { name: 'queue-workers.loadmap ↓' })
      expect(decodeURIComponent((await download.getAttribute('href'))!.replace(/^data:[^,]*,/, ''))).toBe(t.source)
      expect(await page.getByRole('link', { name: /^Open in the editor/ }).getAttribute('href')).toBe(
        `../editor/?template=${t.id}`,
      )
      expect(errors).toEqual([])
    } finally {
      await browser.close()
    }
  }, 120_000)

  it('opens a template, and a link with the text when it asks for the code', async () => {
    const source = readFileSync(join(import.meta.dirname, '../../../examples/alerts/alerts.loadmap'), 'utf8')
    const hash = await encodeShare(source)
    const t = TEMPLATES.find((x) => x.id === 'queue-workers')!
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      await page.goto(`${url}editor/?template=${t.id}`)
      await page.waitForSelector('.lme-title')
      expect(await page.locator('.lme-title').textContent()).toBe(/title: "([^"]+)"/.exec(t.source)![1])
      expect(await page.locator('.lme-left').isVisible()).toBe(true)
      await page.goto(`${url}editor/?code#${hash}`)
      await page.waitForSelector('[data-node]')
      expect(await page.locator('.lme-left').isVisible()).toBe(true)
      expect(await page.locator('.lme-inspector').count()).toBe(0)
    } finally {
      await browser.close()
    }
  }, 120_000)

  it('opens a repository from GitHub: the model an address names, or one picked in New → Open from GitHub', async () => {
    const shop = (f: string) => readFileSync(join(import.meta.dirname, '../../../docs/multi-file', f), 'utf8')
    const fake = fakeGitHub({
      owner: 'acme',
      name: 'capacity',
      refs: {
        main: {
          'models/shop.loadmap': shop('shop.loadmap'),
          'models/shop.story.loadmap': shop('shop.story.loadmap'),
          'models/platform.loadmap': shop('platform.loadmap'),
          'uploads.loadmap': readFileSync(join(import.meta.dirname, '../site/uploads.loadmap'), 'utf8'),
        },
      },
    })
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      await routeGitHub(page, fake.fetch)
      await page.goto(`${url}editor/?repo=acme/capacity&path=models/shop.loadmap`)
      await page.waitForFunction(() => document.querySelector('.lme-title')?.textContent === 'A shop in several files')
      // the model's tab, named by its path from the repository's root (the tabs draw once the files are in)
      await page.locator('[role=tab][title="models/shop.loadmap"]').waitFor()
      // the files come from the commit the branch named when the page asked, by its sha
      const raws = fake.calls.filter((c) => c.url.startsWith('https://raw.githubusercontent.com/'))
      expect(raws.map((c) => c.url.split('/').slice(5).join('/')).sort()).toEqual([
        'models/platform.loadmap',
        'models/shop.loadmap',
        'models/shop.story.loadmap',
      ])

      await page.getByRole('button', { name: 'New', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Open from GitHub…' }).click()
      const dialog = page.getByRole('dialog', { name: 'Open from GitHub' })
      await dialog.getByLabel('Repository').fill('https://github.com/acme/capacity/tree/main')
      await dialog.getByRole('button', { name: 'Open', exact: true }).click()
      await dialog.getByRole('button', { name: /^uploads\.loadmap/ }).click()
      await page.waitForFunction(() => document.querySelector('.lme-title')?.textContent === 'Photo uploads')
      expect(await dialog.isVisible()).toBe(false)

      // a repository that is not there, in a sentence; the draft stays
      await page.goto(`${url}editor/?repo=acme/nothing`)
      await page.getByText('acme/nothing was not found, or it is private').waitFor()
      await page.waitForSelector('.lme-title')
    } finally {
      await browser.close()
    }
  }, 120_000)

  it('closes back to the page it was opened from, and to the docs home when opened cold', async () => {
    const hash = await encodeShare(readFileSync(join(import.meta.dirname, '../site/uploads.loadmap'), 'utf8'))
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      await page.goto(`${url}examples/`)
      await page.getByRole('link', { name: /^Open in the editor/ }).click()
      await page.waitForSelector('.lme-left')
      await page.getByRole('link', { name: 'Docs' }).click()
      await page.waitForURL(`${url}examples/`)
      // where the reader was: going back, not a new visit
      expect(await page.evaluate(() => history.length)).toBe(3)

      const cold = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      await cold.goto(`${url}editor/#${hash}`)
      const close = cold.getByRole('link', { name: 'Docs' })
      expect(await close.getAttribute('href')).toBe(url)
      await close.click()
      await cold.waitForURL(url)
      expect(await cold.locator('h1').first().isVisible()).toBe(true)
    } finally {
      await browser.close()
    }
  }, 120_000)

  it('opens the docs fences and examples in the editor, with the values set', async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      await page.goto(`${url}concepts/`)
      // the page has several fences, drawn and linked in any order: every one linked first, then a title and a link
      // from the same one
      await page.waitForFunction(() => {
        const fences = document.querySelectorAll('[data-island="loadmap"]')
        return [...fences].every((f) => f.querySelector('.edit a') && f.querySelector('.lm h2'))
      })
      const fence = page.locator('[data-island="loadmap"]').first()
      const title = await fence.locator('.lm h2').textContent()
      await fence.locator('.edit a').click()
      await page.waitForURL(/\/editor\/\?code#v1\./)
      await page.waitForSelector('[data-node]')
      expect(await page.locator('.lme-title').first().textContent()).toBe(title)
      expect(await page.locator('.lme-left').isVisible()).toBe(true)

      await page.goto(`${url}examples/checkout/`)
      await page.waitForSelector('[data-node]')
      // the text itself, to open in the reader's own editor
      const download = page.getByRole('link', { name: 'checkout.loadmap ↓' })
      expect(await download.getAttribute('download')).toBe('checkout.loadmap')
      const text = decodeURIComponent((await download.getAttribute('href'))!.replace(/^data:[^,]*,/, ''))
      expect(text).toBe(readFileSync(join(import.meta.dirname, '../../../examples/checkout/checkout.loadmap'), 'utf8'))
      await page
        .getByRole('button', { name: /^Black Friday/ })
        .first()
        .click()
      await page.getByRole('link', { name: 'Edit in the editor ⤢' }).click()
      await page.waitForURL(/\/editor\/\?code#v1\..*load=40.*pods=6/)
      await page.waitForSelector('[data-node]')
      expect(await page.locator('.lme-title').first().textContent()).toBe('Checkout pipeline')
      expect(await page.locator('.lme-left').isVisible()).toBe(true)
    } finally {
      await browser.close()
    }
  }, 120_000)

  it('fits a phone: the text or the diagram, a sheet of panels, a finger to pan and two to zoom', async () => {
    const browser = await chromium.launch()
    try {
      const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
      const page = await phone.newPage()
      await page.goto(`${url}editor/`)
      await page.waitForSelector('.lme-switch')
      expect(await page.locator('.lme-left').isVisible()).toBe(true)
      expect(await page.locator('.lme-preview').isHidden()).toBe(true)
      await page.getByRole('tab', { name: 'Diagram' }).tap()
      await page.waitForSelector('.lme-preview [data-node]')
      expect(await page.locator('.lme-left').isHidden()).toBe(true)
      // the whole diagram, between the bar and the sheet
      await page.waitForFunction(() => {
        const bar = document.querySelector('.lme-bar')!.getBoundingClientRect()
        const sheet = document.querySelector('.lme-sheet')?.getBoundingClientRect()
        const boxes = [...document.querySelectorAll('.lme-preview [data-node]')].map((n) => n.getBoundingClientRect())
        return (
          !!sheet && boxes.every((b) => b.left >= 0 && b.right <= 390 && b.top > bar.bottom && b.bottom < sheet.top)
        )
      })
      const m = await page.evaluate(() => ({
        scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        bar: document.querySelector('.lme-bar')!.getBoundingClientRect().height,
      }))
      expect(m.scroll).toEqual([390, 844])
      // one row of 44 px targets
      expect(m.bar).toBeLessThan(72)
      // a finger pans, two pinch: the touches a phone sends, on the board
      const viewBox = () => page.evaluate(() => document.querySelector('.lme-preview svg')!.getAttribute('viewBox'))
      const fitted = (await viewBox())!.split(' ').map(Number)
      await page.evaluate(() => {
        const board = document.querySelector('.lme-preview .lm-board')!
        const r = board.getBoundingClientRect()
        const [x, y] = [r.left + r.width / 2, r.top + r.height / 3]
        const touch = (type: string, id: number, cx: number, cy: number) =>
          board.dispatchEvent(
            new PointerEvent(type, { bubbles: true, pointerId: id, pointerType: 'touch', clientX: cx, clientY: cy }),
          )
        touch('pointerdown', 1, x, y)
        for (let i = 1; i <= 5; i++) touch('pointermove', 1, x + i * 10, y)
        touch('pointerup', 1, x + 50, y)
        touch('pointerdown', 2, x - 20, y)
        touch('pointerdown', 3, x + 20, y)
        for (let i = 1; i <= 5; i++) touch('pointermove', 3, x + 20 + i * 20, y)
        touch('pointerup', 3, x + 120, y)
        touch('pointerup', 2, x - 20, y)
      })
      const moved = (await viewBox())!.split(' ').map(Number)
      // closer: the board shows less of the scene
      expect(moved[2]!).toBeLessThan(fitted[2]!)
      // the sheet: tapped up, its tabs
      await page.locator('.lme-grab').tap()
      await page.waitForSelector('.lme-sheet[data-detent="half"] [role="tab"]')
      // the rest of the buttons, in a sheet of their own
      expect(await page.getByRole('button', { name: 'Format' }).isVisible()).toBe(false)
      await page.getByRole('button', { name: 'More' }).tap()
      // the sheet loads as it first opens
      await page.getByRole('button', { name: 'Format' }).waitFor()
      // on its side, a phone is a phone too
      await page.setViewportSize({ width: 844, height: 390 })
      await page.waitForFunction(() => document.querySelector('.lme')!.hasAttribute('data-narrow'))
      await phone.close()
    } finally {
      await browser.close()
    }
  }, 120_000)

  describe('a snippet', () => {
    let browser: Browser
    beforeAll(async () => {
      browser = await chromium.launch()
    })
    afterAll(() => browser?.close())

    /** The text of a view as its lines draw it. */
    const drawnText = (page: Page, nth = 0) =>
      page
        .locator('.snippet .cm-content')
        .nth(nth)
        .evaluate((el) => [...el.querySelectorAll('.cm-line')].map((l) => l.textContent).join('\n'))
    /** Every snippet of the page with its view in place: each mounts when the pointer reaches it. */
    async function mounted(page: Page) {
      const snippets = page.locator('.snippet:not(details:not([open]) .snippet)')
      const n = await snippets.count()
      for (let i = 0; i < n; i++) {
        // the snippet, not its <pre>: the view takes the <pre>'s place under the pointer as it arrives
        await snippets.nth(i).hover()
        await snippets.nth(i).locator('.cm-editor').waitFor()
      }
      return n
    }
    const boxes = (page: Page) =>
      page.evaluate(() => ({
        heights: [...document.querySelectorAll('.snippet')].map((el) => Math.round(el.getBoundingClientRect().height)),
        page: document.documentElement.scrollHeight,
      }))

    it('is coloured and readable without scripts, and a view takes its place without moving the page', async () => {
      const still = await browser.newContext({ viewport: { width: 1280, height: 900 }, javaScriptEnabled: false })
      const plain = await still.newPage()
      await plain.goto(`${url}language/`)
      const looks = await plain.evaluate(() => {
        const color = (s: string) => getComputedStyle(document.querySelector(s)!).color
        return {
          keyword: color('pre.code .tok-keyword'),
          text: color('pre.code'),
          views: document.querySelectorAll('.cm-editor').length,
          copy: [...document.querySelectorAll<HTMLElement>('.snippet > .copy')].filter((b) => !b.hidden).length,
        }
      })
      expect(looks.keyword).not.toBe(looks.text)
      expect(looks).toMatchObject({ views: 0, copy: 0 })
      const before = await boxes(plain)
      // in the prose's column: a snippet's box has the edges of the paragraph it follows
      const edges = await plain.evaluate(() => {
        const sides = (el: Element) => {
          const box = el.getBoundingClientRect()
          return [Math.round(box.left), Math.round(box.right)]
        }
        const text = sides(document.querySelector('main > p:not(.eyebrow)')!)
        const main = sides(document.querySelector('main')!)
        return { text, main, snippets: [...document.querySelectorAll('main > .snippet')].map(sides) }
      })
      // the window is wide enough for the column to sit inside main, or the left edge alone would prove nothing
      expect(edges.text[0]).toBeGreaterThan(edges.main[0]! + 40)
      expect(edges.snippets.length).toBeGreaterThan(0)
      for (const snippet of edges.snippets) expect(snippet).toEqual(edges.text)
      await still.close()

      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      const errors: string[] = []
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(`${url}language/`)
      // untouched, every snippet stays the <pre>: all of its text in the page, for the browser's find and for print
      await page.locator('.snippet > .copy:not([hidden])').first().waitFor({ state: 'attached' })
      expect(await page.locator('.cm-editor').count()).toBe(0)
      expect(await page.locator('.snippet pre[hidden]').count()).toBe(0)
      const n = await mounted(page)
      expect(n).toBe(before.heights.length)
      expect(await boxes(page)).toEqual(before)
      // the <pre> stays, hidden, as the text; the view shows the same text with the same tokens
      const first = page.locator('.snippet').first()
      expect(await first.locator('pre').isHidden()).toBe(true)
      expect(await drawnText(page)).toBe(await first.locator('pre').evaluate((el) => el.textContent))
      expect(
        await first.evaluate((el) => {
          const tokens = (s: string) => [...el.querySelectorAll(s)].map((t) => `${t.className}:${t.textContent}`)
          return tokens('.cm-content [class^="tok-"]').join('|') === tokens('pre [class^="tok-"]').join('|')
        }),
      ).toBe(true)
      expect(errors).toEqual([])
      await page.close()
    })

    it('keeps its height under a view when its fence ended with a newline', async () => {
      // Live data includes whole files, which end with one: a <pre> draws no line for it, a view would
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      await page.goto(`${url}live-data/`)
      await page.locator('.snippet > .copy:not([hidden])').first().waitFor({ state: 'attached' })
      expect(
        await page
          .locator('.snippet pre')
          .evaluateAll((all) => all.filter((el) => el.textContent?.endsWith('\n')).length),
      ).toBe(0)
      const before = await boxes(page)
      await mounted(page)
      expect((await boxes(page)).heights).toEqual(before.heights)
      await page.close()
    })

    it('lets the cursor in, to select with the keyboard and to select all of it alone, and nothing edits', async () => {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        permissions: ['clipboard-read', 'clipboard-write'],
      })
      const page = await context.newPage()
      await page.goto(`${url}language/`)
      const content = page.locator('.snippet .cm-content').first()
      await page.locator('.snippet').first().hover()
      await content.waitFor()
      const text = (await page
        .locator('.snippet pre')
        .first()
        .evaluate((el) => el.textContent))!
      expect(text.split('\n').length).toBeGreaterThan(1)
      expect(await content.getAttribute('aria-label')).toBe('loadmap snippet')
      expect(await content.getAttribute('aria-readonly')).toBe('true')
      expect(await content.getAttribute('role')).toBe('textbox')
      // a phone keeps its keyboard down
      expect(await content.getAttribute('inputmode')).toBe('none')

      await content.click()
      const focused = () => page.evaluate(() => document.activeElement?.className ?? '')
      expect(await focused()).toContain('cm-content')
      const selected = () => page.evaluate(() => getSelection()!.toString().replace(/\r/g, ''))
      await page.keyboard.press('ControlOrMeta+a')
      expect(await selected()).toBe(text)
      // the caret moves and selects as in any text
      await page.keyboard.press('ArrowLeft')
      for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight')
      expect(await selected()).toBe(text.slice(0, 4))

      await page.evaluate(() => navigator.clipboard.writeText('pasted'))
      for (const key of ['x', 'Backspace', 'Delete', 'Enter', 'ControlOrMeta+x', 'ControlOrMeta+v'])
        await page.keyboard.press(key)
      await page.keyboard.type('typed')
      // two frames: what a browser changed in the page would be drawn back by now
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      expect(await drawnText(page)).toBe(text)
      await context.close()
    })

    it('copies all of it from a button the keyboard reaches, and says so until the focus leaves', async () => {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        permissions: ['clipboard-read', 'clipboard-write'],
      })
      const page = await context.newPage()
      await page.goto(`${url}recording/`)
      const snippet = page.locator('.snippet').first()
      const text = await snippet.locator('pre').evaluate((el) => el.textContent)
      // the keyboard reaches the <pre>, and is in the view that takes its place
      await snippet.locator('pre').focus()
      await expect
        .poll(() => snippet.locator('.cm-content').evaluate((el) => el === document.activeElement), { timeout: 5000 })
        .toBe(true)
      // a part selected: the button still copies the whole
      await page.keyboard.press('Shift+ArrowRight')
      // Tab is not the snippet's: it moves on, to its button
      await page.keyboard.press('Tab')
      const copy = snippet.getByRole('button', { name: 'Copy' })
      expect(await copy.evaluate((el) => el === document.activeElement)).toBe(true)
      expect(await copy.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
      await page.keyboard.press('Enter')
      await expect.poll(() => snippet.locator('.copy').textContent(), { timeout: 5000 }).toBe('Copied')
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text)
      expect(await page.getByRole('status').textContent()).toBe('Copied')
      // a press anywhere else takes it back, as a finger does (no pointer leaves, no focus moves)
      await page.locator('h1').click()
      expect(await snippet.locator('.copy').textContent()).toBe('Copy')
      await snippet.locator('.copy').click()
      await expect.poll(() => snippet.locator('.copy').textContent(), { timeout: 5000 }).toBe('Copied')
      await snippet.locator('.copy').focus()
      await page.keyboard.press('Tab')
      expect(await snippet.locator('.copy').textContent()).toBe('Copy')
      expect(await page.getByRole('status').textContent()).toBe('')
      await context.close()
    })

    it("wears the editor's colours, light and dark", async () => {
      for (const colorScheme of ['light', 'dark'] as const) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme })
        const editor = await context.newPage()
        await editor.goto(`${url}editor/`)
        await editor.waitForSelector('.lme .cm-content .cm-line span')
        // the editor's tokens have no names: each kind by a text only it has
        const want = await editor.evaluate(() => {
          const spans = [...document.querySelectorAll<HTMLElement>('.lme .cm-content .cm-line span')]
          const look = (is: (text: string) => boolean) => {
            const style = getComputedStyle(spans.find((el) => is(el.textContent ?? ''))!)
            return [style.color, style.fontWeight, style.fontStyle].join(' ')
          }
          return {
            keyword: look((t) => t === 'loadmap'),
            string: look((t) => t.startsWith('"')),
            number: look((t) => /^\d/.test(t)),
            comment: look((t) => t.startsWith('#')),
            property: look((t) => t === 'title'),
          }
        })
        const page = await context.newPage()
        await page.goto(`${url}language/`)
        await page.waitForSelector('.snippet .tok-keyword')
        const got = await page.evaluate(() => {
          // in a view or in a <pre> further down that has none yet: the same classes
          const look = (kind: string) => {
            const style = getComputedStyle(document.querySelector(`.snippet .tok-${kind}`)!)
            return [style.color, style.fontWeight, style.fontStyle].join(' ')
          }
          return {
            keyword: look('keyword'),
            string: look('string'),
            number: look('number'),
            comment: look('comment'),
            property: look('property'),
          }
        })
        expect(got, colorScheme).toEqual(want)
        await context.close()
      }
    })

    it('fits a phone: a long line scrolls inside it, the page stays put, the button is always there', async () => {
      const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
      const page = await phone.newPage()
      await page.goto(`${url}language/`)
      await mounted(page)
      const fit = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth <= innerWidth,
        inside: [...document.querySelectorAll('.snippet .cm-scroller')].some((el) => el.scrollWidth > el.clientWidth),
        copy: [...document.querySelectorAll('.snippet > .copy')].every((el) => getComputedStyle(el).opacity === '1'),
      }))
      expect(fit).toEqual({ page: true, inside: true, copy: true })
      await phone.close()
    })

    it('is the same under a live definition, once its text is opened', async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      await page.goto(`${url}concepts/`)
      const island = page.locator('[data-island="loadmap"]').first()
      await island.locator('summary').click()
      await island.locator('.snippet').hover()
      await island.locator('.snippet .cm-editor').waitFor()
      expect(await island.locator('.snippet .cm-content').getAttribute('aria-label')).toBe('loadmap snippet')
      expect(await island.locator('.snippet .tok-keyword').count()).toBeGreaterThan(0)
      await page.close()
    })
  })

  describe('the light and dark switch', () => {
    let browser: Browser
    beforeAll(async () => {
      browser = await chromium.launch()
    })
    afterAll(() => browser?.close())

    /** What the page draws in: its own background, and each board's and the editor's tokens. */
    const looks = (page: Page) =>
      page.evaluate(() => {
        const dark = (el: Element) => {
          const [r, g, b] = getComputedStyle(el).backgroundColor.match(/\d+/g)!.map(Number)
          return r! + g! + b! < 300 ? 'dark' : 'light'
        }
        const scheme = (s: string) => [...document.querySelectorAll(s)].map((el) => getComputedStyle(el).colorScheme)
        return {
          kept: document.documentElement.dataset.theme ?? 'system',
          page: dark(document.body),
          boards: scheme('.lm:not(.lme)'),
          editor: scheme('.lme'),
          code: [...document.querySelectorAll('.lme .cm-editor')].map(dark),
          picked: [...document.querySelectorAll<HTMLInputElement>('.theme input:checked')].map((i) => i.value),
        }
      })
    const drawn = (page: Page) =>
      page.waitForFunction(() => document.querySelector('[data-node]'), null, { timeout: 30_000 })

    it('follows the system until the reader picks, on the pages and in the editor', async () => {
      for (const scheme of ['light', 'dark'] as const) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: scheme })
        await page.goto(`${url}examples/checkout/`)
        await drawn(page)
        expect(await looks(page)).toEqual({
          kept: 'system',
          page: scheme,
          boards: [scheme],
          editor: [],
          code: [],
          picked: ['system', 'system'],
        })
        await page.goto(`${url}editor/`)
        await drawn(page)
        expect(await looks(page)).toMatchObject({ kept: 'system', page: scheme, editor: [scheme], code: [scheme] })
        await page.close()
      }
    }, 120_000)

    it('flips the page, its boards and the editor, keeps the choice, and goes back to the system', async () => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' })
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(`${url}examples/checkout/`)
      await drawn(page)
      await page.locator('.bar > .theme label', { hasText: 'Dark' }).click()
      await expect
        .poll(() => looks(page), { timeout: 5000 })
        .toMatchObject({ kept: 'dark', page: 'dark', boards: ['dark'], picked: ['dark', 'dark'] })
      // another page, the quick start's board with it, and a reload
      await page.goto(`${url}getting-started/`)
      await drawn(page)
      expect(await looks(page)).toMatchObject({ kept: 'dark', page: 'dark', boards: ['dark'] })
      await page.reload()
      await drawn(page)
      expect(await looks(page)).toMatchObject({ kept: 'dark', page: 'dark', boards: ['dark'] })
      // the editor keeps it and changes it: its code and its diagram follow
      await page.goto(`${url}editor/`)
      await drawn(page)
      expect(await looks(page)).toMatchObject({ kept: 'dark', editor: ['dark'], code: ['dark'], picked: ['dark'] })
      const theme = async (name: string) => {
        await page.getByRole('button', { name: 'Theme' }).click()
        await page.getByRole('menuitemradio', { name }).click()
      }
      await page.getByRole('button', { name: 'Theme' }).click()
      expect(await page.getByRole('menuitemradio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true')
      await page.keyboard.press('Escape')
      await theme('Light')
      await expect
        .poll(() => looks(page), { timeout: 5000 })
        .toMatchObject({ kept: 'light', page: 'light', editor: ['light'] })
      expect((await looks(page)).code).toEqual(['light'])
      // System again: nothing kept, and the system's change is followed
      await theme('System')
      expect(await page.evaluate(() => localStorage.getItem('loadmap-theme'))).toBe(null)
      await page.emulateMedia({ colorScheme: 'dark' })
      await expect
        .poll(() => looks(page), { timeout: 5000 })
        .toMatchObject({ kept: 'system', page: 'dark', editor: ['dark'] })
      expect(errors).toEqual([])
      await context.close()
    }, 120_000)

    it('paints the kept choice first, before any script of the site runs', async () => {
      const html = readFileSync(join(out, 'concepts/index.html'), 'utf8')
      expect(html.indexOf("localStorage.getItem('loadmap-theme')")).toBeGreaterThan(0)
      expect(html.indexOf("localStorage.getItem('loadmap-theme')")).toBeLessThan(html.indexOf('rel="stylesheet"'))
      const editor = readFileSync(join(out, 'editor/index.html'), 'utf8')
      expect(editor.indexOf("localStorage.getItem('loadmap-theme')")).toBeGreaterThan(0)
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' })
      await page.addInitScript(() => localStorage.setItem('loadmap-theme', 'dark'))
      await page.route(/\.js$/, (r) => r.abort())
      await page.goto(`${url}concepts/`)
      expect(await looks(page)).toMatchObject({ kept: 'dark', page: 'dark' })
      // and the switch already shows it
      const shown = await page.evaluate(() =>
        [...document.querySelectorAll('.bar > .theme label')].map((l) => getComputedStyle(l).backgroundColor),
      )
      expect(shown[2]).not.toBe(shown[0])
      expect(shown[0]).toBe(shown[1])
      await page.close()
    }, 120_000)

    it('follows the system when storage is refused, and still switches the page', async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' })
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.addInitScript(() =>
        Object.defineProperty(window, 'localStorage', {
          get: () => {
            throw new DOMException('refused', 'SecurityError')
          },
        }),
      )
      await page.goto(`${url}concepts/`)
      await drawn(page)
      expect(await looks(page)).toMatchObject({ kept: 'system', page: 'dark', boards: ['dark', 'dark'] })
      await page.locator('.bar > .theme label', { hasText: 'Light' }).click()
      await expect.poll(() => looks(page), { timeout: 5000 }).toMatchObject({ kept: 'light', page: 'light' })
      expect(errors).toEqual([])
      await page.close()
    }, 120_000)

    it('sits in the menu on a phone, the pages and the editor alike', async () => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' })
      const page = await context.newPage()
      await page.goto(`${url}concepts/`)
      expect(await page.locator('.bar > .theme').isVisible()).toBe(false)
      await page.locator('.menu summary').click()
      await page.locator('.panel .theme label', { hasText: 'Dark' }).click()
      await expect.poll(() => looks(page), { timeout: 5000 }).toMatchObject({ kept: 'dark', page: 'dark' })
      await page.goto(`${url}editor/`)
      await page.waitForSelector('[aria-label="More"]')
      expect(await looks(page)).toMatchObject({ kept: 'dark', editor: ['dark'] })
      expect(await page.locator('.lme-actions .theme').isVisible()).toBe(false)
      await page.getByRole('button', { name: 'More' }).click()
      await page.locator('.lme-actions .theme label', { hasText: 'Light' }).click()
      await expect.poll(() => looks(page), { timeout: 5000 }).toMatchObject({ kept: 'light', editor: ['light'] })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
      await context.close()
    }, 120_000)

    it('leaves an embed to its link', async () => {
      const source = readFileSync(join(import.meta.dirname, '../../../examples/checkout/checkout.loadmap'), 'utf8')
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, colorScheme: 'light' })
      await page.addInitScript(() => localStorage.setItem('loadmap-theme', 'dark'))
      await page.goto(`${url}embed/#${await encodeShare(source)}`)
      await drawn(page)
      expect(await looks(page)).toMatchObject({ kept: 'system', page: 'light', boards: ['light'] })
      await page.close()
    }, 120_000)
  })
})
