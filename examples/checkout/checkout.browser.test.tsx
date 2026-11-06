import { compare, headroom } from '@loadmap/core'
import { composeFrame, exportPng, exportSvg, recordPoster, recordVideo } from '@loadmap/export'
import type { Scene } from '@loadmap/layout'
import {
  Diagram,
  LOADMAP_PANELS,
  Loadmap,
  type LoadmapHandle,
  type LoadmapPanel,
  LoadmapRoot,
  type Theme,
  useLoadmap,
  Verdict,
} from '@loadmap/react'
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Checkout } from './Checkout'
import { checkout } from './model'
import { view } from './view'

let root: Root | null = null
let host: HTMLDivElement | null = null

async function mount(o: { theme?: Theme; width?: number } = {}) {
  await page.viewport(o.width ?? 1280, o.width && o.width < 640 ? 2600 : 900)
  host = document.createElement('div')
  document.body.appendChild(host)
  const ref = createRef<LoadmapHandle>()
  root = createRoot(host)
  root.render(<Checkout ref={ref} theme={o.theme} />)
  await expect.poll(() => ref.current).toBeTruthy()
  await ref.current!.ready()
  return { handle: ref.current!, el: host.querySelector<HTMLElement>('.lm')! }
}

afterEach(() => {
  root?.unmount()
  host?.remove()
  root = null
  host = null
})

async function hash(c: HTMLCanvasElement): Promise<string> {
  const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
  const d = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const verdict = (el: HTMLElement) => el.querySelector('.lm-verdict')!.textContent

describe('checkout in the browser', () => {
  it('draws the diagram and answers with a verdict', async () => {
    const { el } = await mount()
    expect(el.querySelectorAll('[data-node]')).toHaveLength(5)
    expect(el.querySelectorAll('rect[data-slot]')).toHaveLength(24)
    expect(verdict(el)).toContain('At 10×, every component is under the 50 % target')
    // the gateway's ±30 % puts it first on the pessimistic edge, and the hint says to measure it
    expect(
      el.querySelector('.lm-lim .lm-tag[data-kind="first"]')?.closest('.lm-lim')?.getAttribute('data-component'),
    ).toBe('gateway')
    expect(el.querySelector('.lm-lim[data-component="gateway"] .lm-tag[data-kind="estimated"]')?.textContent).toBe(
      'estimate ±30 %',
    )
    expect(el.querySelector('.lm-lim[data-component="gateway"] small')?.textContent).toBe(
      '50 % at 7.4×–13× · full at 14×–27×',
    )
    const hint = el.querySelector('.lm-measure')!
    expect([hint.getAttribute('data-component'), hint.textContent]).toEqual([
      'gateway',
      checkout.evaluate({ load: 10 }).measure!.text,
    ])
    // two pods put the workers first at either bound: nothing to measure
    const pods = [...el.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Worker pods'))!
    const select = pods.querySelector('select')!
    select.value = '2'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await expect.poll(() => el.querySelector('.lm-measure')).toBeNull()
  })

  it('changes the verdict when the load slider moves', async () => {
    const { el } = await mount()
    const slider = el.querySelector<HTMLInputElement>('input[type=range]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '40')
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    await expect.poll(() => verdict(el)).toContain('At 40×, the worker pool and the API gateway are past capacity')
    expect(el.querySelector('.lm-verdict')!.getAttribute('data-tier')).toBe('over')
  })

  it('greys out rows per batch while batching is off', async () => {
    const { el } = await mount()
    const batch = [...el.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Batch DB writes'))!
    const rows = [...el.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Rows per batch'))!
    expect(rows.querySelector('select')!.disabled).toBe(false)
    batch.querySelector('input')!.click()
    await expect.poll(() => rows.querySelector('select')!.disabled).toBe(true)
  })

  it('animates dots and fills the workers', async () => {
    const { handle, el } = await mount()
    handle.pause()
    handle.reset(3)
    for (let i = 0; i < 120; i++) handle.step(1 / 30)
    expect(handle.engine.sim.particles.length).toBeGreaterThan(5)
    const filled = [...el.querySelectorAll('rect[data-slot]')].filter((r) => Number(r.getAttribute('height')) > 0)
    expect(filled.length).toBeGreaterThan(0)
  })

  it('switches scenario without starting the dots over', async () => {
    const { handle, el } = await mount()
    handle.pause()
    handle.reset(3)
    for (let i = 0; i < 90; i++) handle.step(1 / 30)
    const sim = handle.engine.sim
    const before = new Set(sim.particles.map((d) => d.id))
    expect(before.size).toBeGreaterThan(5)
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('.lm-scenarios button')]
    expect(buttons.map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
      ['Today', 'true'],
      ['Proposed', 'false'],
    ])
    buttons[1]!.click()
    await expect
      .poll(() => verdict(el))
      .toContain('holds up to between 14× and 20× (between September 2030 and March 2031)')
    expect(buttons[1]!.getAttribute('aria-pressed')).toBe('true')
    // six pods change the layout; the queues and the dots carry on
    await handle.ready()
    expect(handle.engine.sim).toBe(sim)
    handle.step(1 / 30)
    expect(sim.particles.some((d) => before.has(d.id))).toBe(true)
    expect(el.querySelectorAll('rect[data-slot]')).toHaveLength(48)
    // a control of the reader's own leaves every scenario
    const pods = [...el.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Worker pods'))!
    const select = pods.querySelector('select')!
    select.value = '4'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await expect.poll(() => el.querySelector('.lm-own')?.textContent).toBe('your own values')
  })

  it('compares the scenarios in a table that matches the model', async () => {
    const { el } = await mount()
    const c = compare(checkout, 10)
    expect(el.querySelector('.lm-compare-text')!.textContent).toBe(c.text)
    const rows = [...el.querySelectorAll('.lm-compare tbody tr[data-scenario]')]
    expect(rows.map((r) => r.textContent)).toEqual([
      'TodayAPI gateway7.4×–10×Sep 2029–Feb 203014×–20×Sep 2030–Mar 2031',
      'ProposedAPI gateway14×–20×Sep 2030–Mar 203129×–42×Sep 2031–Mar 2032',
    ])
    const cell = (r: Element, k: string) => Number(r.querySelector('td[data-multiple]')!.getAttribute(k))
    expect(rows.map((r) => [cell(r, 'data-multiple'), cell(r, 'data-high')])).toEqual(
      c.rows.map((r) => [r.targetRange!.low, r.targetRange!.high]),
    )
    const gateway = el.querySelector('.lm-compare tr[data-component="gateway"]')!
    expect(gateway.textContent).toBe('API gateway7.4×–13×14×–27×+100 %')
  })

  it('draws the headroom chart with its crossings where the limits are', async () => {
    const { el } = await mount()
    const c = compare(checkout, 10)
    const h = headroom(checkout, { load: 10 })
    const dots = [...el.querySelectorAll('.lm-headroom circle[data-crossing]')]
    const at = (label: string, kind: string) =>
      Number(
        dots
          .find((d) => d.getAttribute('data-scenario') === label && d.getAttribute('data-crossing') === kind)
          ?.getAttribute('data-multiple'),
      )
    const range = (label: string, kind: string) => {
      const g = el.querySelector(`.lm-headroom [data-range="${kind}"][data-scenario="${label}"]`)!
      return [Number(g.getAttribute('data-low')), Number(g.getAttribute('data-high'))]
    }
    for (const r of c.rows) {
      // the dots at the stated capacities: the first component's own crossing
      const ev = checkout.evaluate({ ...checkout.scenarios.find((s) => s.label === r.label)!.values, load: 10 })
      const first = (k: 'target' | 'full') => Math.min(...Object.values(ev.components).map((x) => x[k] ?? Infinity))
      expect(at(r.label, 'target')).toBe(first('target'))
      expect(at(r.label, 'full')).toBe(first('full'))
      // the brackets span the crossings at the capacity bounds, the comparison's ranges
      expect(range(r.label, 'target')).toEqual([r.targetRange!.low, r.targetRange!.high])
      expect(range(r.label, 'full')).toEqual([r.fullRange!.low, r.fullRange!.high])
    }
    expect([...el.querySelectorAll('.lm-headroom [data-band]')].map((p) => p.getAttribute('data-band'))).toEqual(
      h.lines
        .filter((l) => l.band)
        .map((l) => l.label)
        .reverse(),
    )
    expect([...el.querySelectorAll('.lm-headroom [data-line]')].map((p) => p.getAttribute('data-line'))).toEqual([
      'Proposed',
      'Today',
    ])
    // the arrow keys read every line at one load
    const chart = el.querySelector<HTMLElement>('.lm-chart')!
    chart.focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect
      .poll(() => el.querySelector('.lm-headroom .lm-tip')?.textContent)
      .toMatch(/×.*Today.*Proposed.*Worker pool/)
    expect(chart.getAttribute('aria-valuetext')).toMatch(/^\d+(\.\d)?×: Today \d+ %, Proposed \d+ %$/)
  })

  it('tells what a box stands for on hover and on focus', async () => {
    const { el } = await mount()
    const workers = el.querySelector<SVGGElement>('[data-node="workers"]')!
    await userEvent.hover(workers)
    const detail = () => el.querySelector('.lm-detail')?.textContent ?? ''
    await expect.poll(detail).toContain('Worker pool')
    expect(detail()).toContain('50 % at 10× (around February 2030)')
    expect(detail()).toContain('capacity measured, pod CPU limit')
    expect(detail()).toContain('Today 10× · Proposed 20×')
    await expect.poll(() => workers.getAttribute('aria-describedby')).toBe(el.querySelector('.lm-detail')!.id)
    // a button named by what it stands for, its detail outside the board that clips
    expect([workers.getAttribute('role'), workers.getAttribute('aria-label')]).toEqual([
      'button',
      'Workers, Worker pool: 50 %',
    ])
    expect(el.querySelector('.lm-detail')!.closest('.lm-board')).toBeNull()
    await userEvent.unhover(workers)
    await expect.poll(() => el.querySelector('.lm-detail')).toBeNull()
    el.querySelector<SVGGElement>('[data-node="gateway"]')!.focus()
    await expect.poll(detail).toContain('capacity estimated, vendor benchmark, not load-tested')
    // a box without a component has nothing to tell
    expect(el.querySelector('[data-node="phones"]')!.getAttribute('tabindex')).toBeNull()
  })

  it('reports a click on any box, and draws the one selected', async () => {
    await page.viewport(1280, 900)
    host = document.createElement('div')
    document.body.appendChild(host)
    const ref = createRef<LoadmapHandle>()
    const clicks: string[] = []
    root = createRoot(host)
    const draw = (selected: string | null) =>
      root!.render(
        <Loadmap ref={ref} model={checkout} view={view} onNodeClick={(id) => clicks.push(id)} selected={selected} />,
      )
    draw(null)
    await expect.poll(() => ref.current).toBeTruthy()
    await ref.current!.ready()
    const el = host.querySelector<HTMLElement>('.lm')!
    // a box without a component is a button too now, named by its title
    const phones = el.querySelector<SVGGElement>('[data-node="phones"]')!
    expect([phones.getAttribute('role'), phones.getAttribute('tabindex'), phones.getAttribute('aria-label')]).toEqual([
      'button',
      '0',
      'Phones',
    ])
    await userEvent.click(phones)
    phones.focus()
    await userEvent.keyboard('{Enter}')
    // a box with a component still pins its detail
    await userEvent.click(el.querySelector<SVGGElement>('[data-node="gateway"]')!)
    await expect.poll(() => el.querySelector('.lm-detail')?.textContent ?? '').toContain('capacity estimated')
    expect(clicks).toEqual(['phones', 'phones', 'gateway'])
    expect(el.querySelector('.lm-selected')).toBeNull()
    draw('db')
    await expect.poll(() => el.querySelectorAll('.lm-selected').length).toBe(1)
    expect(el.querySelector('[data-node="db"] .lm-selected')).not.toBeNull()
    expect(el.querySelector('[data-node="db"]')!.getAttribute('aria-pressed')).toBe('true')
    expect(el.querySelector('[data-node="gateway"]')!.getAttribute('aria-pressed')).toBe('false')
  })

  for (const theme of ['light', 'dark'] as const)
    it(`renders the ${theme} theme`, async () => {
      const { el } = await mount({ theme })
      const bg = getComputedStyle(el).backgroundColor
      expect(bg).toBe(theme === 'light' ? 'rgb(238, 242, 245)' : 'rgb(13, 20, 27)')
      await page.screenshot({ path: `__screenshots__/checkout-${theme}.png`, element: el })
    })

  it('follows the page\'s own switch with theme="inherit", and the media query when the page has none', async () => {
    const html = document.documentElement
    const LIGHT = 'rgb(238, 242, 245)'
    const DARK = 'rgb(13, 20, 27)'
    try {
      html.dataset.theme = 'dark'
      const { el, handle } = await mount({ theme: 'inherit' })
      const bg = () => getComputedStyle(el).backgroundColor
      expect(bg()).toBe(DARK)
      // the dots read the tokens again
      expect(handle.engine.flowColor('orders')).toBe('#5fb7d6')
      // tall enough for the whole board in one picture
      await page.viewport(1280, 2200)
      await page.screenshot({ path: '__screenshots__/checkout-inherit-dark.png', element: el })
      html.dataset.theme = 'light'
      await expect.poll(bg).toBe(LIGHT)
      await expect.poll(() => handle.engine.flowColor('orders')).toBe('#0b6b8f')
      delete html.dataset.theme
      html.classList.add('dark')
      await expect.poll(bg).toBe(DARK)
      html.classList.remove('dark')
      // nothing on the page: no theme of its own, so the system's (the media query) decides
      await expect.poll(() => el.hasAttribute('data-theme')).toBe(false)
    } finally {
      delete html.dataset.theme
      html.classList.remove('dark')
    }
  })

  it('drops its background and padding inside a card by two tokens, and keeps them full screen', async () => {
    const { el } = await mount()
    // a card of the page's own
    Object.assign(host!.style, {
      padding: '24px',
      background: '#fff',
      border: '1px solid #d0d7de',
      borderRadius: '12px',
    })
    host!.style.setProperty('--lm-pad', '0px')
    host!.style.setProperty('--lm-root-bg', 'transparent')
    expect(getComputedStyle(el).paddingTop).toBe('0px')
    expect(getComputedStyle(el).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    // tall enough for the whole board in one picture
    await page.viewport(1280, 2200)
    await page.screenshot({ path: '__screenshots__/checkout-card.png', element: host! })
    el.setAttribute('data-full', '')
    expect(getComputedStyle(el).paddingTop).toBe('16px')
    expect(getComputedStyle(el).backgroundColor).toBe('rgb(238, 242, 245)')
  })

  it('walks through its story: a step at a time, pointing at a box', async () => {
    const { el, handle } = await mount()
    const bar = el.querySelector<HTMLElement>('.lm-story')!
    const button = (name: string) => [...bar.querySelectorAll('button')].find((b) => b.textContent === name)
    // every step is in the bar, keeping its room; one shows
    // biome-ignore lint/performance/useDomNodeTextContent: innerText leaves out the hidden note of the steps not shown
    const text = () => bar.querySelector<HTMLElement>('p > [data-shown]')!.innerText.replace(/\s+/g, ' ').trim()
    const focused = () => [...el.querySelectorAll('[data-focus]')].map((n) => n.getAttribute('data-node'))
    expect(text()).toBe('A walk through this model in 3 steps.')
    await userEvent.click(button('Start')!)
    expect(text()).toBe('1 of 3 An ordinary peak: every box is under half its capacity.')
    expect(handle.values().load).toBe(1)
    expect(focused()).toEqual([])
    await userEvent.click(button('Next')!)
    expect(handle.values()).toMatchObject({ load: 20, pods: 3 })
    expect(focused()).toEqual(['gateway'])
    // the arrows move through it while the bar has the focus
    await userEvent.keyboard('{ArrowRight}')
    expect(handle.values()).toMatchObject({ load: 20, pods: 6, gateways: 2 })
    expect(el.querySelector('.lm-scenarios [aria-pressed="true"]')!.textContent).toBe('Proposed')
    expect(focused()).toEqual(['workers'])
    expect(button('Next')!.getAttribute('aria-disabled')).toBe('true')
    expect(handle.storyStep()).toBe(2)
    // a value of the reader's own: the step says so and stops pointing; Next at the end leaves it alone
    handle.setValues({ pods: 4 })
    await expect.poll(focused).toEqual([])
    expect(text()).toContain('You changed the values since.')
    // Playwright will not click an aria-disabled button; a reader can
    button('Next')!.click()
    expect(handle.values().pods).toBe(4)
    await userEvent.click(button('Show again')!)
    expect(handle.values().pods).toBe(6)
    expect(focused()).toEqual(['workers'])
    await userEvent.keyboard('{ArrowLeft}')
    expect(focused()).toEqual(['gateway'])
    await userEvent.click(button('Done')!)
    expect(focused()).toEqual([])
    expect(handle.storyStep()).toBe(null)
    // leaving the story keeps the values it showed
    expect(handle.values().load).toBe(20)
  })

  it('lays the diagram out top to bottom at phone width, without sideways scroll', async () => {
    const { handle, el } = await mount({ width: 390 })
    await expect.poll(() => handle.board()?.scene.direction).toBe('DOWN')
    await handle.ready()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
    await page.screenshot({ path: '__screenshots__/checkout-phone.png', element: el })
  })
})

describe('a new structure', () => {
  const drawn = (el: HTMLElement, id: string) => {
    const r = el.querySelector(`[data-node="${id}"] > rect`)!
    return ['x', 'y', 'width', 'height'].map((a) => Number(r.getAttribute(a)))
  }
  const laid = (s: Scene, id: string) => {
    const n = s.nodes.find((x) => x.id === id)!
    return [n.x, n.y, n.w, n.h]
  }

  it('moves in on the engine clock, and lands on the new scene', async () => {
    const { handle, el } = await mount()
    // paused and stepped, as a recording drives it
    handle.pause()
    handle.step(1 / 30)
    const today = handle.engine.scene!
    handle.setValues({ pods: 6 })
    await handle.ready()
    const proposed = handle.engine.scene!
    expect(proposed.key).not.toBe(today.key)
    // nothing moves until the clock does; the new pods are there, not showing yet
    expect(drawn(el, 'workers')).toEqual(laid(today, 'workers'))
    expect(el.querySelectorAll('rect[data-slot]')).toHaveLength(48)
    expect(el.querySelector('[data-node="workers"] g[opacity="0"]')).not.toBeNull()
    // half the move: 0.38 s of 0.8 is the middle of the boxes' part of it
    handle.step(0.38)
    await handle.ready()
    const [x, , w] = drawn(el, 'workers')
    expect(x).toBeCloseTo((laid(today, 'workers')[0]! + laid(proposed, 'workers')[0]!) / 2, 1)
    expect(w).toBeCloseTo((laid(today, 'workers')[2]! + laid(proposed, 'workers')[2]!) / 2, 1)
    expect(handle.board()!.scene).not.toBe(proposed)
    handle.step(0.5)
    await handle.ready()
    expect(handle.board()!.scene).toBe(proposed)
    for (const n of proposed.nodes.filter((x) => x.shape === 'box'))
      expect(drawn(el, n.id)).toEqual(laid(proposed, n.id))
    expect(el.querySelectorAll('[data-node] [opacity="0"]')).toHaveLength(0)
  })

  it('fades out the pods that leave as they were, running', async () => {
    const { handle, el } = await mount()
    handle.pause()
    handle.step(1 / 30)
    handle.setValues({ pods: 2 })
    await handle.ready()
    handle.step(0.1)
    await handle.ready()
    const pods = [...el.querySelectorAll('[data-node="workers"] > g')].filter((g) => g.querySelector('rect + text'))
    expect(pods).toHaveLength(3)
    expect(pods.map((g) => g.hasAttribute('data-idle'))).toEqual([false, false, false])
    expect(Number(pods[2]!.getAttribute('opacity'))).toBeCloseTo(1 - 0.1 / 0.8 / 0.3, 3)
  })

  it('cuts to the new structure on a page that paused the board and does not step it', async () => {
    const { handle } = await mount()
    handle.pause()
    handle.setValues({ pods: 6 })
    await handle.ready()
    expect(handle.board()!.scene).toBe(handle.engine.scene)
  })

  it('never moves for a load change', async () => {
    const { handle, el } = await mount()
    handle.pause()
    const { frameId, scene } = handle.engine
    handle.setValues({ load: 80 })
    await expect.poll(() => verdict(el)).toContain('At 80×')
    await handle.ready()
    handle.step(0.4)
    expect(handle.engine.frameId).toBe(frameId)
    expect(handle.board()!.scene).toBe(scene)
  })

  it('cuts to the new structure with reduced motion, or a transition of 0', async () => {
    const real = window.matchMedia
    window.matchMedia = (q: string) =>
      q.includes('reduced-motion')
        ? ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList)
        : real.call(window, q)
    try {
      const { handle, el } = await mount()
      handle.setValues({ pods: 6 })
      await handle.ready()
      expect(handle.board()!.scene).toBe(handle.engine.scene)
      expect(drawn(el, 'workers')).toEqual(laid(handle.engine.scene!, 'workers'))
    } finally {
      window.matchMedia = real
    }
    root?.unmount()
    host!.replaceChildren()
    const ref = createRef<LoadmapHandle>()
    root = createRoot(host!)
    root.render(<Loadmap ref={ref} model={checkout} view={view} transition={0} />)
    await expect.poll(() => ref.current).toBeTruthy()
    await ref.current!.ready()
    ref.current!.setValues({ pods: 6 })
    await ref.current!.ready()
    expect(ref.current!.board()!.scene).toBe(ref.current!.engine.scene)
  })
})

describe('full screen', () => {
  const box = (e: Element) => {
    const r = e.getBoundingClientRect()
    return {
      left: Math.round(r.left),
      top: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    }
  }
  const inView = (e: Element) => {
    const r = e.getBoundingClientRect()
    return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5
  }
  const shown = (e: Element | null) => !!e && e.getClientRects().length > 0
  const button = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.lm-bar .lm-btn')!
  const mode = (el: HTMLElement, name: 'Panels' | 'Focus') =>
    [...el.querySelectorAll<HTMLButtonElement>('.lm-modes button')].find((b) => b.textContent === name)!
  const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  async function enter(el: HTMLElement) {
    await userEvent.click(button(el))
    await expect.poll(() => el.hasAttribute('data-full')).toBe(true)
    // the board takes its size a frame after the layout
    await frames()
  }
  async function draw(o: { fullScreen?: LoadmapPanel[]; width?: number } = {}) {
    await page.viewport(o.width ?? 1440, 900)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    const ref = createRef<LoadmapHandle>()
    const render = (fullScreen?: LoadmapPanel[]) =>
      root!.render(<Loadmap ref={ref} model={checkout} view={view} speed={10} fullScreen={fullScreen} />)
    render(o.fullScreen)
    await expect.poll(() => ref.current).toBeTruthy()
    await ref.current!.ready()
    return { el: host.querySelector<HTMLElement>('.lm')!, handle: ref.current!, render }
  }
  /** What of an element shows: its box, cut by every ancestor that clips. */
  const seen = (e: Element) => {
    const r = e.getBoundingClientRect()
    let [top, left, bottom, right] = [r.top, r.left, r.bottom, r.right]
    for (let a = e.parentElement; a; a = a.parentElement)
      if (getComputedStyle(a).overflow !== 'visible') {
        const c = a.getBoundingClientRect()
        ;[top, left, bottom, right] = [
          Math.max(top, c.top),
          Math.max(left, c.left),
          Math.min(bottom, c.bottom),
          Math.min(right, c.right),
        ]
      }
    return { top, left, bottom, right }
  }
  /** Nothing scrolls, and nothing that shows reaches past the screen; on a phone the board pans in its own box. */
  const fits = (el: HTMLElement) => {
    expect(el.scrollHeight, 'the root scrolls').toBeLessThanOrEqual(el.clientHeight)
    expect(el.scrollWidth, 'the root scrolls sideways').toBeLessThanOrEqual(el.clientWidth)
    const out = [...el.querySelectorAll('*')].filter((e) => {
      if (e.closest('.lm-wrap') || getComputedStyle(e).visibility !== 'visible' || !shown(e)) return false
      const r = seen(e)
      return r.bottom > r.top && r.right > r.left && (r.bottom > innerHeight + 0.5 || r.right > innerWidth + 0.5)
    })
    expect(out.map((e) => e.className || e.tagName)).toEqual([])
  }
  /** Each panel in its compact form. */
  const MINI: Record<LoadmapPanel, (el: HTMLElement) => Element | null> = {
    verdict: (el) => el.querySelector('.lm-line .lm-headline'),
    live: (el) => el.querySelector('[data-mini="live"] .lm-meters'),
    limits: (el) => el.querySelector('[data-mini="limits"] .lm-mini-limits'),
    controls: (el) => el.querySelector('[data-mini="controls"] input[type=range]'),
    headroom: (el) => el.querySelector('[data-mini="headroom"] .lm-spark svg'),
    compare: (el) => el.querySelector('[data-mini="compare"] tbody'),
    assumptions: (el) =>
      [...el.querySelectorAll('.lm-line .lm-link')].find((b) => b.textContent!.startsWith('What this assumes')) ?? null,
  }
  /** Each panel as the page shows it. */
  const PAGE: Record<LoadmapPanel, string> = {
    verdict: '.lm-verdict',
    live: '.lm-side .lm-meters',
    limits: '.lm-limits',
    controls: '.lm-side .lm-controls',
    headroom: '.lm-headroom',
    compare: '.lm-side .lm-compare',
    assumptions: '.lm-facts',
  }
  const slide = async (el: HTMLElement, input: HTMLInputElement, to: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, to)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await expect.poll(() => el.querySelector('.lm-headline')!.textContent).toContain(`${to}×`)
  }

  for (const [width, height] of [
    [1440, 900],
    [2560, 1440],
    [390, 844],
  ] as const)
    it(`fits ${width}x${height} without scrolling, in focus and with every panel`, async () => {
      const { el } = await mount({ width })
      await page.viewport(width, height)
      await enter(el)
      expect(box(el)).toEqual({ left: 0, top: 0, width: innerWidth, height: innerHeight })
      // checkout's page opens full screen in focus
      expect(el.getAttribute('data-mode')).toBe('focus')
      for (const m of ['focus', 'panels'] as const) {
        if (m === 'panels') await userEvent.click(mode(el, 'Panels'))
        await expect.poll(() => el.getAttribute('data-mode')).toBe(m)
        await frames()
        fits(el)
        const board = box(el.querySelector('.lm-board')!)
        expect(board.width).toBe(el.querySelector('.lm-wrap')!.clientWidth)
        if (width > 760) expect(board.top + board.height).toBeLessThanOrEqual(innerHeight)
        else expect(getComputedStyle(el.querySelector('.lm-wrap')!).overflowY).toBe('auto')
        await page.screenshot({ path: `__screenshots__/checkout-full-${m}-${width}.png` })
      }
    })

  /** What of `e` reaches past `box`, in pixels: right, left, bottom, top. */
  const past = (e: Element, box: Element) => {
    const r = e.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    return [r.right - b.right, b.left - r.left, r.bottom - b.bottom, b.top - r.top].map((x) =>
      Math.max(0, Math.round(x)),
    )
  }
  const within = (e: Element, box: Element) => expect(past(e, box), e.textContent ?? '').toEqual([0, 0, 0, 0])
  /** Each box's detail, pinned in turn: nothing of it is cut by what clips it, and it stays inside the root. */
  const details = async (el: HTMLElement) => {
    for (const node of el.querySelectorAll<SVGGElement>('.lm-board [data-node][role=button]')) {
      await userEvent.click(node)
      await expect.poll(() => el.querySelector('.lm-detail')).toBeTruthy()
      const d = el.querySelector('.lm-detail')!
      const name = node.getAttribute('data-node')
      const whole = (why: string) => {
        const r = d.getBoundingClientRect()
        const s = seen(d)
        expect([s.top, s.left, s.bottom, s.right].map(Math.round), `${name}: cut${why}`).toEqual(
          [r.top, r.left, r.bottom, r.right].map(Math.round),
        )
        expect(past(d, el).slice(0, 2), `${name}: past the root${why}`).toEqual([0, 0])
      }
      whole('')
      // a board that pans in its own box: the detail keeps to the room that shows as it scrolls
      const wrap = el.querySelector<HTMLElement>('.lm-wrap')!
      if (wrap.scrollHeight > wrap.clientHeight + 40) {
        const before = wrap.scrollTop
        wrap.scrollTop = before > 40 ? before - 40 : before + 40
        await frames()
        whole(' after a scroll')
        wrap.scrollTop = before
      }
      await userEvent.click(node)
      await expect.poll(() => el.querySelector('.lm-detail')).toBeNull()
    }
  }

  for (const [width, height] of [
    [1440, 900],
    [2560, 1440],
    [390, 844],
  ] as const)
    it(`keeps the headroom chart and each detail inside their boxes at ${width}x${height}`, async () => {
      const { el, handle } = await mount({ width })
      await page.viewport(width, height)
      // at the lowest and the highest load the load's label sits at an edge
      const card = el.querySelector('.lm-headroom')!
      for (const load of [1, 100]) {
        handle.setValues({ load })
        await handle.ready()
        await expect.poll(() => card.querySelector('svg text')?.textContent).toBeTruthy()
        for (const t of card.querySelectorAll('svg text')) within(t, card)
      }
      await details(el)
      await enter(el)
      await userEvent.click(mode(el, 'Panels'))
      await frames()
      if (width <= 760) await userEvent.click(page.getByRole('button', { name: 'Headroom', exact: true }))
      const spark = el.querySelector('[data-mini="headroom"] .lm-card')!
      // the chart sits under the heading, inside the card, and a line past the top leaves through its edge, which clips
      const svg = spark.querySelector('svg')!
      within(svg, spark)
      expect(svg.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        spark.querySelector('h3')!.getBoundingClientRect().bottom,
      )
      expect(getComputedStyle(svg).overflow).toBe('hidden')
      // the target line and the load's start with room above them: nothing runs along the top edge
      const st = svg.getBoundingClientRect().top
      expect(spark.querySelector('.lm-spark-th')!.getBoundingClientRect().top - st).toBeGreaterThan(6)
      await details(el)
      await page.screenshot({ path: `__screenshots__/checkout-overflow-${width}.png` })
    })

  it('shows every panel compact, and leaves out each one fullScreen does not list', async () => {
    const { el, render } = await draw({ fullScreen: ['verdict'] })
    // on the page every panel shows, whatever full screen lists
    for (const p of LOADMAP_PANELS) expect(shown(el.querySelector(PAGE[p])), p).toBe(true)
    await enter(el)
    expect(el.getAttribute('data-mode')).toBe('panels')
    render()
    for (const p of LOADMAP_PANELS) {
      await expect.poll(() => shown(MINI[p](el)), { message: p }).toBe(true)
      expect(shown(el.querySelector(PAGE[p])), `${p} on the page`).toBe(false)
    }
    fits(el)
    for (const p of LOADMAP_PANELS) {
      render(LOADMAP_PANELS.filter((x) => x !== p))
      await expect.poll(() => shown(MINI[p](el)), { message: `without ${p}` }).toBe(false)
      // a card that gets wider draws its chart again a frame later
      await expect.poll(() => LOADMAP_PANELS.filter((x) => x !== p && !shown(MINI[x](el)))).toEqual([])
      fits(el)
    }
    // none leaves the diagram alone, as large as fits
    render([])
    await expect.poll(() => el.querySelector('.lm-dock, .lm-line')).toBeNull()
    const wrap = el.querySelector<HTMLElement>('.lm-wrap')!
    const story = el.querySelector('.lm-story')!.getBoundingClientRect().bottom
    await expect
      .poll(() => {
        const b = box(el.querySelector('.lm-board')!)
        return Math.max(b.width / wrap.clientWidth, (b.top + b.height - story) / (innerHeight - 16 - story))
      })
      .toBeCloseTo(1, 1)
  })

  it('changes the verdict with the load, never the board, in both modes', async () => {
    const { el, handle } = await mount()
    await page.viewport(1440, 900)
    await enter(el)
    const board = el.querySelector('.lm-board')!
    for (const m of ['focus', 'panels'] as const) {
      if (m === 'panels') await userEvent.click(mode(el, 'Panels'))
      await frames()
      const b = box(board)
      const dock = el.querySelector('.lm-dock')
      const d = dock && box(dock)
      const input = el.querySelector<HTMLInputElement>(
        m === 'focus' ? '.lm-line input[type=range]' : '[data-mini="controls"] input[type=range]',
      )!
      expect(inView(input)).toBe(true)
      await slide(el, input, m === 'focus' ? '40' : '3')
      expect(el.querySelector('.lm-line')!.getAttribute('data-tier')).toBe(m === 'focus' ? 'over' : 'ok')
      expect(el.querySelector('.lm-headline')!.getAttribute('title')).toContain(m === 'focus' ? 'At 40×' : 'At 3×')
      await handle.ready()
      await frames()
      expect(box(board)).toEqual(b)
      if (d) expect(box(dock!)).toEqual(d)
      fits(el)
    }
  })

  it('switches to focus and back, with the switch and with F', async () => {
    const { el } = await draw()
    await enter(el)
    const dock = () => shown(el.querySelector('.lm-dock'))
    expect(dock()).toBe(true)
    // focus: the diagram, the story under it, the verdict and the load
    await userEvent.click(mode(el, 'Focus'))
    await expect.poll(() => el.getAttribute('data-mode')).toBe('focus')
    expect(mode(el, 'Focus').getAttribute('aria-pressed')).toBe('true')
    expect(dock()).toBe(false)
    expect(shown(el.querySelector('.lm-scenarios'))).toBe(false)
    const board = el.querySelector('.lm-board')!.getBoundingClientRect()
    expect(el.querySelector('.lm-story')!.getBoundingClientRect().top).toBeGreaterThan(board.bottom)
    expect(shown(el.querySelector('.lm-line .lm-headline'))).toBe(true)
    expect(shown(el.querySelector('.lm-line input[type=range]'))).toBe(true)
    // the story bar stays where the keyboard is when the mode changes
    const play = el.querySelector<HTMLButtonElement>('.lm-story-nav button')!
    play.focus()
    await userEvent.keyboard('f')
    await expect.poll(() => el.getAttribute('data-mode')).toBe('panels')
    expect(dock()).toBe(true)
    expect(document.activeElement).toBe(play)
    await userEvent.keyboard('F')
    await expect.poll(() => el.getAttribute('data-mode')).toBe('focus')
    // the mode stays for the next time; the page keeps none of it
    await userEvent.click(button(el))
    await expect.poll(() => el.hasAttribute('data-full')).toBe(false)
    expect(el.hasAttribute('data-mode')).toBe(false)
    expect(shown(el.querySelector('.lm-scenarios'))).toBe(true)
    await userEvent.keyboard('f')
    expect(el.hasAttribute('data-full')).toBe(false)
    await enter(el)
    expect(el.getAttribute('data-mode')).toBe('focus')
  })

  it('opens a panel whole over the diagram, and gives the keyboard back', async () => {
    const { el } = await draw()
    await enter(el)
    const b = box(el.querySelector('.lm-board')!)
    const side = el.querySelector<HTMLElement>('.lm-side')!
    const more = el.querySelector<HTMLButtonElement>('[data-mini="limits"] .lm-more')!
    await userEvent.click(more)
    await expect.poll(() => side.getAttribute('data-drawer')).toBe('limits')
    expect(side.getAttribute('role')).toBe('dialog')
    expect(shown(el.querySelector('.lm-limits'))).toBe(true)
    expect(inView(el.querySelector('.lm-limits')!)).toBe(true)
    for (const p of LOADMAP_PANELS)
      if (p !== 'limits') expect(shown(el.querySelector(PAGE[p])), `${p} beside the limits`).toBe(false)
    expect(document.activeElement!.textContent).toContain('Back to full screen')
    expect(box(el.querySelector('.lm-board')!)).toEqual(b)
    // F waits while a panel is open whole
    await userEvent.keyboard('f')
    expect(el.getAttribute('data-mode')).toBe('panels')
    await page.screenshot({ path: '__screenshots__/checkout-full-drawer.png' })
    await userEvent.click(document.activeElement!)
    await expect.poll(() => side.hasAttribute('data-drawer')).toBe(false)
    expect(document.activeElement).toBe(more)
    // the verdict line's links open the sentence and the assumptions
    const link = (t: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('.lm-line .lm-link')].find((x) => x.textContent!.startsWith(t))!
    await userEvent.click(link('Why'))
    await expect.poll(() => shown(el.querySelector('.lm-verdict'))).toBe(true)
    expect(el.querySelector('.lm-verdict')!.textContent).toBe(el.querySelector('.lm-headline')!.getAttribute('title'))
    await userEvent.click(el.querySelector('.lm-drawer-bar button')!)
    await userEvent.click(link('What this assumes'))
    await expect.poll(() => shown(el.querySelector('.lm-facts'))).toBe(true)
    expect(link('What this assumes').textContent).toContain(String(el.querySelectorAll('.lm-facts li').length))
    // leaving full screen closes it, and the page is as it was. The drawer covers Close: a script presses it
    button(el).click()
    await expect.poll(() => el.hasAttribute('data-full')).toBe(false)
    expect(side.hasAttribute('data-drawer')).toBe(false)
    for (const p of LOADMAP_PANELS) expect(shown(el.querySelector(PAGE[p])), p).toBe(true)
  })

  /** Steps a paused board by `dt` until `done`, with every frame drawn; what each step showed. */
  async function run(handle: LoadmapHandle, el: HTMLElement, done: () => boolean, dt = 0.1) {
    const seen: {
      shot: string
      step: number | null
      box: string
      whole: string
      title: string | null
      text: string
    }[] = []
    for (let i = 0; i < 600 && !done(); i++) {
      await handle.ready()
      handle.step(dt)
      await handle.ready()
      // the bar and the title follow in a render of their own
      await frames()
      seen.push({
        shot: handle.engine.story?.shot ?? 'end',
        step: handle.storyStep(),
        box: handle.board()!.svg.getAttribute('viewBox')!,
        whole: `0 0 ${handle.engine.frame!.width} ${handle.engine.frame!.height}`,
        title: el.querySelector('.lm-title b')?.textContent ?? null,
        text: el.querySelector('.lm-story p > span[data-shown]')?.textContent ?? '',
      })
    }
    return seen
  }

  it('plays the story as shots: the whole diagram, close on each change, back out, and the whole diagram at the end', async () => {
    const { el, handle } = await draw()
    await enter(el)
    handle.pause()
    const bar = el.querySelector<HTMLElement>('.lm-story')!
    const play = () => bar.querySelector<HTMLButtonElement>('.lm-story-nav button')!
    const story = el.querySelector('.lm-story p')!
    const height = story.getBoundingClientRect().height
    const board = box(el.querySelector('.lm-board')!)
    const whole = () => {
      const s = handle.engine.frame!
      return `0 0 ${s.width} ${s.height}`
    }
    await userEvent.click(play())
    await expect.poll(() => play().textContent).toBe('❚❚ Pause')
    expect(bar.hasAttribute('data-playing')).toBe(true)
    const seen = await run(handle, el, () => !handle.engine.playing)
    const order = seen.map((x) => x.shot).filter((x, i, a) => x !== a[i - 1] && x !== 'end')
    const step = ['in', 'close', 'change', 'out', 'wide']
    expect(order).toEqual(['establish', ...step, ...step, ...step])
    // the whole diagram before and after each change; close in between, on a part of it
    for (const x of seen) {
      if (x.shot === 'establish' || x.shot === 'wide') expect(x.box, x.shot).toBe(x.whole)
      if (x.shot === 'close' || x.shot === 'change') expect(x.box, x.shot).not.toBe(x.whole)
    }
    // the bar reads the step from the flight in, before its values change, which they do with the change
    const first = seen.find((x) => x.shot === 'in')!
    expect(first.step).toBe(null)
    expect(first.text).toContain('1 of 3')
    expect(first.title).toBe('1 · An ordinary peak')
    expect(seen.find((x) => x.shot === 'change')!.step).toBe(0)
    expect(seen.filter((x) => x.step === 2 && x.shot === 'change')[0]!.title).toBe(
      '3 · Proposed: Gateway instances 1 → 2, Worker pods 3 → 6',
    )
    // the camera moves the view, never the board; the text keeps the room of the longest step
    expect(story.getBoundingClientRect().height).toBe(height)
    await expect.poll(() => play().textContent).toBe('▶ Play')
    expect(handle.storyStep()).toBe(2)
    expect(handle.board()!.svg.getAttribute('viewBox')).toBe(whole())
    expect(el.querySelector('.lm-title')).toBeNull()
    // from the end it starts again; a value of the reader's own stops it, and the camera flies back out
    handle.setStoryStep(0)
    await handle.ready()
    // back from the proposal's six pods: the structure moves back, on the paused board's clock
    handle.step(1)
    await handle.ready()
    await frames()
    expect(box(el.querySelector('.lm-board')!)).toEqual(board)
    await userEvent.click(play())
    await run(handle, el, () => handle.engine.story?.shot === 'close')
    expect(handle.board()!.svg.getAttribute('viewBox')).not.toBe(whole())
    handle.setValues({ load: 2 })
    await expect.poll(() => play().textContent).toBe('▶ Play')
    await run(handle, el, () => !handle.engine.story)
    expect(handle.board()!.svg.getAttribute('viewBox')).toBe(whole())
    expect(handle.storyStep()).toBe(0)
    expect(handle.values().load).toBe(2)
  })

  it('marks the first limit, breathing while the story plays and once it is past the target', async () => {
    const { el, handle } = await draw()
    handle.pause()
    const halo = () => el.querySelector<SVGGElement>('[data-halo]')
    const breathes = async () => {
      handle.step(0.3)
      await handle.ready()
      const a = halo()!.getAttribute('transform')
      handle.step(0.3)
      await handle.ready()
      return !!a && a !== halo()!.getAttribute('transform')
    }
    // the gateway runs out first; under the target it holds still
    handle.setValues({ load: 1 })
    await handle.ready()
    expect(el.querySelectorAll('[data-halo]')).toHaveLength(1)
    const gateway = handle.board()!.scene.nodes.find((n) => n.id === 'gateway')!
    expect(Number(halo()!.dataset.cx)).toBe(gateway.x + gateway.w / 2)
    expect(await breathes()).toBe(false)
    // past the target it breathes, as a transform of its own layer: the box does not move
    handle.setValues({ load: 20 })
    await handle.ready()
    const before = el.querySelector('[data-node="gateway"]')!.getBoundingClientRect().toJSON()
    expect(await breathes()).toBe(true)
    expect(el.querySelector('[data-node="gateway"]')!.getBoundingClientRect().toJSON()).toEqual(before)
    // two pods at a load the gateway takes: the workers run out first, and the mark moves to them
    handle.setValues({ load: 5, pods: 2, gateways: 2 })
    await handle.ready()
    expect(handle.engine.ev.firstLimit?.id).toBe('workers')
    const workers = handle.board()!.scene.nodes.find((n) => n.id === 'workers')!
    await expect.poll(() => Number(halo()!.dataset.cx)).toBe(workers.x + workers.w / 2)
    expect(el.querySelectorAll('[data-halo]')).toHaveLength(1)
  })

  it('cuts between the shots and holds the mark still with reduced motion', async () => {
    const real = window.matchMedia
    window.matchMedia = (q: string) =>
      q.includes('reduced-motion')
        ? ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList)
        : real.call(window, q)
    try {
      const { el, handle } = await draw()
      handle.pause()
      handle.setValues({ load: 20 })
      await handle.ready()
      await userEvent.click(el.querySelector<HTMLButtonElement>('.lm-story-nav button')!)
      await expect.poll(() => handle.engine.playing).toBe(true)
      const seen = await run(handle, el, () => handle.engine.story?.shot === 'wide')
      // no flight: the first frame of the way in is already close, the first of the way out already whole
      const close = handle.engine.frame && seen.find((x) => x.shot === 'in')!.box
      expect(close).toBe(seen.find((x) => x.shot === 'close')!.box)
      const s = handle.engine.frame!
      expect(seen.find((x) => x.shot === 'out')!.box).toBe(`0 0 ${s.width} ${s.height}`)
      expect(el.querySelector('[data-halo]')!.getAttribute('transform') ?? '').toBe('')
    } finally {
      window.matchMedia = real
    }
  })

  it('covers the page where the browser refuses full screen; Esc closes the drawer, then the overlay', async () => {
    const { el } = await draw()
    // as on an iPhone, or in a frame without the permission; inside a transform, which traps a fixed element
    el.requestFullscreen = () => Promise.reject(new TypeError('not allowed'))
    host!.style.cssText = 'transform: translateZ(0); margin: 120px 40px'
    await enter(el)
    expect(el.getAttribute('data-full')).toBe('overlay')
    expect(box(el)).toEqual({ left: 0, top: 0, width: innerWidth, height: innerHeight })
    fits(el)
    await userEvent.click(el.querySelector('[data-mini="live"] .lm-more')!)
    await expect.poll(() => el.querySelector('.lm-side')!.getAttribute('data-drawer')).toBe('live')
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => el.querySelector('.lm-side')!.hasAttribute('data-drawer')).toBe(false)
    expect(el.getAttribute('data-full')).toBe('overlay')
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => el.hasAttribute('data-full')).toBe(false)
    expect(button(el).textContent).toContain('Full screen')
    expect(document.activeElement).toBe(button(el))
  })

  it('keeps the pieces of a page of its own under the board, in a box of their own', async () => {
    await page.viewport(1440, 900)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    function Own() {
      const lm = useLoadmap(checkout, view, { speed: 10 })
      return (
        <LoadmapRoot lm={lm}>
          <Diagram lm={lm} />
          <div className="lm-side">
            <Verdict lm={lm} />
          </div>
          <p className="outside">Not in full screen</p>
        </LoadmapRoot>
      )
    }
    root.render(<Own />)
    await expect.poll(() => host!.querySelector('.lm-board svg')).toBeTruthy()
    const el = host.querySelector<HTMLElement>('.lm')!
    await enter(el)
    expect(el.getAttribute('data-mode')).toBe('panels')
    fits(el)
    const b = box(el.querySelector('.lm-board')!)
    const v = box(el.querySelector('.lm-verdict')!)
    expect(v.top).toBeGreaterThan(b.top + b.height)
    expect(inView(el.querySelector('.lm-verdict')!)).toBe(true)
    expect(shown(el.querySelector('.outside'))).toBe(false)
    // focus leaves the board alone
    await userEvent.click(mode(el, 'Focus'))
    await expect.poll(() => shown(el.querySelector('.lm-verdict'))).toBe(false)
  })

  it('turns a diagram from a narrow column to the right, as wide as the screen', async () => {
    const { handle, el } = await mount()
    host!.style.width = '500px'
    await expect.poll(() => handle.board()?.scene.direction).toBe('DOWN')
    await enter(el)
    await expect.poll(() => handle.board()?.scene.direction, { timeout: 5000 }).toBe('RIGHT')
    await handle.ready()
    await frames()
    expect(box(el.querySelector('.lm-board')!).width).toBe(el.querySelector('.lm-wrap')!.clientWidth)
  })

  it('shows a phone one panel at a time, the board panning in its own box', async () => {
    const { el } = await draw({ width: 390 })
    await page.viewport(390, 844)
    await enter(el)
    const wrap = el.querySelector<HTMLElement>('.lm-wrap')!
    expect(box(el.querySelector('.lm-board')!).width).toBe(wrap.clientWidth)
    expect(wrap.scrollHeight).toBeGreaterThan(wrap.clientHeight)
    const tabs = [...el.querySelectorAll<HTMLButtonElement>('.lm-tabs button')]
    expect(tabs.map((t) => t.textContent)).toEqual(['Load', 'Live', 'Limits', 'Headroom', 'Compare'])
    const cards = () => [...el.querySelectorAll('.lm-mini')].filter(shown).map((c) => c.getAttribute('data-mini'))
    expect(cards()).toEqual(['controls'])
    await userEvent.click(tabs[2]!)
    await expect.poll(cards).toEqual(['limits'])
    fits(el)
    // panning the diagram keeps Close in reach
    wrap.scrollTop = 400
    await expect.poll(() => wrap.scrollTop).toBeGreaterThan(0)
    expect(inView(button(el))).toBe(true)
    expect(box(button(el)).top).toBeGreaterThanOrEqual(box(wrap).top)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
    await page.screenshot({ path: '__screenshots__/checkout-full-phone.png' })
  })
})

describe('export', () => {
  it('makes a PNG of the board', async () => {
    const { handle } = await mount()
    const png = await exportPng(handle)
    expect(png.type).toBe('image/png')
    expect(png.size).toBeGreaterThan(10_000)
    const frame = await composeFrame(handle, { scale: 2 })
    expect(frame.width % 2).toBe(0)
    expect(Math.abs(frame.width - handle.board()!.scene.width * 2)).toBeLessThanOrEqual(2)
  })

  const bytes = async (b: Blob) => {
    const d = await crypto.subtle.digest('SHA-256', await b.arrayBuffer())
    return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('')
  }

  it('records the same captioned GIF of a scenario switch twice', async () => {
    const { handle } = await mount()
    const opts = {
      format: 'gif' as const,
      seconds: 2,
      fps: 10,
      caption: true,
      script: [
        { at: 0, set: { load: 15 } },
        { at: 1, scenario: 'Proposed' },
      ],
    }
    const a = await recordVideo(handle, opts)
    const b = await recordVideo(handle, opts)
    expect(await bytes(a)).toBe(await bytes(b))
    // the values come back afterwards
    expect(handle.values()).toMatchObject({ load: 10, pods: 3, gateways: 1 })
    // the caption's bands sit above and below the board
    const frame = await composeFrame(handle, { scale: 1, caption: true })
    expect(frame.height).toBeGreaterThan(handle.board()!.scene.height + 100)
    await expect(recordVideo(handle, { ...opts, script: [{ at: 0, scenario: 'Later' }] })).rejects.toThrow(
      'no scenario "Later"; the model has "Today", "Proposed"',
    )
  })

  it('makes the same poster twice', async () => {
    const { handle } = await mount()
    const a = await recordPoster(handle, { scenario: 'Proposed', seed: 4 })
    const b = await recordPoster(handle, { scenario: 'Proposed', seed: 4 })
    expect(a.type).toBe('image/png')
    expect(await bytes(a)).toBe(await bytes(b))
    expect(await bytes(await recordPoster(handle, { seed: 4 }))).not.toBe(await bytes(a))
    const img = await createImageBitmap(a)
    // 2 px per CSS pixel, taller than the board: the verdict, three limits and two scenarios below it
    expect(img.width).toBeGreaterThan(2 * handle.board()!.scene.width)
    expect(img.height).toBeGreaterThan(2 * handle.board()!.scene.height + 400)
  })

  it('exports the board as an SVG file with its dots and caption', async () => {
    const { handle } = await mount()
    handle.pause()
    handle.reset(2)
    for (let i = 0; i < 60; i++) handle.step(1 / 30)
    const text = await exportSvg(handle, { caption: true })
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
    expect(doc.querySelector('parsererror')).toBeNull()
    expect(doc.documentElement.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg')
    expect(doc.querySelectorAll('circle').length).toBe(handle.engine.sim.particles.length)
    expect(text).not.toContain('var(--lm-')
    expect(text).not.toContain('tabindex')
    expect(doc.documentElement.textContent).toContain('Checkout pipeline')
    expect(doc.documentElement.textContent).toContain(
      'At 10×, every component is under the 50 % target at its stated capacity, but the API gateway may already be above it.',
    )
  })

  it('records the story as Play plays it, the same twice, and puts the page back', async () => {
    const { handle } = await mount()
    handle.setValues({ load: 7 })
    const shots: string[] = []
    const steps: (number | null)[] = []
    const close: boolean[] = []
    const opts = { format: 'gif' as const, story: true, fps: 2, scale: 0.5, caption: true }
    const run = async () => {
      const hashes: string[] = []
      shots.length = steps.length = close.length = 0
      await recordVideo(handle, {
        ...opts,
        onFrame: async (_, c) => {
          shots.push(handle.engine.story?.shot ?? 'end')
          steps.push(handle.storyStep())
          close.push(!!handle.engine.camera)
          hashes.push(await hash(c))
        },
      })
      return hashes
    }
    const a = await run()
    // the whole diagram 1.2 s, then each step: in 1 s, close 0.5 s, the change 1.6 s, out 1 s, its 4 s: 25.5 s at 2 fps
    expect(a).toHaveLength(51)
    // the last frame is the end of the last step's hold, whether or not the story has just ended
    const order = shots.filter((x, i) => x !== shots[i - 1] && x !== 'end')
    const step = ['in', 'close', 'change', 'out', 'wide']
    expect(order).toEqual(['establish', ...step, ...step, ...step])
    // a step's values come with its change; the camera is close from the flight in to the flight out, and the last
    // frame shows the whole diagram
    expect(steps[shots.indexOf('change')]).toBe(0)
    expect(steps[shots.indexOf('in')]).toBe(null)
    expect(steps.at(-1)).toBe(2)
    expect(
      shots.map((x, i) => (x === 'close' || x === 'change') === close[i] || x === 'in' || x === 'out'),
    ).not.toContain(false)
    expect(close.at(-1)).toBe(false)
    expect(await run()).toEqual(a)
    expect(handle.storyStep()).toBe(null)
    expect(handle.values().load).toBe(7)
    // from inside the story, with a value changed: both come back as they were
    handle.setStoryStep(0)
    handle.setValues({ load: 12 })
    await run()
    expect(handle.storyStep()).toBe(0)
    expect(handle.values().load).toBe(12)
  })

  it('records the same WebM frames twice', async () => {
    const { handle } = await mount()
    const opts = {
      seconds: 3,
      fps: 20,
      seed: 5,
      script: [
        { at: 0, set: { load: 5 } },
        { at: 1, set: { load: 30 } },
        // more pods change the layout mid-recording: the frame keeps its size
        { at: 2, set: { pods: 6 } },
      ],
    }
    const runs: string[][] = []
    let video: Blob | null = null
    for (let r = 0; r < 2; r++) {
      const hashes: string[] = []
      video = await recordVideo(handle, { ...opts, onFrame: async (_, c) => void hashes.push(await hash(c)) })
      runs.push(hashes)
    }
    expect(runs[0]).toHaveLength(60)
    expect(runs[1]).toEqual(runs[0])
    expect(new Set(runs[0]).size).toBeGreaterThan(50)

    const input = new Input({ source: new BlobSource(video!), formats: ALL_FORMATS })
    expect(await input.computeDuration()).toBeCloseTo(3, 1)
    const track = await input.getPrimaryVideoTrack()
    expect(track?.codec).toMatch(/vp9|vp8|av1/)
  })
})
