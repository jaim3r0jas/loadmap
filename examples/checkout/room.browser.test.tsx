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

/**
 * Alerts, a long chain, filling a frame of this size with the least around it: the diagram's room is the frame less
 * the bar over it and the console under it.
 */
async function frame(width: number, height: number, direction?: Direction | 'auto', rows?: number) {
  await page.viewport(1600, 1300)
  host = document.createElement('div')
  host.style.cssText = `width: ${width}px; height: ${height}px`
  document.body.appendChild(host)
  root = createRoot(host)
  const ref = createRef<LoadmapHandle>()
  root.render(<Loadmap ref={ref} model={alerts} view={view} fill chrome="least" direction={direction} rows={rows} />)
  await expect.poll(() => ref.current).toBeTruthy()
  // the canvas tells its room once its bars are measured: the diagram is arranged for it
  await expect.poll(() => ref.current!.engine.room, { timeout: 5000 }).not.toBeNull()
  await ref.current!.ready()
  return ref.current!
}

const runs = (handle: LoadmapHandle) => handle.board()?.scene.direction
/** The rows the diagram is folded into: each row has its own lanes, at a place of their own across the flow. */
const rows = (handle: LoadmapHandle) => {
  const scene = handle.board()?.scene
  return scene && new Set(scene.tiers.map((t) => (scene.direction === 'DOWN' ? t.x : t.y))).size
}
/**
 * The scale the whole diagram has in its room, as the arrangement counts it (`arrangementFor`): no scale past full
 * size counts. The board is the whole canvas now, so its own size says nothing of how large the diagram is drawn.
 */
const fits = (handle: LoadmapHandle) => {
  const room = handle.engine.room!
  const { width, height } = handle.board()!.scene
  return Math.min(room.w / width, room.h / height, 1)
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
    const down = fits(handle)
    await page.screenshot({ path: '__screenshots__/room-tall.png', element: host! })
    root!.unmount()
    host!.remove()
    // the same frame with the chain held to the right: a thin strip across it
    const held = await frame(760, 1100, 'RIGHT', 1)
    expect(runs(held)).toBe('RIGHT')
    await page.screenshot({ path: '__screenshots__/room-tall-right.png', element: host! })
    expect(down).toBeGreaterThan(fits(held) * 1.5)
  })

  it('keeps a direction the page sets, whatever the room', async () => {
    const held = await frame(760, 1100, 'RIGHT', 1)
    expect([runs(held), rows(held)]).toEqual(['RIGHT', 1])
    root!.unmount()
    host!.remove()
    expect(runs(await frame(1100, 560, 'DOWN'))).toBe('DOWN')
  })

  it('turns when the frame is resized, and neither the load nor a scenario turns it', async () => {
    const handle = await frame(760, 1100)
    await expect.poll(() => runs(handle), { timeout: 5000 }).toBe('DOWN')
    const folds = rows(handle)
    handle.setValues({ load: alerts.def.load.max })
    await handle.ready()
    expect([runs(handle), rows(handle)]).toEqual(['DOWN', folds])
    for (const s of alerts.scenarios) {
      handle.setValues(s.values)
      await handle.ready()
      expect([runs(handle), rows(handle)]).toEqual(['DOWN', folds])
    }
    Object.assign(host!.style, { width: '1100px', height: '560px' })
    await expect.poll(() => runs(handle), { timeout: 5000 }).toBe('RIGHT')
  })
})

describe('a long diagram folds to fill its room', () => {
  it('stays in one row in a wide frame, where folding would draw it no larger', async () => {
    const handle = await frame(1100, 560)
    expect([runs(handle), rows(handle)]).toEqual(['RIGHT', 1])
  })

  it('folds a chain held to the right into rows in a frame too narrow for it, larger than in one row', async () => {
    const one = await frame(760, 1100, 'RIGHT', 1)
    expect(rows(one)).toBe(1)
    const strip = fits(one)
    const width = one.board()!.scene.width
    root!.unmount()
    host!.remove()
    const handle = await frame(760, 1100, 'RIGHT')
    await expect.poll(() => rows(handle), { timeout: 5000 }).toBeGreaterThan(1)
    await handle.ready()
    expect(runs(handle)).toBe('RIGHT')
    expect(handle.board()!.scene.width).toBeLessThan(width * 0.7)
    expect(fits(handle)).toBeGreaterThan(strip * 1.5)
    await page.screenshot({ path: '__screenshots__/room-tall-folded.png', element: host! })
  })

  it('holds the rows the page sets', async () => {
    const handle = await frame(1100, 560, 'RIGHT', 2)
    expect([runs(handle), rows(handle)]).toEqual(['RIGHT', 2])
  })

  it('never folds on a narrow screen, whatever rows the page sets: it runs down in one column', async () => {
    // under narrowBelow (640): columns side by side would each be narrower still
    const handle = await frame(600, 1100, 'RIGHT', 2)
    await expect.poll(() => runs(handle), { timeout: 5000 }).toBe('DOWN')
    await handle.ready()
    expect(rows(handle)).toBe(1)
  })

  it('unfolds when the frame grows wide enough for one row to read with ease', async () => {
    const handle = await frame(760, 1100, 'RIGHT')
    await expect.poll(() => rows(handle), { timeout: 5000 }).toBeGreaterThan(1)
    Object.assign(host!.style, { width: '1560px', height: '700px' })
    await expect.poll(() => rows(handle), { timeout: 5000 }).toBe(1)
  })
})
