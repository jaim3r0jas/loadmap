import { composeFrame, exportPng, recordVideo } from '@loadmap/export'
import type { LoadmapHandle, Theme } from '@loadmap/react'
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Checkout } from './Checkout'

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
    expect(
      el.querySelector('.lm-lim .lm-tag[data-kind="first"]')?.closest('.lm-lim')?.getAttribute('data-component'),
    ).toBe('workers')
  })

  it('changes the verdict when the load slider moves', async () => {
    const { el } = await mount()
    const slider = el.querySelector<HTMLInputElement>('input[type=range]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '40')
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    await expect.poll(() => verdict(el)).toContain('At 40×, the worker pool and API gateway are past capacity')
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

  it('records the same WebM frames twice', async () => {
    const { handle } = await mount()
    const opts = {
      seconds: 3,
      fps: 20,
      seed: 5,
      script: [
        { at: 0, set: { load: 5 } },
        { at: 1, set: { load: 30 } },
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
