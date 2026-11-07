import { composeFrame } from '@loadmap/export'
import { Diagram, handleOf, Loadmap, type LoadmapHandle, LoadmapRoot, useLoadmap } from '@loadmap/react'
import { createRef, type Ref, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { watchDots } from '../dots'
import { checkout } from './model'
import { view } from './view'

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  root?.unmount()
  host?.remove()
  root = null
  host = null
})

/** A page with the checkout board the reader pans and zooms; every box click is counted. */
async function mount() {
  await page.viewport(1280, 900)
  host = document.createElement('div')
  document.body.appendChild(host)
  const ref = createRef<LoadmapHandle>()
  const clicks: string[] = []
  root = createRoot(host)
  root.render(<Loadmap ref={ref} model={checkout} view={view} speed={10} zoom onNodeClick={(id) => clicks.push(id)} />)
  await expect.poll(() => ref.current).toBeTruthy()
  await ref.current!.ready()
  const el = host.querySelector<HTMLElement>('.lm')!
  // the hands and the buttons come with a chunk of their own
  await expect.poll(() => el.querySelector('.lm-zoom') && ref.current!.engine.viewer, { timeout: 5000 }).toBeTruthy()
  const board = el.querySelector<HTMLElement>('.lm-board')!
  await settled(ref.current!, board)
  return { handle: ref.current!, el, clicks, board }
}

/** A canvas 1000 × 600 with 300 px floating over its left and 200 px over its right. */
function Canvas({ ref, left = 300 }: { ref: Ref<LoadmapHandle>; left?: number }) {
  const lm = useLoadmap(checkout, view, { speed: 10 })
  useImperativeHandle(ref, () => handleOf(lm), [lm])
  return (
    <LoadmapRoot lm={lm}>
      <Diagram lm={lm} canvas={{ left, right: 200 }} />
    </LoadmapRoot>
  )
}

async function mountCanvas() {
  await page.viewport(1280, 900)
  host = document.createElement('div')
  host.style.cssText = 'position: fixed; top: 0; left: 0; width: 1000px; height: 600px'
  document.body.appendChild(host)
  const ref = createRef<LoadmapHandle>()
  root = createRoot(host)
  root.render(<Canvas ref={ref} />)
  await expect.poll(() => ref.current).toBeTruthy()
  await ref.current!.ready()
  const el = host.querySelector<HTMLElement>('.lm')!
  el.style.cssText = 'height: 100%; padding: 0; box-sizing: border-box'
  await expect.poll(() => el.querySelector('.lm-zoom') && ref.current!.engine.viewer, { timeout: 5000 }).toBeTruthy()
  const board = el.querySelector<HTMLElement>('.lm-board')!
  await settled(ref.current!, board)
  return { handle: ref.current!, el, board, ref }
}

/** The view knows the board at its size: the first layout grows it, and the board measures again a frame later. */
async function settled(handle: LoadmapHandle, board: HTMLElement) {
  await expect
    .poll(() => {
      const vp = handle.engine.viewer?.viewport
      const r = board.getBoundingClientRect()
      return (
        !!vp && Math.abs(vp.h - (r.height - 2 * board.clientTop)) < 0.5 && board.querySelector('canvas')!.width > 300
      )
    })
    .toBe(true)
}

const viewBox = (board: HTMLElement) => board.querySelector('svg')!.getAttribute('viewBox')
const button = (el: HTMLElement, name: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('.lm-zoom button')].find(
    (b) => b.getAttribute('aria-label') === name || b.textContent === name,
  )!

/** A press, a move by (dx, dy) in steps, and a release, as a mouse makes them; then the click a browser sends. */
function drag(target: Element, board: HTMLElement, dx: number, dy: number) {
  const r = target.getBoundingClientRect()
  const x = r.left + r.width / 2
  const y = r.top + r.height / 2
  const o = { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true }
  target.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: x, clientY: y, button: 0, buttons: 1 }))
  for (let i = 1; i <= 5; i++)
    board.dispatchEvent(
      new PointerEvent('pointermove', { ...o, clientX: x + (dx * i) / 5, clientY: y + (dy * i) / 5, buttons: 1 }),
    )
  board.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: x + dx, clientY: y + dy, button: 0 }))
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x + dx, clientY: y + dy }))
}

function wheel(board: HTMLElement, deltaY: number, o: { ctrlKey?: boolean; at?: { x: number; y: number } } = {}) {
  const r = board.getBoundingClientRect()
  const at = o.at ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  const e = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY,
    clientX: at.x,
    clientY: at.y,
    ctrlKey: !!o.ctrlKey,
  })
  board.dispatchEvent(e)
  return e
}

/** Each box's rectangle on the screen. */
const boxes = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-node] > rect:first-of-type, [data-node] > path:first-of-type')].map((b) =>
    b.getBoundingClientRect(),
  )

describe('pan and zoom on a page', () => {
  it('zooms with Ctrl and the wheel about the pointer, and leaves the plain wheel to the page', async () => {
    const { board, el } = await mount()
    const fitted = viewBox(board)
    const plain = wheel(board, -100)
    expect(plain.defaultPrevented).toBe(false)
    expect(viewBox(board)).toBe(fitted)
    const r = board.getBoundingClientRect()
    const at = { x: r.left + r.width * 0.3, y: r.top + r.height * 0.4 }
    const svg = board.querySelector('svg')!
    // the scene point under the pointer stays under it, to half a pixel
    const under = new DOMPoint(at.x, at.y).matrixTransform(svg.getScreenCTM()!.inverse())
    expect(wheel(board, -100, { ctrlKey: true, at }).defaultPrevented).toBe(true)
    expect(viewBox(board)).not.toBe(fitted)
    const now = under.matrixTransform(svg.getScreenCTM()!)
    expect(Math.abs(now.x - at.x)).toBeLessThan(0.5)
    expect(Math.abs(now.y - at.y)).toBeLessThan(0.5)
    // a notch of a mouse wheel is a step, not a leap to the closest
    const k = Number.parseInt(button(el, 'Zoom to 100 %').textContent!, 10)
    expect(k).toBeGreaterThan(0)
    expect(k).toBeLessThan(400)
  })

  it('pans with a drag, and a drag that starts on a box is no click on it', async () => {
    const { board, clicks } = await mount()
    wheel(board, -300, { ctrlKey: true })
    const zoomed = viewBox(board)!.split(' ').map(Number)
    const gateway = board.querySelector('[data-node="gateway"]')!
    drag(gateway, board, -60, -30)
    const panned = viewBox(board)!.split(' ').map(Number)
    // the scene follows the pointer: the view moves the other way
    expect(panned[0]).toBeGreaterThan(zoomed[0]!)
    expect(panned[1]).toBeGreaterThan(zoomed[1]!)
    expect(clicks).toEqual([])
    expect(board.hasAttribute('data-panning')).toBe(false)
    // a click without a drag still is one
    await userEvent.click(board.querySelector<SVGGElement>('[data-node="gateway"]')!)
    expect(clicks).toEqual(['gateway'])
  })

  it('zooms with the buttons and the keys, and Fit puts the whole diagram back', async () => {
    const { board, el, handle } = await mount()
    const fitted = viewBox(board)
    // fitted, it shows the whole scene
    const [x, y, w, h] = fitted!.split(' ').map(Number)
    const { width, height } = handle.engine.frame!
    expect(x! <= 1e-6 && y! <= 1e-6 && x! + w! >= width - 1e-6 && y! + h! >= height - 1e-6).toBe(true)
    button(el, 'Zoom in').click()
    await expect.poll(() => viewBox(board)).not.toBe(fitted)
    board.focus()
    await userEvent.keyboard('0')
    await expect.poll(() => viewBox(board)).toBe(fitted)
    expect(handle.engine.viewer!.readerView).toBeNull()
    await userEvent.keyboard('+')
    await expect.poll(() => handle.engine.viewer!.readerView).not.toBeNull()
    button(el, 'Fit').click()
    await expect.poll(() => handle.engine.viewer!.readerView).toBeNull()
  })

  it('jumps without a flight with reduced motion', async () => {
    const { board, el, handle } = await mount()
    handle.engine.reducedMotion = true
    const fitted = viewBox(board)
    button(el, 'Zoom in').click()
    // no frame later: at once
    expect(viewBox(board)).not.toBe(fitted)
    button(el, 'Fit').click()
    expect(viewBox(board)).toBe(fitted)
  })

  it('keeps the dots where the SVG draws their places at any zoom', async () => {
    const { board, handle } = await mount()
    wheel(board, -400, { ctrlKey: true })
    const svg = board.querySelector('svg')!
    const canvas = board.querySelector('canvas')!
    const vp = handle.engine.viewer!.viewport
    const p = handle.engine.viewer!.placement()!
    const ctm = svg.getScreenCTM()!
    const r = canvas.getBoundingClientRect()
    // the scene point (500, 100), drawn by the SVG and by the dots' canvas, lands on the same screen pixel
    const viaSvg = new DOMPoint(500, 100).matrixTransform(ctm)
    expect(r.left + ((p.dx + 500 * p.k) * r.width) / vp.w).toBeCloseTo(viaSvg.x, 1)
    expect(r.top + ((p.dy + 100 * p.k) * r.height) / vp.h).toBeCloseTo(viaSvg.y, 1)
  })

  it('makes the same picture zoomed in as fitted: the reader’s view is no part of a file', async () => {
    const { board, handle } = await mount()
    handle.pause()
    handle.reset(7)
    handle.step(1)
    const hash = async () => {
      const c = await composeFrame(handle, { scale: 1 })
      const d = await crypto.subtle.digest('SHA-256', c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data)
      return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
    }
    const fitted = await hash()
    wheel(board, -500, { ctrlKey: true })
    drag(board, board, 80, 40)
    expect(handle.engine.viewer!.readerView).not.toBeNull()
    expect(await hash()).toBe(fitted)
  })

  it('flies from the reader’s view into the story, and a drag while it plays stops it where it is', async () => {
    const { board, el, handle } = await mount()
    wheel(board, -300, { ctrlKey: true })
    const zoomed = viewBox(board)
    handle.playStory()
    // the first shot starts where the reader was, and the reader's view is gone: the story ends fitted
    expect(handle.engine.viewer!.readerView).toBeNull()
    const first = viewBox(board)!.split(' ').map(Number)
    for (const [i, v] of zoomed!.split(' ').entries()) expect(first[i]).toBeCloseTo(Number(v), 6)
    handle.step(0.1)
    expect(viewBox(board)).not.toBe(zoomed)
    handle.step(2)
    expect(handle.engine.playing).toBe(true)
    drag(board, board, 50, 0)
    expect(handle.engine.playing).toBe(false)
    expect(handle.engine.viewer!.readerView).not.toBeNull()
    await expect.poll(() => el.querySelector('.lm-story button')?.textContent).toContain('Play')
  })
})

describe('a canvas', () => {
  it('fits the whole diagram in what the insets leave, and the page never scrolls', async () => {
    const { el } = await mountCanvas()
    for (const b of boxes(el)) {
      expect(b.left).toBeGreaterThanOrEqual(300)
      expect(b.right).toBeLessThanOrEqual(800)
      expect(b.top).toBeGreaterThanOrEqual(0)
      expect(b.bottom).toBeLessThanOrEqual(600)
    }
    expect(document.scrollingElement!.scrollHeight).toBeLessThanOrEqual(innerHeight)
    // no Full screen: the canvas is the page's
    expect([...el.querySelectorAll('button')].some((b) => b.textContent?.includes('Full screen'))).toBe(false)
  })

  it('keeps the reader’s view when what floats over it changes, and fits the new room while it has none', async () => {
    const { handle, ref } = await mountCanvas()
    const fit = handle.engine.viewer!.fit()!
    root!.render(<Canvas ref={ref} left={100} />)
    await expect.poll(() => handle.engine.viewer!.viewport.inset.left).toBe(100)
    // fitted, it follows the room
    expect(handle.engine.viewer!.fit()!.k).toBeGreaterThan(fit.k)
    expect(handle.engine.viewer!.readerView).toBeNull()
    handle.engine.viewer!.setView({ ...handle.engine.viewer!.fit()!, k: 2 })
    const mine = handle.engine.viewer!.readerView
    root!.render(<Canvas ref={ref} left={300} />)
    await expect.poll(() => handle.engine.viewer!.viewport.inset.left).toBe(300)
    expect(handle.engine.viewer!.readerView).toEqual(mine)
  })

  it('brings a box the keyboard reaches into view', async () => {
    const { board, handle } = await mountCanvas()
    // close in on the left end: the database on the right is out of view
    const fit = handle.engine.viewer!.fit()!
    handle.engine.viewer!.setView({ x: 0, y: fit.y, k: 3 })
    const db = board.querySelector<SVGGElement>('[data-node="db"]')!
    const out = () => {
      const r = db.getBoundingClientRect()
      return r.left > 800 || r.right < 300
    }
    expect(out()).toBe(true)
    board.focus()
    // Tab walks the boxes; the database is the last
    for (let i = 0; i < 10 && document.activeElement !== db; i++) await userEvent.tab()
    expect(document.activeElement).toBe(db)
    await expect.poll(out).toBe(false)
  })

  it('zooms with the wheel alone, and keeps the diagram in sight however far it is dragged', async () => {
    const { board, handle } = await mountCanvas()
    const fitted = viewBox(board)
    expect(wheel(board, -100).defaultPrevented).toBe(true)
    expect(viewBox(board)).not.toBe(fitted)
    drag(board, board, 5000, 5000)
    // the scene's corner, its first 64 px still in sight, clear of the 200 px floating over the right
    const corner = new DOMPoint(0, 0).matrixTransform(board.querySelector('svg')!.getScreenCTM()!)
    expect(corner.x).toBeCloseTo(800 - 64, 0)
    expect(corner.y).toBeCloseTo(600 - 64, 0)
    expect(handle.engine.viewer!.readerView).not.toBeNull()
  })
})

describe('the dots’ canvas', () => {
  /** A board in a host styled `css`, its root filling the host from the first render; zooming or not. */
  async function sized(css: string, zoom: boolean) {
    host = document.createElement('div')
    host.style.cssText = css
    host.innerHTML =
      '<style>.lm { height: 100%; padding: 0; box-sizing: border-box }</style><div style="height: 100%"></div>'
    document.body.appendChild(host)
    const ref = createRef<LoadmapHandle>()
    root = createRoot(host.lastElementChild!)
    root.render(zoom ? <Canvas ref={ref} /> : <Loadmap ref={ref} model={checkout} view={view} speed={10} />)
    await expect.poll(() => ref.current).toBeTruthy()
    await ref.current!.ready()
    return watchDots(host.querySelector('canvas')!)
  }
  const sharp = { pixels: true, round: true }

  // a canvas has its size before its first layout, and never changes it after: the editor's
  it('has a pixel for each of the screen’s on a canvas sized before its first layout', async () => {
    await page.viewport(1280, 900)
    const dots = await sized('position: fixed; inset: 0 auto auto 0; width: 1000px; height: 600px', true)
    await expect.poll(dots, { timeout: 5000 }).toEqual(sharp)
  })

  it('follows the window, and a container that gets its size late', async () => {
    await page.viewport(1280, 900)
    const dots = await sized('position: fixed; inset: 0 auto auto 0; width: 80vw; height: 0', true)
    host!.style.height = '600px'
    await expect.poll(dots, { timeout: 5000 }).toEqual(sharp)
    await page.viewport(900, 700)
    await expect.poll(() => host!.querySelector('canvas')!.width).toBe(Math.round(720 * devicePixelRatio))
    await expect.poll(dots).toEqual(sharp)
  })

  it('follows a board that does not zoom, as its page narrows', async () => {
    await page.viewport(1280, 900)
    const dots = await sized('width: 900px', false)
    await expect.poll(dots, { timeout: 5000 }).toEqual(sharp)
    host!.style.width = '500px'
    await expect.poll(dots).toEqual(sharp)
  })

  // a ratio of this frame alone: Chromium's emulated one would reach every test file in the tab
  it('has a pixel for each of the screen’s on a dense one, past twice', async () => {
    await page.viewport(1280, 900)
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true })
    try {
      const dots = await sized('position: fixed; inset: 0 auto auto 0; width: 1000px; height: 600px', true)
      await expect.poll(() => host!.querySelector('canvas')!.width, { timeout: 5000 }).toBe(3000)
      await expect.poll(dots).toEqual(sharp)
    } finally {
      delete (window as { devicePixelRatio?: number }).devicePixelRatio
    }
  })
})
