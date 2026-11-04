import { compile } from '@loadmap/dsl'
import { Loadmap, type LoadmapHandle } from '@loadmap/react'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { TEMPLATES } from '../src'

let root: Root | null = null
afterEach(() => {
  root?.unmount()
  root = null
  document.body.replaceChildren()
})

/** A template on its own page, at these values. */
async function mount(id: string, values: Record<string, number> = {}) {
  await page.viewport(1440, 1000)
  const { definition } = compile(TEMPLATES.find((t) => t.id === id)!.source)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const ref = createRef<LoadmapHandle>()
  root = createRoot(host)
  root.render(<Loadmap ref={ref} model={definition!.model} view={definition!.view} />)
  await expect.poll(() => ref.current).toBeTruthy()
  const handle = ref.current!
  handle.setValues(values)
  await handle.ready()
  return { host, handle }
}

/** The text of the live meter whose label holds `label`. */
const meter = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll('.lm-meter')]
    .find((m) => m.querySelector('span')?.textContent?.includes(label))
    ?.querySelector('b')?.textContent

describe('the building blocks in the browser', () => {
  it('draw every pod an autoscaled pool may run and dash the ones it does not', async () => {
    // 2× is 4 cores, held at 70 %: 6 of 12 pods
    const { host } = await mount('autoscale', { load: 2 })
    const pool = host.querySelector('[data-node="api"]')!
    expect(pool.querySelectorAll('rect[data-slot]')).toHaveLength(48)
    expect(pool.querySelectorAll('[data-idle]')).toHaveLength(6)
    await expect.poll(() => meter(host, 'pods running')).toBe('6 of 12')
  })

  it('send a cache hit back along the edge it came in on', async () => {
    const { host, handle } = await mount('cache')
    handle.pause()
    for (let i = 0; i < 90; i++) handle.step(1 / 30)
    // on their way back; once there they fade where they came from
    const back = handle.engine.sim.particles.filter((d) => d.back && d.phase === 'move')
    expect(back.length).toBeGreaterThan(0)
    expect(back.every((d) => d.from.stage === 'cache' && d.to.stage === 'api')).toBe(true)
    await expect.poll(() => meter(host, 'answered at cache')).toBe('1.6k')
  })

  it('say what a rate limiter turns away', async () => {
    // 1,800 req/s against 1,500: a sixth turned away
    const { host } = await mount('rate-limit', { load: 3 })
    await expect.poll(() => meter(host, 'rejected at limiter')).toBe('17 %')
    expect(host.querySelector('.lm-lim[data-component="limiter"] .lm-tag[data-kind="estimated"]')).toBeNull()
  })

  it('draw retries as rings and count the attempts', async () => {
    const { host, handle } = await mount('retry-storm', { load: 4 })
    handle.pause()
    for (let i = 0; i < 120; i++) handle.step(1 / 30)
    expect(handle.engine.dots().some((d) => d.hollow)).toBe(true)
    const r = handle.engine.sim.particles.filter((d) => d.attempt)
    expect(r.length).toBeGreaterThan(0)
    await expect.poll(() => meter(host, 'attempts per request')).toMatch(/^[23]\.\d×$/)
    await expect.poll(() => meter(host, 'failing after 3 retries')).toBe('25 %')
  })
})
