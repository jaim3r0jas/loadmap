import { compare, headroom } from '@loadmap/core'
import { composeFrame, exportPng, exportSvg, recordPoster, recordVideo } from '@loadmap/export'
import type { LoadmapHandle, Theme } from '@loadmap/react'
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Checkout } from './Checkout'
import { checkout } from './model'

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

  for (const theme of ['light', 'dark'] as const)
    it(`renders the ${theme} theme`, async () => {
      const { el } = await mount({ theme })
      const bg = getComputedStyle(el).backgroundColor
      expect(bg).toBe(theme === 'light' ? 'rgb(238, 242, 245)' : 'rgb(13, 20, 27)')
      await page.screenshot({ path: `__screenshots__/checkout-${theme}.png`, element: el })
    })

  it('lays the diagram out top to bottom at phone width, without sideways scroll', async () => {
    const { handle, el } = await mount({ width: 390 })
    await expect.poll(() => handle.board()?.scene.direction).toBe('DOWN')
    await handle.ready()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
    await page.screenshot({ path: '__screenshots__/checkout-phone.png', element: el })
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
