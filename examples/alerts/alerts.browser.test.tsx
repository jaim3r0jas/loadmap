import type { LoadmapHandle, Theme } from '@loadmap/react'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { laidOut } from '../phases'
import { Alerts } from './Alerts'
import { view } from './view'

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  root?.unmount()
  host?.remove()
})

async function mount(o: { theme?: Theme; width?: number; layout?: 'compact' | 'stable' } = {}) {
  await page.viewport(o.width ?? 1440, o.width && o.width < 640 ? 2900 : 1000)
  host = document.createElement('div')
  document.body.appendChild(host)
  const ref = createRef<LoadmapHandle>()
  root = createRoot(host)
  root.render(<Alerts ref={ref} theme={o.theme} view={o.layout ? laidOut(view, o.layout) : undefined} />)
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

/** Plays the story on a paused board: where the boxes stood at each tenth of a second, and the shot it was. */
async function playStory(handle: LoadmapHandle) {
  handle.pause()
  const seconds = handle.playStory()
  const seen: { centres: string; shot: string }[] = []
  const pods = new Set<number>()
  for (let t = 0; t < seconds + 1; t += 0.1) {
    await handle.ready()
    handle.step(0.1)
    const { nodes, width, height } = handle.engine.frame!
    seen.push({
      centres: [
        width,
        height,
        ...nodes.map((n) => `${n.id} ${(n.x + n.w / 2).toFixed(2)} ${(n.y + n.h / 2).toFixed(2)}`),
      ].join(),
      shot: handle.engine.story?.shot ?? 'end',
    })
    pods.add(nodes.find((n) => n.id === 'posPods')!.members.length)
  }
  expect(pods).toEqual(new Set([3, 8]))
  return seen
}

it('plays its story laid out stable without moving a box, though each step changes the pods', async () => {
  const { handle } = await mount({ layout: 'stable' })
  expect(new Set((await playStory(handle)).map((x) => x.centres)).size).toBe(1)
})

it('plays its story laid out compact, moving the boxes only while a step changes the pods', async () => {
  const { handle } = await mount()
  const seen = await playStory(handle)
  const moved = seen.filter((x, i) => i > 0 && x.centres !== seen[i - 1]!.centres)
  expect(moved.length).toBeGreaterThan(0)
  expect(new Set(moved.map((x) => x.shot))).toEqual(new Set(['change']))
})
