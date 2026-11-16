import type { Direction } from '@loadmap/layout'
import { Loadmap, type LoadmapHandle } from '@loadmap/react'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { alerts } from '../alerts/model'
import { view } from '../alerts/view'

let root: Root | null = null
let host: HTMLDivElement | null = null

/** Alerts, a long chain, filling a frame of this size: the frame is the diagram's room. */
async function frame(width: number, height: number, direction?: Direction | 'auto') {
  await page.viewport(1600, 1300)
  host = document.createElement('div')
  host.style.cssText = `width: ${width}px; height: ${height}px`
  document.body.appendChild(host)
  root = createRoot(host)
  const ref = createRef<LoadmapHandle>()
  root.render(<Loadmap ref={ref} model={alerts} view={view} fill fullScreenMode="focus" direction={direction} />)
  await expect.poll(() => ref.current).toBeTruthy()
  await ref.current!.ready()
  return ref.current!
}

const runs = (handle: LoadmapHandle) => handle.board()?.scene.direction
/** The share of the frame the diagram's board covers. */
const covers = () => {
  const b = host!.querySelector('.lm-board')!.getBoundingClientRect()
  const h = host!.getBoundingClientRect()
  return (b.width * b.height) / (h.width * h.height)
}

afterEach(() => {
  root?.unmount()
  host?.remove()
  root = null
  host = null
})

describe('the direction follows the room', () => {
  it('runs a long chain right in a wide frame', async () => {
    const handle = await frame(1100, 560)
    expect(runs(handle)).toBe('RIGHT')
    await page.screenshot({ path: '__screenshots__/room-wide.png', element: host! })
  })

  it('runs it down in a tall frame, where that draws it larger', async () => {
    const handle = await frame(760, 1100)
    await expect.poll(() => runs(handle), { timeout: 5000 }).toBe('DOWN')
    await handle.ready()
    const down = covers()
    await page.screenshot({ path: '__screenshots__/room-tall.png', element: host! })
    root!.unmount()
    host!.remove()
    // the same frame with the chain held to the right: a thin strip across it
    const held = await frame(760, 1100, 'RIGHT')
    expect(runs(held)).toBe('RIGHT')
    await page.screenshot({ path: '__screenshots__/room-tall-right.png', element: host! })
    expect(down).toBeGreaterThan(covers() * 1.5)
  })

  it('keeps a direction the page sets, whatever the room', async () => {
    expect(runs(await frame(760, 1100, 'RIGHT'))).toBe('RIGHT')
    root!.unmount()
    host!.remove()
    expect(runs(await frame(1100, 560, 'DOWN'))).toBe('DOWN')
  })

  it('turns when the frame is resized, and neither the load nor a scenario turns it', async () => {
    const handle = await frame(760, 1100)
    await expect.poll(() => runs(handle), { timeout: 5000 }).toBe('DOWN')
    handle.setValues({ load: alerts.def.load.max })
    await handle.ready()
    expect(runs(handle)).toBe('DOWN')
    for (const s of alerts.scenarios) {
      handle.setValues(s.values)
      await handle.ready()
      expect(runs(handle)).toBe('DOWN')
    }
    Object.assign(host!.style, { width: '1100px', height: '560px' })
    await expect.poll(() => runs(handle), { timeout: 5000 }).toBe('RIGHT')
  })
})
