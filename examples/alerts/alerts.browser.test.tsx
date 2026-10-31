import type { LoadmapHandle, Theme } from '@loadmap/react'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Alerts } from './Alerts'

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
  root.render(<Alerts ref={ref} theme={o.theme} />)
  await expect.poll(() => ref.current).toBeTruthy()
  await ref.current!.ready()
  return { handle: ref.current!, el: host.querySelector<HTMLElement>('.lm')! }
}

it('draws both topics, both pools and the fan-out', async () => {
  const { handle, el } = await mount()
  expect(el.querySelectorAll('[data-node]')).toHaveLength(10)
  expect(el.querySelectorAll('rect[data-slot]')).toHaveLength(3 * 8 + 3 * 16)
  handle.pause()
  handle.setValues({ load: 20 })
  await handle.ready()
  handle.reset(4)
  for (let i = 0; i < 600; i++) handle.step(1 / 30)
  const branches = new Set(handle.engine.sim.particles.filter((d) => d.branch).map((d) => d.branch))
  expect(branches.size).toBeGreaterThan(1)
  expect([...el.querySelectorAll('.lm-meter span')].map((s) => s.textContent)).toContain(
    'positions superseded /s (newest kept)',
  )
})

for (const theme of ['light', 'dark'] as const)
  it(`renders the ${theme} theme`, async () => {
    const { el } = await mount({ theme })
    await page.screenshot({ path: `__screenshots__/alerts-${theme}.png`, element: el })
  })

it('fits a phone', async () => {
  const { handle, el } = await mount({ width: 390 })
  await expect.poll(() => handle.board()?.scene.direction).toBe('DOWN')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '__screenshots__/alerts-phone.png', element: el })
})
