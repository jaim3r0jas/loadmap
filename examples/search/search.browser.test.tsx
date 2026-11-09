import type { LoadmapHandle, Theme } from '@loadmap/react'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Search } from './Search'

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
  root.render(<Search ref={ref} theme={o.theme} />)
  await expect.poll(() => ref.current).toBeTruthy()
  await ref.current!.ready()
  return { handle: ref.current!, el: host.querySelector<HTMLElement>('.lm')! }
}

it('draws the four blocks, every pod the API may run, and the retries past the limit', async () => {
  const { handle, el } = await mount()
  // and the coordinator in front of the two shards
  expect(el.querySelectorAll('[data-node]')).toHaveLength(7)
  // eight pods of four, drawn whether they run or not
  expect(el.querySelectorAll('rect[data-slot]')).toHaveLength(8 * 4)
  handle.pause()
  handle.setValues({ load: 30 })
  await handle.ready()
  expect(handle.engine.ev.retry.searches!.attempts).toBeGreaterThan(20_000)
})

for (const theme of ['light', 'dark'] as const)
  it(`renders the ${theme} theme`, async () => {
    const { el } = await mount({ theme })
    await page.screenshot({ path: `__screenshots__/search-${theme}.png`, element: el })
  })

it('fits a phone', async () => {
  const { handle, el } = await mount({ width: 390 })
  await expect.poll(() => handle.board()?.scene.direction).toBe('DOWN')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '__screenshots__/search-phone.png', element: el })
})

it('plays its story without moving a box: it is laid out stable', async () => {
  const { handle } = await mount()
  handle.pause()
  const seconds = handle.playStory()
  const centres = new Set<string>()
  for (let t = 0; t < seconds + 1; t += 0.1) {
    await handle.ready()
    handle.step(0.1)
    const { nodes, width, height } = handle.engine.frame!
    centres.add(
      [
        width,
        height,
        ...nodes.map((n) => `${n.id} ${(n.x + n.w / 2).toFixed(2)} ${(n.y + n.h / 2).toFixed(2)}`),
      ].join(),
    )
  }
  expect(centres.size).toBe(1)
})
