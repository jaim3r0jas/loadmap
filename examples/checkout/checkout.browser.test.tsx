import { compare, headroom } from '@loadmap/core'
import { composeFrame, exportPng, exportSvg, recordPoster, recordVideo } from '@loadmap/export'
import { LOADMAP_PANELS, Loadmap, type LoadmapHandle, type LoadmapPanel, type Theme } from '@loadmap/react'
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

  it('walks through its story: a step at a time, pointing at a box', async () => {
    const { el, handle } = await mount()
    const bar = el.querySelector<HTMLElement>('.lm-story')!
    const button = (name: string) => [...bar.querySelectorAll('button')].find((b) => b.textContent === name)
    const focused = () => [...el.querySelectorAll('[data-focus]')].map((n) => n.getAttribute('data-node'))
    expect(bar.querySelector('p')!.textContent).toBe('A walk through this model in 3 steps.')
    await userEvent.click(button('Start')!)
    expect(bar.querySelector('p')!.textContent).toBe('1 of 3 An ordinary peak: every box is under half its capacity.')
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
    expect(bar.querySelector('p')!.textContent).toContain('You changed the values since.')
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
    return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth
  }
  const shown = (e: Element | null) => !!e && e.getClientRects().length > 0
  const button = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.lm-bar .lm-btn')!
  async function enter(el: HTMLElement) {
    await userEvent.click(button(el))
    await expect.poll(() => el.hasAttribute('data-full')).toBe(true)
    // the board takes its size a frame after the layout
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  }
  const PANEL: Record<LoadmapPanel, string> = {
    verdict: '.lm-verdict',
    live: '.lm-meters',
    limits: '.lm-limits',
    controls: '.lm-controls',
    headroom: '.lm-headroom',
    compare: '.lm-compare',
    assumptions: '.lm-facts',
  }

  it('shows the diagram as wide as the screen, and every panel below it', async () => {
    const { handle, el } = await mount()
    await page.viewport(1440, 900)
    await enter(el)
    expect(box(el)).toEqual({ left: 0, top: 0, width: innerWidth, height: innerHeight })
    const wrap = el.querySelector<HTMLElement>('.lm-wrap')!
    const board = el.querySelector('.lm-board')!
    const b = box(board)
    expect(b.width).toBe(wrap.clientWidth)
    // the legend starts where the board does, and the verdict starts on the first screen
    expect(box(el.querySelector('.lm-legend')!).left).toBe(b.left)
    const q = (p: LoadmapPanel) => el.querySelector(PANEL[p])!
    expect(box(q('verdict')).top).toBeGreaterThan(b.top + b.height)
    expect(box(q('verdict')).top).toBeLessThan(innerHeight)
    for (const p of LOADMAP_PANELS) expect(shown(q(p)), p).toBe(true)
    // what the controls change comes first: the meters and the limits beside the controls, the charts after them
    expect(box(q('controls')).top).toBe(box(q('live').closest('.lm-card')!).top)
    const bottom = (p: LoadmapPanel) => box(q(p)).top + box(q(p)).height
    expect(box(q('headroom')).top).toBeGreaterThan(Math.max(bottom('limits'), bottom('controls')))
    expect(box(q('assumptions')).top).toBeGreaterThan(bottom('headroom'))
    // the controls work, and the load never moves the board
    const slider = el.querySelector<HTMLInputElement>('input[type=range]')!
    expect(inView(slider)).toBe(true)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '40')
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    await expect.poll(() => verdict(el)).toContain('At 40×, the worker pool and the API gateway are past capacity')
    await handle.ready()
    expect(box(board)).toEqual(b)
    await page.screenshot({ path: '__screenshots__/checkout-full.png' })
    // the full screen scrolls down to the assumptions
    expect(el.scrollHeight).toBeGreaterThan(el.clientHeight)
    q('assumptions').scrollIntoView()
    await expect.poll(() => inView(q('assumptions').closest('.lm-card')!.querySelector('h3')!)).toBe(true)
    expect(el.scrollTop).toBeGreaterThan(0)
    await page.screenshot({ path: '__screenshots__/checkout-full-below.png' })
    // the bar is out of sight: Close waits in the corner, and puts the page back with the keyboard on the button
    await expect.poll(() => el.querySelector('.lm-corner')).toBeTruthy()
    expect(inView(el.querySelector('.lm-corner')!)).toBe(true)
    await userEvent.click(el.querySelector('.lm-corner')!)
    await expect.poll(() => el.hasAttribute('data-full')).toBe(false)
    expect(document.fullscreenElement).toBeNull()
    expect(document.activeElement).toBe(button(el))
    expect(board.getBoundingClientRect().height).toBeLessThan(innerHeight)
  })

  it('leaves out the panels fullScreen does not list, and only in full screen', async () => {
    await page.viewport(1440, 900)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    const draw = (fullScreen: LoadmapPanel[]) =>
      root!.render(<Loadmap model={checkout} view={view} speed={10} fullScreen={fullScreen} />)
    draw(['verdict'])
    await expect.poll(() => host!.querySelector('.lm-board svg')).toBeTruthy()
    const el = host.querySelector<HTMLElement>('.lm')!
    const q = (p: LoadmapPanel) => el.querySelector(PANEL[p])
    expect(el.querySelectorAll('[data-out]').length).toBeGreaterThan(0)
    for (const p of LOADMAP_PANELS) expect(shown(q(p)), p).toBe(true)
    await enter(el)
    for (const p of LOADMAP_PANELS) {
      draw(LOADMAP_PANELS.filter((x) => x !== p))
      await expect.poll(() => shown(q(p))).toBe(false)
      for (const x of LOADMAP_PANELS) if (x !== p) expect(shown(q(x)), `${x} without ${p}`).toBe(true)
    }
    // one panel left takes the whole width of its row; none leaves the diagram alone
    const side = el.querySelector('.lm-side')!
    draw(['controls'])
    await expect.poll(() => box(q('controls')!).width).toBe(box(side).width)
    // none leaves the diagram as large as fits on the screen
    draw([])
    await expect.poll(() => [...side.querySelectorAll('h3, p')].some(shown)).toBe(false)
    const wrap = el.querySelector<HTMLElement>('.lm-wrap')!
    const room = () => ({
      width: wrap.clientWidth,
      height: wrap.clientHeight - el.querySelector('.lm-bar')!.getBoundingClientRect().height - 8,
    })
    await expect
      .poll(() => {
        const b = box(el.querySelector('.lm-board')!)
        return Math.max(b.width / room().width, b.height / room().height)
      })
      .toBeCloseTo(1, 1)
  })

  it('covers the page where the browser refuses full screen, and leaves on Esc', async () => {
    const { el } = await mount()
    // as on an iPhone, or in a frame without the permission; inside a transform, which traps a fixed element
    el.requestFullscreen = () => Promise.reject(new TypeError('not allowed'))
    host!.style.cssText = 'transform: translateZ(0); margin: 120px 40px'
    await enter(el)
    expect(el.getAttribute('data-full')).toBe('overlay')
    expect(box(el)).toEqual({ left: 0, top: 0, width: innerWidth, height: innerHeight })
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => el.hasAttribute('data-full')).toBe(false)
    expect(button(el).textContent).toContain('Full screen')
  })

  it('turns a diagram from a narrow column to the right, as wide as the screen', async () => {
    const { handle, el } = await mount()
    host!.style.width = '500px'
    await expect.poll(() => handle.board()?.scene.direction).toBe('DOWN')
    await enter(el)
    await expect.poll(() => handle.board()?.scene.direction, { timeout: 5000 }).toBe('RIGHT')
    await handle.ready()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    expect(box(el.querySelector('.lm-board')!).width).toBe(el.querySelector('.lm-wrap')!.clientWidth)
  })

  it('keeps the board as wide as a phone, the controls in reach below it', async () => {
    const { el } = await mount({ width: 390 })
    await page.viewport(390, 844)
    await enter(el)
    const wrap = el.querySelector<HTMLElement>('.lm-wrap')!
    expect(box(el.querySelector('.lm-board')!).width).toBe(wrap.clientWidth)
    expect(getComputedStyle(wrap).overflowY).toBe('auto')
    expect(inView(el.querySelector('input[type=range]')!)).toBe(true)
    // the controls first, then the verdict and the rest
    const top = (s: string) => box(el.querySelector(s)!).top
    expect(top('.lm-controls')).toBeLessThan(top('.lm-verdict'))
    expect(top('.lm-verdict')).toBeLessThan(top('.lm-meters'))
    for (const s of Object.values(PANEL)) expect(shown(el.querySelector(s)), s).toBe(true)
    // scrolling the diagram keeps Close in reach, and so does scrolling down to the panels
    wrap.scrollTop = 400
    await expect.poll(() => wrap.scrollTop).toBeGreaterThan(0)
    expect(inView(button(el))).toBe(true)
    expect(box(button(el)).top).toBeGreaterThanOrEqual(box(wrap).top)
    el.scrollTop = el.scrollHeight
    await expect.poll(() => el.querySelector('.lm-corner')).toBeTruthy()
    expect(inView(el.querySelector('.lm-corner')!)).toBe(true)
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

  it('records the story, a step at a time, and puts the page back', async () => {
    const { handle } = await mount()
    handle.setValues({ load: 7 })
    const steps: (number | null)[] = []
    const opts = { format: 'gif' as const, story: true, fps: 2, scale: 0.5, caption: true }
    const run = async () => {
      const hashes: string[] = []
      await recordVideo(handle, {
        ...opts,
        onFrame: async (_, c) => {
          steps.push(handle.storyStep())
          hashes.push(await hash(c))
        },
      })
      return hashes
    }
    const a = await run()
    expect(a).toHaveLength(24)
    expect(steps.slice(0, 24)).toEqual([...Array(8).fill(0), ...Array(8).fill(1), ...Array(8).fill(2)])
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
