import { EditorView } from '@codemirror/view'
import type { Engine } from '@loadmap/react'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import alerts from '../../../examples/alerts/alerts.loadmap?raw'
import checkout from '../../../examples/checkout/checkout.loadmap?raw'
import { LoadmapEditor, type LoadmapEditorHandle } from '../src'

let root: Root | null = null
afterEach(() => {
  root?.unmount()
  root = null
  document.body.replaceChildren()
})

async function mount(o: { track?: boolean; onTrack?: (on: boolean) => void } = {}) {
  await page.viewport(1440, 1000)
  const host = document.createElement('div')
  host.style.height = '900px'
  document.body.appendChild(host)
  const ref = createRef<LoadmapEditorHandle>()
  root = createRoot(host)
  root.render(<LoadmapEditor ref={ref} initial={checkout} fill track={o.track} onTrack={o.onTrack} />)
  await expect.poll(() => ref.current?.loadmap()).toBeTruthy()
  await ref.current!.loadmap()!.ready()
  const engine = () => ref.current!.loadmap()!.engine
  await expect.poll(() => engine().viewer?.shownView()).toBeTruthy()
  const view = EditorView.findFromDOM(host.querySelector('.cm-editor') as HTMLElement)!
  const edit = (from: string, to: string) => {
    const at = view.state.doc.toString().indexOf(from)
    expect(at).toBeGreaterThanOrEqual(0)
    view.dispatch({ changes: { from: at, to: at + from.length, insert: to } })
  }
  return { host, handle: ref.current!, engine, edit }
}

/** The new text compiled, laid out and moved in: the frame drawn is its scene. */
async function settled(engine: () => Engine) {
  await expect.poll(() => engine().scene && engine().frame === engine().scene, { timeout: 5000 }).toBe(true)
}

/** Where a box's centre is on the board, in its pixels, and the zoom. */
function onBoard(engine: Engine, id: string) {
  const p = engine.viewer!.placement()!
  const n = engine.frame!.nodes.find((x) => x.id === id)!
  return { x: p.k * (n.x + n.w / 2) + p.dx, y: p.k * (n.y + n.h / 2) + p.dy, k: engine.viewer!.shownView()!.k }
}

/** Whether a box shows whole in the part of the board nothing floats over. */
function inView(engine: Engine, id: string) {
  const { viewport: vp } = engine.viewer!
  const p = engine.viewer!.placement()!
  const n = engine.frame!.nodes.find((x) => x.id === id)!
  const [x0, y0] = [p.k * n.x + p.dx, p.k * n.y + p.dy]
  const [x1, y1] = [x0 + p.k * n.w, y0 + p.k * n.h]
  return x0 >= vp.inset.left && x1 <= vp.w - vp.inset.right && y0 >= vp.inset.top && y1 <= vp.h - vp.inset.bottom
}

/** Close on the phones, at the far left: the database is out of view. */
function closeOnPhones(engine: Engine) {
  const n = engine.frame!.nodes.find((x) => x.id === 'phones')!
  engine.viewer!.setView({ x: n.x + n.w / 2, y: n.y + n.h / 2, k: 2 })
  expect(inView(engine, 'db')).toBe(false)
}

describe('the editor’s diagram across edits', () => {
  it('fits the whole diagram on the first load', async () => {
    const { engine } = await mount()
    const viewer = engine().viewer!
    expect(viewer.readerView).toBeNull()
    expect(viewer.shownView()).toEqual(viewer.fit())
  })

  it('keeps a zoomed view through a label, a value, an added box and a removed one, the box looked at in place', async () => {
    const { engine, edit } = await mount()
    const first = engine()
    // close on the database
    const db = first.frame!.nodes.find((n) => n.id === 'db')!
    first.viewer!.setView({ x: db.x + db.w / 2, y: db.y + db.h / 2, k: 2 })
    const was = onBoard(first, 'db')
    const edits: [string, string][] = [
      ['"Postgres" "primary"', '"Postgres" "primary, edited"'],
      ['estimated(4_000 ± 30%', 'estimated(2_000 ± 30%'],
      ['phones -> gateway', 'node cache "Cache" { tier: data }\ngateway -> cache\nphones -> gateway'],
      ['node cache "Cache" { tier: data }\ngateway -> cache\n', ''],
    ]
    for (const [from, to] of edits) {
      const scene = engine().scene
      edit(from, to)
      // every version is laid out again, its own scene
      await expect.poll(() => engine().scene !== scene, { timeout: 5000 }).toBe(true)
      await settled(engine)
      // one engine all along: the reader's view is never thrown away
      expect(engine()).toBe(first)
      const now = onBoard(engine(), 'db')
      expect(now.k).toBeCloseTo(was.k, 6)
      expect(now.x).toBeCloseTo(was.x, 0)
      expect(now.y).toBeCloseTo(was.y, 0)
    }
    expect(engine().frame!.nodes.some((n) => n.id === 'cache')).toBe(false)
  })

  it('draws something every frame while an edit comes in', async () => {
    const { host, engine, edit } = await mount()
    const scene = engine().scene
    let blank = 0
    let on = true
    const watch = () => {
      if (!host.querySelector('.lme-preview .lm-board svg [data-node]')) blank++
      if (on) requestAnimationFrame(watch)
    }
    requestAnimationFrame(watch)
    edit('phones -> gateway', 'node cache "Cache" { tier: data }\ngateway -> cache\nphones -> gateway')
    await expect.poll(() => engine().scene !== scene, { timeout: 5000 }).toBe(true)
    await settled(engine)
    on = false
    expect(blank).toBe(0)
  })

  it('keeps a fitted view fitted as the diagram grows', async () => {
    const { engine, edit } = await mount()
    const scene = engine().scene
    edit('phones -> gateway', 'node cache "Cache" { tier: data }\ngateway -> cache\nphones -> gateway')
    await expect.poll(() => engine().scene !== scene, { timeout: 5000 }).toBe(true)
    await settled(engine)
    const viewer = engine().viewer!
    expect(viewer.readerView).toBeNull()
    expect(viewer.shownView()).toEqual(viewer.fit())
  })

  it('starts a whole new text fitted once it compiles, though it came with an error', async () => {
    const { handle, engine, edit } = await mount()
    const first = engine()
    first.viewer!.setView({ x: 100, y: 100, k: 3 })
    handle.setSource(alerts.replace('title:', 'title '))
    await expect.poll(() => document.querySelector('.lme-preview')!.hasAttribute('data-stale')).toBe(true)
    edit('title ', 'title:')
    await expect.poll(() => handle.loadmap()?.engine !== first, { timeout: 5000 }).toBe(true)
    await handle.loadmap()!.ready()
    await expect.poll(() => engine().viewer?.shownView()).toBeTruthy()
    expect(engine().viewer!.readerView).toBeNull()
  })

  it('starts a whole new text fitted, whatever the reader had zoomed', async () => {
    const { handle, engine } = await mount()
    const first = engine()
    first.viewer!.setView({ x: 100, y: 100, k: 3 })
    handle.setSource(alerts)
    await expect.poll(() => handle.loadmap()?.engine !== first, { timeout: 5000 }).toBe(true)
    await handle.loadmap()!.ready()
    await expect.poll(() => engine().viewer?.shownView()).toBeTruthy()
    const viewer = engine().viewer!
    expect(viewer.readerView).toBeNull()
    expect(viewer.shownView()).toEqual(viewer.fit())
  })

  it('leaves the view where it is for a change out of view, with tracking off', async () => {
    const { host, engine, edit } = await mount()
    closeOnPhones(engine())
    const was = engine().viewer!.shownView()!
    const scene = engine().scene
    edit('estimated(4_000 ± 30%', 'estimated(2_000 ± 30%')
    await expect.poll(() => engine().scene !== scene, { timeout: 5000 }).toBe(true)
    await settled(engine)
    await new Promise((r) => setTimeout(r, 900))
    expect(engine().viewer!.shownView()).toEqual(was)
    expect(host.querySelector('[data-changed]')).toBeNull()
  })

  it('tracks live changes: brings the box an edit changed into view, no closer, and marks it', async () => {
    const { host, engine, edit } = await mount({ track: true })
    closeOnPhones(engine())
    edit('estimated(4_000 ± 30%', 'estimated(2_000 ± 30%')
    await expect.poll(() => host.querySelector('[data-node="db"][data-changed]'), { timeout: 5000 }).toBeTruthy()
    await expect.poll(() => inView(engine(), 'db'), { timeout: 5000 }).toBe(true)
    expect(engine().viewer!.shownView()!.k).toBeLessThanOrEqual(2)
    // only what changed is marked, and the mark goes
    expect(host.querySelectorAll('[data-changed]')).toHaveLength(1)
    await expect.poll(() => host.querySelector('[data-changed]'), { timeout: 5000 }).toBeNull()
  })

  it('brings a new box into view', async () => {
    const { engine, edit } = await mount({ track: true })
    closeOnPhones(engine())
    edit('phones -> gateway', 'node cache "Cache" { tier: data }\nworkers -> cache\nphones -> gateway')
    await expect.poll(() => engine().frame!.nodes.some((n) => n.id === 'cache'), { timeout: 5000 }).toBe(true)
    await expect.poll(() => inView(engine(), 'cache'), { timeout: 5000 }).toBe(true)
  })

  it('follows only the edits made while tracking is on', async () => {
    const { host, engine, edit } = await mount()
    const gateway = engine().scene
    edit('"API gateway"', '"API gateway, edge"')
    await expect.poll(() => engine().scene !== gateway, { timeout: 5000 }).toBe(true)
    await settled(engine)
    await page.getByRole('button', { name: 'Track live changes' }).click()
    closeOnPhones(engine())
    edit('estimated(4_000 ± 30%', 'estimated(2_000 ± 30%')
    await expect.poll(() => host.querySelector('[data-node="db"][data-changed]'), { timeout: 5000 }).toBeTruthy()
    expect([...host.querySelectorAll('[data-changed]')].map((el) => el.getAttribute('data-node'))).toEqual(['db'])
  })

  it('turns tracking on and off from the code panel, and tells the page', async () => {
    const said: boolean[] = []
    const { host } = await mount({ onTrack: (on) => said.push(on) })
    const button = page.getByRole('button', { name: 'Track live changes' })
    await expect.element(button).toHaveAttribute('aria-pressed', 'false')
    await button.click()
    await expect.element(button).toHaveAttribute('aria-pressed', 'true')
    await button.click()
    expect(said).toEqual([true, false])
    root!.unmount()
    host.remove()
    await mount({ track: true })
    await expect
      .element(page.getByRole('button', { name: 'Track live changes' }))
      .toHaveAttribute('aria-pressed', 'true')
  })
})
