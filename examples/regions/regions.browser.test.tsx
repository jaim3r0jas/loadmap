import type { LoadmapHandle, Theme } from '@loadmap/react'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Regions } from './Regions'

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  root?.unmount()
  host?.remove()
})

async function mount(o: { theme?: Theme; width?: number } = {}) {
  await page.viewport(o.width ?? 1440, o.width && o.width < 640 ? 2900 : 1000)
  host = document.createElement('div')
  document.body.appendChild(host)
  const ref = createRef<LoadmapHandle>()
  root = createRoot(host)
  root.render(<Regions ref={ref} theme={o.theme} zoom />)
  await expect.poll(() => ref.current).toBeTruthy()
  await ref.current!.ready()
  return { handle: ref.current!, el: host.querySelector<HTMLElement>('.lm')! }
}

const nodes = (el: HTMLElement) => [...el.querySelectorAll<SVGGElement>('[data-node]')].map((n) => n.dataset.node)

it('starts with each region closed into one box, and opens one with a click', async () => {
  const { el } = await mount()
  await expect.poll(() => nodes(el), { timeout: 5000 }).toEqual(['users', 'router', 'eu', 'us'])
  el.querySelector('[data-node="us"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await expect.poll(() => nodes(el).length, { timeout: 5000 }).toBe(8)
  expect([...el.querySelectorAll<SVGGElement>('[data-subsystem-id]')].map((g) => g.dataset.subsystemId)).toEqual([
    'us',
    'us.orders',
  ])
})

it('plays its story into the US region, where the order workers run out', async () => {
  const { handle, el } = await mount()
  handle.pause()
  handle.setStoryStep(2)
  await expect.poll(() => nodes(el), { timeout: 5000 }).toContain('us.orders.workers')
  expect(nodes(el)).toContain('eu')
  expect(el.querySelector('.lm-verdict')?.textContent).toContain('the workers in US region')
})

for (const theme of ['light', 'dark'] as const)
  it(`renders the ${theme} theme`, async () => {
    const { el } = await mount({ theme })
    await page.screenshot({ path: `__screenshots__/regions-${theme}.png`, element: el })
  })

it('fits a phone', async () => {
  const { handle, el } = await mount({ width: 390 })
  await expect.poll(() => handle.board()?.scene.direction).toBe('DOWN')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '__screenshots__/regions-phone.png', element: el })
})
