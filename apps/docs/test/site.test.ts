import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { chromium } from 'playwright'
import { build, type PreviewServer, preview } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { included, PAGES, relative, render } from '../pages'

const config = join(import.meta.dirname, '../vite.config.ts')
const routeOf = (href: string, from: string) => new URL(href, `http://x/${from ? `${from}/` : ''}`).pathname

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
    const routes = new Set(PAGES.map((p) => `/${p.route ? `${p.route}/` : ''}`))
    for (const { page, html } of rendered)
      for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
        if (/^(https?:|#|mailto:)/.test(href!)) continue
        const path = routeOf(href!, page.route).replace(/#.*$/, '')
        expect(routes.has(path), `${page.file} links to ${href} (${path})`).toBe(true)
      }
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

  it('tell the dev server which repository files they include', () => {
    const files = included().map((f) => f.slice(f.lastIndexOf('/', f.lastIndexOf('/') - 1) + 1))
    expect(files.sort()).toEqual(['docs/dsl.md', 'react/README.md'])
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
      await page.getByRole('button', { name: 'checkout', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('.lm h2')?.textContent === 'Checkout pipeline')
      expect(await page.evaluate(() => localStorage.getItem('loadmap-editor-draft-earlier'))).toBe(mine)
      await page.getByRole('button', { name: 'your earlier draft' }).click()
      await page.waitForFunction(() => document.querySelector('.lm h2')?.textContent === 'My uploads')
    } finally {
      await browser.close()
    }
  }, 120_000)
})
