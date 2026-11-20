import { handleOf, type LoadmapController, type LoadmapHandle, LoadmapRoot, useLoadmap } from '@loadmap/react'
import { useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
// not exported yet: `<Loadmap>` becomes this frame once its panels and its story are in it
import { Frame } from '../../packages/react/src/frame'
import { checkout } from './model'
import { view } from './view'

let root: Root | null = null
let host: HTMLDivElement | null = null
let handle: LoadmapHandle | null = null
let ctl: LoadmapController | null = null

function Page({ height, fill = false }: { height: number; fill?: boolean }) {
  const lm = useLoadmap(checkout, view, { fill })
  useEffect(() => {
    handle = handleOf(lm)
    ctl = lm
  }, [lm])
  return (
    <LoadmapRoot lm={lm}>
      <Frame lm={lm} style={fill ? undefined : { height }} />
    </LoadmapRoot>
  )
}

afterEach(() => {
  root?.unmount()
  host?.remove()
  root = null
  host = null
  handle = null
  ctl = null
})

const frames = async (n = 2) => {
  for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r))
}

async function mount(width: number, height: number, fill = false) {
  await page.viewport(1600, 1000)
  host = document.createElement('div')
  host.style.width = `${width}px`
  // a root that fills its frame stands for full screen: the frame gives the height
  if (fill) host.style.height = `${height}px`
  document.body.appendChild(host)
  root = createRoot(host)
  root.render(<Page height={height} fill={fill} />)
  await expect.poll(() => host!.querySelector('[data-node]'), { timeout: 5000 }).not.toBeNull()
  await expect.poll(() => handle?.engine.room ?? null, { timeout: 5000 }).not.toBeNull()
  await handle!.ready()
  await frames()
  return host.querySelector<HTMLElement>('.lm-canvas')!
}

const high = (el: Element | null) => el!.getBoundingClientRect().height
const sizes = (canvas: HTMLElement) => ({
  canvas: high(canvas),
  bar: high(canvas.querySelector('.lm-canvas-bar')),
  console: high(canvas.querySelector('.lm-canvas-console')),
})

describe('a loadmap in one canvas', () => {
  it('shows the title, the scenarios and the legend over the diagram, the load and the verdict under it', async () => {
    const canvas = await mount(1200, 560)
    expect(canvas.dataset.width).toBe('wide')
    const bar = canvas.querySelector('.lm-canvas-bar')!
    expect(bar.querySelector('h2')!.textContent).toBe('Checkout pipeline')
    expect([...bar.querySelectorAll('.lm-scenarios button')].map((b) => b.textContent)).toEqual(['Today', 'Proposed'])
    expect(bar.querySelector('.lm-legend')!.textContent).toContain('orders')
    const cons = canvas.querySelector('.lm-canvas-console')!
    expect(cons.querySelector('input[type="range"]')).not.toBeNull()
    expect(cons.querySelector('.lm-headline')!.textContent).toContain('limited by')
    // the diagram keeps clear of both
    const board = [...canvas.querySelectorAll('[data-node]')].map((n) => n.getBoundingClientRect())
    expect(Math.min(...board.map((r) => r.top))).toBeGreaterThanOrEqual(bar.getBoundingClientRect().bottom)
    expect(Math.max(...board.map((r) => r.bottom))).toBeLessThanOrEqual(cons.getBoundingClientRect().top)
    await page.screenshot({ path: '__screenshots__/frame-wide.png', element: host! })
  })

  for (const [width, height] of [
    [1200, 560],
    [700, 500],
    [360, 560],
    [800, 320],
  ] as const)
    it(`keeps its bars and its room at ${width}×${height}, whatever the load and the scenario`, async () => {
      const canvas = await mount(width, height)
      const before = sizes(canvas)
      const room = handle!.engine.room
      expect(before.canvas).toBe(height)
      for (const load of [checkout.load.min, 7.4, 14, checkout.load.max]) {
        handle!.setValues({ load })
        await handle!.ready()
        await frames()
        expect(sizes(canvas), `at ${load}×`).toEqual(before)
      }
      // a value of the reader's own: no scenario is on, and the bar says so in the same row
      handle!.setValues({ pods: 4 })
      await handle!.ready()
      await frames()
      expect(sizes(canvas)).toEqual(before)
      ctl!.setScenario('Proposed')
      await handle!.ready()
      await frames()
      expect(sizes(canvas)).toEqual(before)
      expect(handle!.engine.room).toBe(room)
      // nothing of the canvas reaches past its box
      expect(canvas.scrollWidth).toBeLessThanOrEqual(canvas.clientWidth)
      expect(canvas.scrollHeight).toBeLessThanOrEqual(canvas.clientHeight)
    })

  it('folds the scenarios into one control on a narrow canvas, and leaves the legend out', async () => {
    const canvas = await mount(360, 560)
    expect(canvas.dataset.width).toBe('compact')
    expect(canvas.querySelector('.lm-scenarios')).toBeNull()
    expect(canvas.querySelector('.lm-legend')).toBeNull()
    const pick = canvas.querySelector<HTMLSelectElement>('select.lm-canvas-pick')!
    expect(pick.getAttribute('aria-label')).toBe('Scenario')
    expect(pick.value).toBe('Today')
    pick.value = 'Proposed'
    pick.dispatchEvent(new Event('change', { bubbles: true }))
    await expect.poll(() => handle!.values().pods, { timeout: 5000 }).toBe(6)
    // a value of the reader's own is named, and picking a scenario again drops it
    handle!.setValues({ pods: 4 })
    await expect.poll(() => pick.value, { timeout: 5000 }).toBe('')
    expect(pick.selectedOptions[0]!.textContent).toBe('your own values')
    await page.screenshot({ path: '__screenshots__/frame-compact.png', element: host! })
  })

  it('is one row over and one under the diagram on a low canvas, the load beside the verdict', async () => {
    const canvas = await mount(800, 320)
    expect(canvas.dataset.short).toBe('')
    // the slider keeps its name, unseen
    const input = canvas.querySelector<HTMLInputElement>('.lm-load input')!
    expect(input.labels![0]!.textContent).toBe(checkout.load.label)
    expect(input.labels![0]!.getBoundingClientRect().width).toBeLessThanOrEqual(1)
    const load = canvas.querySelector('.lm-canvas-console .lm-load')!.getBoundingClientRect()
    const verdict = canvas.querySelector('.lm-canvas-verdict')!.getBoundingClientRect()
    expect(verdict.left).toBeGreaterThanOrEqual(load.right)
    expect(high(canvas.querySelector('.lm-canvas-console'))).toBeLessThan(70)
    await page.screenshot({ path: '__screenshots__/frame-short.png', element: host! })
  })

  const tab = (canvas: HTMLElement, name: string) =>
    [...canvas.querySelectorAll<HTMLButtonElement>('.lm-canvas-tabs button')].find((b) => b.textContent === name)!
  const panel = (canvas: HTMLElement) => canvas.querySelector<HTMLElement>('.lm-canvas-panel')

  it('opens one panel at a time from its tabs, beside the diagram, without laying the diagram out again', async () => {
    const canvas = await mount(1200, 560)
    const tabs = canvas.querySelector('.lm-canvas-tabs')!
    expect(tabs.getAttribute('role')).toBe('toolbar')
    expect([...tabs.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Limits',
      'Design',
      'Headroom',
      'Live',
      'Assumes',
    ])
    expect(panel(canvas)).toBeNull()
    const before = sizes(canvas)
    const room = handle!.engine.room
    const scene = handle!.engine.scene
    tab(canvas, 'Limits').click()
    // its content comes with the first panel opened
    await expect.poll(() => canvas.querySelector('.lm-canvas-panel .lm-limits'), { timeout: 5000 }).not.toBeNull()
    expect(panel(canvas)!.dataset.place).toBe('side')
    expect(tab(canvas, 'Limits').getAttribute('aria-expanded')).toBe('true')
    expect(tab(canvas, 'Limits').getAttribute('aria-controls')).toBe(panel(canvas)!.id)
    await frames()
    expect(sizes(canvas)).toEqual(before)
    expect(handle!.engine.room).toBe(room)
    expect(handle!.engine.scene).toBe(scene)
    // between the bars, and the diagram's boxes clear of it
    await Promise.all(
      panel(canvas)!
        .getAnimations()
        .map((x) => x.finished),
    )
    const box = panel(canvas)!.getBoundingClientRect()
    expect(box.top).toBeGreaterThanOrEqual(canvas.querySelector('.lm-canvas-bar')!.getBoundingClientRect().bottom - 1)
    expect(box.bottom).toBeLessThanOrEqual(canvas.querySelector('.lm-canvas-console')!.getBoundingClientRect().top + 1)
    await expect
      .poll(
        () => Math.max(...[...canvas.querySelectorAll('[data-node]')].map((n) => n.getBoundingClientRect().right)),
        {
          timeout: 5000,
        },
      )
      .toBeLessThanOrEqual(box.left)
    await page.screenshot({ path: '__screenshots__/frame-panel-side.png', element: host! })
    // another tab takes its place
    tab(canvas, 'Design').click()
    await expect.poll(() => canvas.querySelector('.lm-canvas-panel .lm-controls'), { timeout: 5000 }).not.toBeNull()
    expect(canvas.querySelectorAll('.lm-canvas-panel').length).toBe(1)
    expect(tab(canvas, 'Limits').getAttribute('aria-expanded')).toBe('false')
    // Escape in the panel closes it and gives the keyboard back to its tab
    panel(canvas)!.focus()
    panel(canvas)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await expect.poll(() => panel(canvas), { timeout: 5000 }).toBeNull()
    expect(document.activeElement).toBe(tab(canvas, 'Design'))
    // and a tab closes the panel it opened
    tab(canvas, 'Live').click()
    await expect.poll(() => panel(canvas)?.dataset.panel, { timeout: 5000 }).toBe('live')
    tab(canvas, 'Live').click()
    await expect.poll(() => panel(canvas), { timeout: 5000 }).toBeNull()
    expect(handle!.engine.room).toBe(room)
  })

  it('opens the limits from "Why" and the assumptions from their count, on a wide canvas', async () => {
    const canvas = await mount(1200, 560)
    const links = [...canvas.querySelectorAll<HTMLButtonElement>('.lm-canvas-verdict .lm-link')]
    expect(links.map((l) => l.textContent!.replace(/ ·.*/, ''))).toEqual(['Why ›', 'What this assumes'])
    links[0]!.click()
    await expect.poll(() => panel(canvas)?.dataset.panel, { timeout: 5000 }).toBe('limits')
    links[1]!.click()
    await expect.poll(() => panel(canvas)?.dataset.panel, { timeout: 5000 }).toBe('assumptions')
    // closed, the keyboard is back on the link that opened it
    canvas.querySelector<HTMLButtonElement>('.lm-canvas-panel-head button')!.click()
    await expect.poll(() => panel(canvas), { timeout: 5000 }).toBeNull()
    expect(document.activeElement).toBe(links[1])
  })

  it('stands the panel as a sheet on the console of a narrow canvas, half or whole', async () => {
    const canvas = await mount(360, 560)
    const before = sizes(canvas)
    const room = handle!.engine.room
    tab(canvas, 'Design').click()
    await expect.poll(() => canvas.querySelector('.lm-canvas-panel .lm-controls'), { timeout: 5000 }).not.toBeNull()
    expect(panel(canvas)!.dataset.place).toBe('sheet')
    const tabsTop = canvas.querySelector('.lm-canvas-tabs')!.getBoundingClientRect().top
    // the load and the verdict stay in view under it, once it has slid in
    await expect
      .poll(() => panel(canvas)!.getBoundingClientRect().bottom, { timeout: 5000 })
      .toBeLessThanOrEqual(tabsTop + 1)
    const half = panel(canvas)!.getBoundingClientRect()
    await page.screenshot({ path: '__screenshots__/frame-panel-sheet.png', element: host! })
    const whole = [...canvas.querySelectorAll<HTMLButtonElement>('.lm-canvas-panel-head button')].find(
      (b) => b.textContent === 'Whole',
    )!
    whole.click()
    await expect
      .poll(() => panel(canvas)!.getBoundingClientRect().height, { timeout: 5000 })
      .toBeGreaterThan(half.height)
    const all = panel(canvas)!.getBoundingClientRect()
    expect(all.bottom).toBeLessThanOrEqual(tabsTop + 1)
    expect(all.top).toBeGreaterThanOrEqual(canvas.querySelector('.lm-canvas-bar')!.getBoundingClientRect().bottom - 1)
    await frames()
    expect(sizes(canvas)).toEqual(before)
    expect(handle!.engine.room).toBe(room)
  })

  it('has one menu for the panels on a low canvas', async () => {
    const canvas = await mount(800, 320)
    expect(canvas.querySelector('.lm-canvas-tabs')).toBeNull()
    const menu = canvas.querySelector<HTMLSelectElement>('select.lm-canvas-menu')!
    expect(menu.getAttribute('aria-label')).toBe('Open a panel')
    menu.value = 'limits'
    menu.dispatchEvent(new Event('change', { bubbles: true }))
    await expect.poll(() => panel(canvas)?.dataset.panel, { timeout: 5000 }).toBe('limits')
    expect(panel(canvas)!.dataset.place).toBe('side')
    menu.value = ''
    menu.dispatchEvent(new Event('change', { bubbles: true }))
    await expect.poll(() => panel(canvas), { timeout: 5000 }).toBeNull()
  })

  it('keeps a panel open beside the diagram in a wide full screen, its slot out of the room from the start', async () => {
    const canvas = await mount(1400, 800, true)
    expect(canvas.dataset.pinned).toBe('')
    await expect.poll(() => panel(canvas)?.dataset.panel, { timeout: 5000 }).toBe('limits')
    const room = handle!.engine.room
    // nothing closes it: its tabs only change what it holds
    expect(canvas.querySelector('.lm-canvas-panel-head button')).toBeNull()
    tab(canvas, 'Limits').click()
    await frames()
    expect(panel(canvas)?.dataset.panel).toBe('limits')
    tab(canvas, 'Headroom').click()
    await expect.poll(() => canvas.querySelector('.lm-canvas-panel .lm-headroom'), { timeout: 5000 }).not.toBeNull()
    await frames()
    expect(handle!.engine.room).toBe(room)
    const boxes = [...canvas.querySelectorAll('[data-node]')].map((n) => n.getBoundingClientRect().right)
    expect(Math.max(...boxes)).toBeLessThanOrEqual(panel(canvas)!.getBoundingClientRect().left)
    await page.screenshot({ path: '__screenshots__/frame-panel-pinned.png', element: host! })
  })

  it('gives its top to the story while one shows: the text over the bar, the panels away, the same room', async () => {
    const canvas = await mount(1200, 560)
    tab(canvas, 'Limits').click()
    await expect.poll(() => panel(canvas)?.dataset.panel, { timeout: 5000 }).toBe('limits')
    const before = sizes(canvas)
    const room = handle!.engine.room
    const play = canvas.querySelector<HTMLButtonElement>('.lm-canvas-play')!
    expect(play.textContent).toBe('▶ Story')
    play.focus()
    play.click()
    const story = () => canvas.querySelector<HTMLElement>('.lm-canvas-over .lm-story')
    await expect.poll(story, { timeout: 5000 }).not.toBeNull()
    // the keyboard is in the story, where the arrows step it; the bar under it is out of reach
    await expect.poll(() => document.activeElement, { timeout: 5000 }).toBe(story())
    expect(canvas.querySelector('.lm-canvas-bar')!.hasAttribute('inert')).toBe(true)
    expect(canvas.querySelector('.lm-canvas-tabs')).toBeNull()
    // the open panel is kept, unseen
    expect(panel(canvas)!.hidden).toBe(true)
    expect(canvas.querySelector('.lm-canvas-verdict .lm-link')).toBeNull()
    // a step by hand, so the test does not wait on the story's clock
    ctl!.setStoryPlaying(false)
    ctl!.setStep(1)
    await expect.poll(() => story()?.textContent, { timeout: 5000 }).toContain('2 of 3')
    await handle!.ready()
    await frames()
    expect(sizes(canvas)).toEqual(before)
    expect(handle!.engine.room).toBe(room)
    // the load and the verdict stay under it
    expect(canvas.querySelector('.lm-canvas-console input[type="range"]')).not.toBeNull()
    await page.screenshot({ path: '__screenshots__/frame-story.png', element: host! })
    canvas.querySelector<HTMLButtonElement>('button[aria-label="Leave the story"]')!.click()
    await expect.poll(story, { timeout: 5000 }).toBeNull()
    // everything is back as it was, the keyboard on the button that started it
    expect(canvas.querySelector('.lm-canvas-tabs')).not.toBeNull()
    expect(panel(canvas)!.dataset.panel).toBe('limits')
    expect(panel(canvas)!.hidden).toBe(false)
    await expect.poll(() => document.activeElement, { timeout: 5000 }).toBe(play)
    expect(sizes(canvas)).toEqual(before)
    expect(handle!.engine.room).toBe(room)
  })

  const wheel = (board: Element, ctrlKey = false) => {
    const e = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true, ctrlKey })
    board.dispatchEvent(e)
    return e.defaultPrevented
  }

  it('leaves the page its wheel and its one finger while it lies in a page', async () => {
    const canvas = await mount(1200, 560)
    const board = canvas.querySelector<HTMLElement>('.lm-board')!
    await expect.poll(() => board.style.touchAction, { timeout: 5000 }).toBe('pan-x pan-y')
    const k = handle!.engine.viewer!.shownView()!.k
    // the plain wheel scrolls the page; with Ctrl (a trackpad's pinch too) it zooms the diagram
    expect(wheel(board)).toBe(false)
    expect(handle!.engine.viewer!.shownView()!.k).toBe(k)
    expect(wheel(board, true)).toBe(true)
    expect(handle!.engine.viewer!.shownView()!.k).toBeGreaterThan(k)
    // zoomed or not, one finger stays the page's
    expect(board.style.touchAction).toBe('pan-x pan-y')
  })

  it('leaves the wheel to the page around a frame it fills, and takes it in full screen', async () => {
    const canvas = await mount(1100, 700, true)
    const board = canvas.querySelector<HTMLElement>('.lm-board')!
    // a root that fills a frame of a page (an embed) is still in that page
    await expect.poll(() => board.style.touchAction, { timeout: 5000 }).toBe('pan-x pan-y')
    expect(wheel(board)).toBe(false)
  })

  it('takes the wheel and one finger for itself in full screen', async () => {
    // no native full screen (an iPhone, a frame without the permission): the overlay stands for it
    const native = Element.prototype.requestFullscreen
    Element.prototype.requestFullscreen = undefined as never
    try {
      const canvas = await mount(1100, 600)
      const board = canvas.querySelector<HTMLElement>('.lm-board')!
      const button = canvas.querySelector<HTMLButtonElement>('.lm-canvas-full')!
      expect(button.getAttribute('aria-label')).toBe('Full screen')
      button.click()
      await expect.poll(() => button.getAttribute('aria-pressed'), { timeout: 5000 }).toBe('true')
      expect(button.getAttribute('aria-label')).toBe('Close full screen')
      // the same box at the window's size
      await expect.poll(() => canvas.getBoundingClientRect().height, { timeout: 5000 }).toBeGreaterThan(800)
      await handle!.ready()
      await frames()
      const k = handle!.engine.viewer!.shownView()!.k
      board.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 2 }))
      expect(board.style.touchAction).toBe('none')
      expect(wheel(board)).toBe(true)
      expect(handle!.engine.viewer!.shownView()!.k).toBeGreaterThan(k)
      // the Panels switch is there only in full screen; F switches it too
      const chrome = canvas.querySelector<HTMLButtonElement>('.lm-canvas-chrome')!
      expect(chrome.getAttribute('aria-pressed')).toBe('true')
      expect(canvas.querySelector('.lm-canvas-tabs')).not.toBeNull()
      chrome.click()
      await expect.poll(() => canvas.querySelector('.lm-canvas-tabs'), { timeout: 5000 }).toBeNull()
      expect(canvas.querySelector('.lm-canvas-console input[type="range"]')).not.toBeNull()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }))
      await expect.poll(() => canvas.querySelector('.lm-canvas-tabs'), { timeout: 5000 }).not.toBeNull()
      button.click()
      await expect.poll(() => button.getAttribute('aria-pressed'), { timeout: 5000 }).toBe('false')
      expect(canvas.querySelector('.lm-canvas-chrome')).toBeNull()
      expect(canvas.getBoundingClientRect().height).toBe(600)
    } finally {
      Element.prototype.requestFullscreen = native
    }
  })

  it('keeps the story when it is stopped before its first step shows, with a way out', async () => {
    const canvas = await mount(1200, 560)
    const story = () => canvas.querySelector<HTMLElement>('.lm-canvas-over .lm-story')
    canvas.querySelector<HTMLButtonElement>('.lm-canvas-play')!.click()
    await expect.poll(story, { timeout: 5000 }).not.toBeNull()
    // stopped while the camera is still on its way to the first step
    ctl!.setStoryPlaying(false)
    await frames()
    expect(ctl!.step).toBeNull()
    expect(story()).not.toBeNull()
    expect(canvas.querySelector('.lm-canvas-tabs')).toBeNull()
    const leave = canvas.querySelector<HTMLButtonElement>('.lm-canvas-leave')!
    expect(leave.getAttribute('aria-label')).toBe('Leave the story')
    leave.click()
    await expect.poll(story, { timeout: 5000 }).toBeNull()
    expect(canvas.querySelector('.lm-canvas-tabs')).not.toBeNull()
  })

  it('leaves the keyboard where it is when the story stops under it', async () => {
    const canvas = await mount(1200, 560)
    ctl!.setStep(0)
    await expect.poll(() => canvas.querySelector('.lm-canvas-over .lm-story'), { timeout: 5000 }).not.toBeNull()
    // started from outside the canvas: the focus is not taken
    expect(canvas.contains(document.activeElement)).toBe(false)
    const load = canvas.querySelector<HTMLInputElement>('.lm-canvas-console input[type="range"]')!
    load.focus()
    ctl!.setStep(null)
    await expect.poll(() => canvas.querySelector('.lm-canvas-over'), { timeout: 5000 }).toBeNull()
    await frames()
    expect(document.activeElement).toBe(load)
  })
})
