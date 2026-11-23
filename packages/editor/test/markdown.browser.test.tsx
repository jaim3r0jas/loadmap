// A model's answer drawn from its Markdown: what it draws, and what it never does with what a model writes.
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { blocks, Markdown } from '../src/Markdown'

let root: Root | null = null
afterEach(() => {
  root?.unmount()
  root = null
  document.body.replaceChildren()
})

async function draw(text: string): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  root.render(<Markdown text={text} />)
  await expect.poll(() => host.childNodes.length).toBeGreaterThan(0)
  return host
}

describe("a model's Markdown", () => {
  it('draws paragraphs, headings, emphasis, lists, quotes, code and tables as elements', async () => {
    const host = await draw(
      [
        '## The first limit',
        '',
        '**orders-db** is full at *2.4 ×* today, with `200` connections.',
        '',
        '- the pool',
        '- the replica',
        '',
        '1. add a replica',
        '2. route reads',
        '',
        '> as measured',
        '',
        '```loadmap',
        'component replica like orders-db',
        '```',
        '',
        '| Part | Use |',
        '| --- | --- |',
        '| pool | 92 % |',
      ].join('\n'),
    )
    expect(host.querySelector('h4')?.textContent).toBe('The first limit')
    expect(host.querySelector('strong')?.textContent).toBe('orders-db')
    expect(host.querySelector('em')?.textContent).toBe('2.4 ×')
    expect(host.querySelector('p code')?.textContent).toBe('200')
    expect([...host.querySelectorAll('ul li')].map((l) => l.textContent)).toEqual(['the pool', 'the replica'])
    expect([...host.querySelectorAll('ol li')].map((l) => l.textContent)).toEqual(['add a replica', 'route reads'])
    expect(host.querySelector('blockquote')?.textContent).toBe('as measured')
    expect(host.querySelector('pre')?.getAttribute('data-lang')).toBe('loadmap')
    expect(host.querySelector('pre code')?.textContent).toBe('component replica like orders-db')
    expect([...host.querySelectorAll('th')].map((c) => c.textContent)).toEqual(['Part', 'Use'])
    expect([...host.querySelectorAll('td')].map((c) => c.textContent)).toEqual(['pool', '92 %'])
  })

  it('keeps raw HTML as text, loads no image, and opens only http and https links', async () => {
    const host = await draw(
      [
        '<script>alert(1)</script> <img src=x onerror=alert(2)>',
        '',
        '![a chart](https://tracker.example/pixel.png) and [docs](https://example.com/docs) and [bad](javascript:alert(3))',
      ].join('\n'),
    )
    expect(host.querySelector('script, img, iframe')).toBeNull()
    expect(host.textContent).toContain('<script>alert(1)</script>')
    const links = [...host.querySelectorAll('a')]
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['a chart', 'https://tracker.example/pixel.png'],
      ['docs', 'https://example.com/docs'],
    ])
    for (const a of links) expect([a.target, a.rel]).toEqual(['_blank', 'noopener noreferrer'])
    expect(host.textContent).toContain('[bad](javascript:alert(3))')
  })

  it('leaves the ops fence to the proposal card, and draws a fence still open as far as it got', () => {
    expect(blocks('Here.\n```ops\nput\n  scenario "Eight" {}\n```\nDone.').map((b) => b.kind)).toEqual(['p', 'p'])
    expect(blocks('Streaming:\n```loadmap\ncomponent a')).toEqual([
      { kind: 'p', text: 'Streaming:' },
      { kind: 'code', lang: 'loadmap', text: 'component a' },
    ])
  })

  it('reads snake_case and file names as words, not emphasis', async () => {
    const host = await draw('Set max_pool_size in my_app.loadmap, and *this* one.')
    expect([...host.querySelectorAll('em')].map((e) => e.textContent)).toEqual(['this'])
  })

  it('keeps a numbered list numbered across blank lines, and draws a list or code inside an item', async () => {
    const host = await draw(
      ['3. Add a replica', '', '4. Route reads:', '   - the orders', '   - the visits', '', '5. Raise the pool'].join(
        '\n',
      ),
    )
    const ol = host.querySelector('ol')!
    expect(ol.getAttribute('start')).toBe('3')
    expect(ol.querySelectorAll(':scope > li')).toHaveLength(3)
    expect([...ol.querySelectorAll('ul li')].map((l) => l.textContent)).toEqual(['the orders', 'the visits'])
  })

  it("leaves every machine block to the panel, as the answer's reader names them", () => {
    for (const fence of ['ops', 'OPS', 'operations', 'questions', 'explore', 'loadmap models/shop.loadmap'])
      expect(blocks(`Text.\n\`\`\`${fence}\nwhatever\n\`\`\``).map((b) => b.kind)).toEqual(['p'])
    expect(blocks('```loadmap\ncomponent a\n```').map((b) => b.kind)).toEqual(['code'])
  })

  it('keeps a heading ending in #, and never puts a link in a link', async () => {
    const host = await draw('## Calling it from C#\n\n[https://example.com/docs](https://example.com/docs)')
    expect(host.querySelector('h4')?.textContent).toBe('Calling it from C#')
    expect(host.querySelectorAll('a')).toHaveLength(1)
    expect(host.querySelector('a a')).toBeNull()
  })
})
