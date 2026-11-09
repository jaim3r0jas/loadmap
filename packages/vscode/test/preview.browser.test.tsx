import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import checkout from '../../../examples/checkout/checkout.loadmap?raw'
import type { FromPreview, PreviewState, Shown, ToPreview } from '../src/protocol'
import { type Host, Preview } from '../src/webview/Preview'
import { followTheme } from '../src/webview/theme'

const uri = 'file:///shop/checkout.loadmap'
let root: Root | null = null
afterEach(() => {
  root?.unmount()
  root = null
  document.body.replaceChildren()
  document.body.className = ''
})

/** The webview as VS Code runs it, with a host that records what it posts and keeps its state. */
async function mount(state?: PreviewState) {
  await page.viewport(900, 900)
  const el = document.createElement('div')
  el.style.height = '900px'
  document.body.appendChild(el)
  const posted: FromPreview[] = []
  let kept = state
  const host: Host = {
    postMessage: (m) => posted.push(m),
    getState: () => kept,
    setState: (s) => {
      kept = s
    },
  }
  root = createRoot(el)
  root.render(<Preview host={host} />)
  await expect.poll(() => posted[0]?.type).toBe('ready')
  const send = (m: ToPreview) => window.postMessage(m, '*')
  let requests = 0
  /** The answer to a state request: what the preview shows. */
  const shown = async () => {
    const request = ++requests
    send({ type: 'state?', request })
    await expect.poll(() => posted.some((m) => m.type === 'state' && m.request === request)).toBe(true)
    return posted.find((m) => m.type === 'state' && m.request === request) as Shown
  }
  /** The values that differ from the defaults. */
  const values = async () => (await shown()).values
  const box = (id: string) => el.querySelector<SVGElement>(`[data-node="${id}"]`)
  return { el, posted, send, shown, values, box, kept: () => kept }
}

describe('the preview', () => {
  it('says what to do before a file is sent, then draws the one it gets', async () => {
    const p = await mount()
    expect(p.el.textContent).toContain('Open a .loadmap file')
    p.send({ type: 'source', uri, source: checkout, name: 'checkout.loadmap', version: 1, edits: null })
    await expect.poll(() => p.box('gateway'), { timeout: 5000 }).toBeTruthy()
    expect(p.box('workers')).toBeTruthy()
    expect((await p.shown()).boxes.sort()).toEqual(['db', 'gateway', 'kafka', 'phones', 'workers'])
  })

  it('asks for the declaration of a box clicked, and marks the box the cursor is in', async () => {
    const p = await mount()
    p.send({ type: 'source', uri, source: checkout, name: 'checkout.loadmap', version: 1, edits: null })
    await expect.poll(() => p.box('gateway'), { timeout: 5000 }).toBeTruthy()
    await userEvent.click(p.box('workers')!)
    await expect.poll(() => p.posted.find((m) => m.type === 'reveal')).toEqual({ type: 'reveal', id: 'workers' })
    p.send({ type: 'select', id: 'gateway' })
    await expect.poll(() => p.box('gateway')!.getAttribute('aria-pressed')).toBe('true')
    expect((await p.shown()).selected).toBe('gateway')
    p.send({ type: 'select', id: null })
    await expect.poll(() => p.box('gateway')!.getAttribute('aria-pressed')).toBe('false')
  })

  it('keeps its values across edits, and shows the problems over the last good diagram', async () => {
    const p = await mount()
    p.send({ type: 'source', uri, source: checkout, name: 'checkout.loadmap', version: 1, edits: null })
    await expect.poll(() => p.box('gateway'), { timeout: 5000 }).toBeTruthy()
    expect(await p.values()).toEqual({})
    await userEvent.click(page.getByRole('button', { name: 'Proposed' }))
    expect(await p.values()).toEqual({ gateways: 2, pods: 6 })

    p.send({
      type: 'source',
      uri,
      source: checkout.replace('"API gateway"', '"Edge gateway"'),
      name: 'checkout.loadmap',
      version: 2,
      edits: null,
    })
    await expect.poll(() => p.box('gateway')?.textContent, { timeout: 5000 }).toContain('Edge gateway')
    expect(await p.values()).toEqual({ gateways: 2, pods: 6 })

    p.send({
      type: 'source',
      uri,
      source: `${checkout}\nnode broken { pass { volume: 5 } }\n`,
      name: 'checkout.loadmap',
      version: 2,
      edits: null,
    })
    await expect.poll(() => p.el.querySelector('.lm-problems')?.textContent).toContain('checkout.loadmap')
    expect(p.el.querySelector('.lm-problems')!.textContent).toContain('volume')
    expect(p.box('gateway')).toBeTruthy()
  })

  it('brings its values back after a reload, and each file its own while it follows another', async () => {
    const saved = { uri, source: checkout, name: 'checkout.loadmap', values: { load: 30 } }
    const p = await mount(saved)
    await expect.poll(() => p.box('gateway'), { timeout: 5000 }).toBeTruthy()
    expect(await p.values()).toEqual({ load: 30 })
    // what a hidden tab or a reload keeps
    document.dispatchEvent(new Event('visibilitychange'))
    expect(p.kept()).toEqual(saved)

    await userEvent.click(page.getByRole('button', { name: 'Proposed' }))
    expect(await p.values()).toEqual({ load: 30, gateways: 2, pods: 6 })

    // another file starts from its own defaults, on a board of its own
    const switchTo = async (to: string) => {
      const before = p.box('gateway')
      p.send({ type: 'source', uri: to, source: checkout, name: to.split('/').at(-1)!, version: 1, edits: null })
      await expect.poll(() => p.box('gateway') !== before && p.box('gateway') !== null, { timeout: 5000 }).toBe(true)
    }
    await switchTo('file:///shop/other.loadmap')
    expect(await p.values()).toEqual({})
    expect(p.kept()).toMatchObject({ uri: 'file:///shop/other.loadmap', values: {} })
    // and back: the values it had when the preview left it, not the ones from before the reload
    await switchTo(uri)
    expect(await p.values()).toEqual({ load: 30, gateways: 2, pods: 6 })
  })
})

describe('tracking live changes', () => {
  /** The text with the database's capacity doubled, and where the edit is. */
  const edited = (version = 2) => {
    const from = checkout.indexOf('4_000')
    return { source: checkout.replace('4_000', '8_000'), version, edits: [{ from, to: from + 5, version }] }
  }

  it('brings the box an edit changed into view and marks it, then says it followed the edits', async () => {
    const p = await mount()
    p.send({ type: 'track', on: true })
    p.send({ type: 'source', uri, source: checkout, name: 'checkout.loadmap', version: 1, edits: null })
    await expect.poll(() => p.box('db'), { timeout: 5000 }).toBeTruthy()
    p.send({ type: 'source', uri, name: 'checkout.loadmap', ...edited() })
    await expect
      .poll(() => p.posted.find((m) => m.type === 'tracked'), { timeout: 10_000 })
      .toEqual({ type: 'tracked', uri, version: 2, boxes: ['db'] })
    expect(p.box('db')!.hasAttribute('data-changed')).toBe(true)
    expect(p.box('gateway')!.hasAttribute('data-changed')).toBe(false)
    // the mark goes after a moment
    await expect.poll(() => p.box('db')!.hasAttribute('data-changed'), { timeout: 5000 }).toBe(false)
  })

  it('follows no edit made while it is off, nor a whole new text', async () => {
    const p = await mount()
    p.send({ type: 'source', uri, source: checkout, name: 'checkout.loadmap', version: 1, edits: null })
    await expect.poll(() => p.box('db'), { timeout: 5000 }).toBeTruthy()
    p.send({ type: 'source', uri, name: 'checkout.loadmap', ...edited() })
    p.send({ type: 'track', on: true })
    p.send({ type: 'source', uri, source: checkout, name: 'checkout.loadmap', version: 3, edits: null })
    // the first edit it follows comes after them: only that one is said, so neither of those was
    p.send({ type: 'source', uri, name: 'checkout.loadmap', ...edited(4) })
    await expect.poll(() => p.posted.filter((m) => m.type === 'tracked'), { timeout: 10_000 }).not.toEqual([])
    expect(p.posted.filter((m) => m.type === 'tracked')).toEqual([{ type: 'tracked', uri, version: 4, boxes: ['db'] }])
  })
})

describe("VS Code's theme", () => {
  it('reaches the page as light or dark, and follows a change', async () => {
    document.body.className = 'vscode-light'
    const stop = followTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
    document.body.className = 'vscode-dark'
    await expect.poll(() => document.documentElement.dataset.theme).toBe('dark')
    document.body.className = 'vscode-high-contrast vscode-high-contrast-light'
    await expect.poll(() => document.documentElement.dataset.theme).toBe('light')
    document.body.className = 'vscode-high-contrast'
    await expect.poll(() => document.documentElement.dataset.theme).toBe('dark')
    stop()
  })
})
