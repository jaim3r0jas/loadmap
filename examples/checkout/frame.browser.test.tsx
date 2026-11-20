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

function Page({ height }: { height: number }) {
  const lm = useLoadmap(checkout, view)
  useEffect(() => {
    handle = handleOf(lm)
    ctl = lm
  }, [lm])
  return (
    <LoadmapRoot lm={lm}>
      <Frame lm={lm} style={{ height }} />
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

async function mount(width: number, height: number) {
  await page.viewport(1600, 1000)
  host = document.createElement('div')
  host.style.width = `${width}px`
  document.body.appendChild(host)
  root = createRoot(host)
  root.render(<Page height={height} />)
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
    expect(canvas.querySelector('.lm-canvas-bar h2')).toBeNull()
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
})
