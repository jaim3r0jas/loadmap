import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { encodeShare } from '@loadmap/dsl'
import { TEMPLATES } from '@loadmap/editor/templates'
import { chromium } from 'playwright'
import { build, type PreviewServer, preview } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shippedReference } from '../../../scripts/reference'
import { included, PAGES, relative, render } from '../pages'

const config = join(import.meta.dirname, '../vite.config.ts')
const routeOf = (href: string, from: string) => new URL(href, `http://x/${from ? `${from}/` : ''}`).pathname
const routes = new Set(PAGES.map((p) => `/${p.route ? `${p.route}/` : ''}`))
/** The pages in the site's frame; the others (the editor) fill the window. */
const DOCS = PAGES.filter((p) => !p.frame)

/** Every link of a page leads to a page of the site, or to a heading on the same page. */
function expectLinks(html: string, route: string, label: string) {
  // data-editor: where an island's Edit link leads
  for (const [, href] of html.matchAll(/(?:href|data-editor)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|\/assets\/)/.test(href!)) continue
    if (href!.startsWith('#')) expect(html, `${label} links to ${href}`).toContain(`id="${href!.slice(1)}"`)
    else {
      const path = routeOf(href!, route).replace(/#.*$/, '')
      expect(routes.has(path), `${label} links to ${href} (${path})`).toBe(true)
    }
  }
}

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
    expect(files.sort()).toEqual(['docs/dsl.md', 'react/README.md', 'react/package.json'])
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
    await build({ configFile: config, logLevel: 'error', build: { outDir: out, emptyOutDir: true } })
    server = await preview({ configFile: config, logLevel: 'error', build: { outDir: out }, preview: { port: 0 } })
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
    expect(kb).toBeLessThan(5)
  })

  it('draws the live parts in Chromium: examples, the quick start, a definition, the editor', async () => {
    const browser = await chromium.launch()
    try {
      for (const [route, nodes] of [
        ['examples/checkout/', 5],
        ['getting-started/', 3],
        ['concepts/', 3],
        ['editor/', 5],
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
        if (route.startsWith('examples'))
          expect(await page.evaluate(() => Boolean((globalThis as { __loadmap?: object }).__loadmap))).toBe(true)
        expect(errors, route).toEqual([])
        await page.close()
      }
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
      expect(await page.locator('.lm h2').first().textContent()).toBe('Checkout pipeline')
      expect(
        await page.evaluate(() => document.querySelector<HTMLInputElement>('.lm input[type="range"]')?.value),
      ).toBe('30')
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

  it('keeps the draft aside when an example takes its place in the editor', async () => {
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
      await page.waitForFunction(() => document.querySelector('.lm h2')?.textContent === 'My uploads')
      await page.getByRole('combobox', { name: 'Open an example' }).selectOption('checkout')
      await page.waitForFunction(() => document.querySelector('.lm h2')?.textContent === 'Checkout pipeline')
      expect(await page.evaluate(() => localStorage.getItem('loadmap-editor-draft-earlier'))).toBe(mine)
      await page.getByRole('combobox', { name: 'Open an example' }).selectOption('earlier')
      await page.waitForFunction(() => document.querySelector('.lm h2')?.textContent === 'My uploads')
    } finally {
      await browser.close()
    }
  }, 120_000)

  it('fills the window with the editor, without the docs frame, and keeps where the divider was left', async () => {
    const browser = await chromium.launch()
    try {
      for (const [width, height] of [
        [1440, 900],
        [2560, 1440],
      ] as const) {
        const page = await browser.newPage({ viewport: { width, height } })
        await page.goto(`${url}editor/`)
        await page.waitForSelector('[data-node]')
        const m = await page.evaluate(() => {
          const lme = document.querySelector('.lme')!.getBoundingClientRect()
          const text = document.querySelector('.lme-left')!.getBoundingClientRect()
          const shown = document.querySelector('.lme-preview')!.getBoundingClientRect()
          return {
            frame: document.querySelectorAll('.top, .side, .pager').length,
            scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
            lme: [lme.width, lme.height],
            side: text.right <= shown.left && text.height > innerHeight * 0.8,
          }
        })
        const at = `${width}x${height}`
        expect(m.frame, at).toBe(0)
        expect(m.scroll, at).toEqual([width, height])
        expect(m.lme, at).toEqual([width, height])
        expect(m.side, at).toBe(true)
        await page.close()
      }
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      await page.goto(`${url}editor/`)
      const divider = page.getByRole('separator', { name: 'Resize the text and the diagram' })
      expect(await divider.getAttribute('aria-valuenow')).toBe('40')
      await divider.focus()
      for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
      expect(await divider.getAttribute('aria-valuenow')).toBe('50')
      await page.reload()
      expect(await divider.getAttribute('aria-valuenow')).toBe('50')
      const half = await page.evaluate(() => document.querySelector('.lme-left')!.getBoundingClientRect().width)
      expect(Math.abs(half - 720)).toBeLessThan(12)
      await page.getByRole('button', { name: 'Help' }).click()
      expect(await page.locator('#help').isVisible()).toBe(true)
      await page.keyboard.press('Escape')
      expect(await page.locator('#help').isHidden()).toBe(true)
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
      await page.waitForSelector('.lm h2')
      expect(await page.locator('.lm h2').first().textContent()).toBe(/title: "([^"]+)"/.exec(t.source)![1])
      expect(await page.locator('.lme-left').isVisible()).toBe(true)
      await page.goto(`${url}editor/?code#${hash}`)
      await page.waitForSelector('[data-node]')
      expect(await page.locator('.lme-left').isVisible()).toBe(true)
      expect(await page.locator('.lme-inspector').count()).toBe(0)
    } finally {
      await browser.close()
    }
  }, 120_000)

  it('closes back to the page it was opened from, and to the docs home when opened cold', async () => {
    const hash = await encodeShare(readFileSync(join(import.meta.dirname, '../site/uploads.loadmap'), 'utf8'))
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      await page.goto(`${url}templates/`)
      await page.getByRole('link', { name: /in the editor$/ }).click()
      await page.waitForSelector('.lme-left')
      await page.getByRole('link', { name: 'Docs' }).click()
      await page.waitForURL(`${url}templates/`)
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
      const title = await page.locator('.island .lm h2').first().textContent()
      await page.locator('.island .edit a').first().click()
      await page.waitForURL(/\/editor\/\?code#v1\./)
      await page.waitForSelector('[data-node]')
      expect(await page.locator('.lm h2').first().textContent()).toBe(title)
      expect(await page.locator('.lme-left').isVisible()).toBe(true)

      await page.goto(`${url}examples/checkout/`)
      await page.waitForSelector('[data-node]')
      await page
        .getByRole('button', { name: /^Black Friday/ })
        .first()
        .click()
      await page.getByRole('link', { name: 'Edit in the editor ⤢' }).click()
      await page.waitForURL(/\/editor\/\?code#v1\..*load=40.*pods=6/)
      await page.waitForSelector('[data-node]')
      expect(await page.locator('.lm h2').first().textContent()).toBe('Checkout pipeline')
      expect(await page.locator('.lme-left').isVisible()).toBe(true)
    } finally {
      await browser.close()
    }
  }, 120_000)

  it('shows one pane at a time on a phone, the rest of the buttons in a menu', async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
      await page.goto(`${url}editor/`)
      await page.waitForSelector('.lme-panes')
      expect(await page.locator('.lme-left').isVisible()).toBe(true)
      expect(await page.locator('.lme-preview').isHidden()).toBe(true)
      await page.getByRole('tab', { name: 'Diagram' }).click()
      await page.waitForSelector('[data-node]')
      expect(await page.locator('.lme-left').isHidden()).toBe(true)
      const m = await page.evaluate(() => ({
        scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        bar: document.querySelector('.lme-bar')!.getBoundingClientRect().height,
      }))
      expect(m.scroll).toEqual([390, 844])
      // one row
      expect(m.bar).toBeLessThan(56)
      expect(await page.getByRole('button', { name: 'Format' }).isVisible()).toBe(false)
      await page.getByLabel('More').click()
      expect(await page.getByRole('button', { name: 'Format' }).isVisible()).toBe(true)
    } finally {
      await browser.close()
    }
  }, 120_000)
})
