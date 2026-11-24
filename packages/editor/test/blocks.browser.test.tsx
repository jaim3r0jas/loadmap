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

/** A template on its own page, at these values, its live meters open. */
async function mount(id: string, values: Record<string, number> = {}) {
  await page.viewport(1440, 1000)
  const { definition } = compile(TEMPLATES.find((t) => t.id === id)!.source)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const ref = createRef<LoadmapHandle>()
  root = createRoot(host)
  root.render(<Loadmap ref={ref} model={definition!.model} view={definition!.view} defaultOpen="live" />)
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

  it('draw the pods and members of a zone that is down as idle, and move no box', async () => {
    await page.viewport(1440, 1000)
    const { definition } = compile(`loadmap 1.7
load { max: 10 }
domain zone "Availability zone" { count: 3 }
flow req "requests" { rate: 100 * load; route: api -> kafka -> out; from: users }
node users "Users"
pool api "API" { pods: 6; perPod: 2; across: zone; capacity: measured(1_200, "req/s"); over: "x" }
cluster kafka "Kafka" {
  members: 3
  across: zone
  queue topic { partitions { req: 6 } }
  demand: flows.req
  capacity: measured(5_000, "msg/s")
  over: "x"
}
node out "Out" { sink }
users -> api -> kafka -> out
`)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const ref = createRef<LoadmapHandle>()
    root = createRoot(host)
    root.render(<Loadmap ref={ref} model={definition!.model} view={definition!.view} />)
    await expect.poll(() => ref.current).toBeTruthy()
    const handle = ref.current!
    await handle.ready()
    const idle = (id: string) => host.querySelector(`[data-node="${id}"]`)!.querySelectorAll('[data-idle]').length
    const boxes = () =>
      [...host.querySelectorAll('[data-node]')].map((n) => {
        const r = n.querySelector('rect')!
        return ['x', 'y', 'width', 'height'].map((k) => r.getAttribute(k)).join(' ')
      })
    expect([idle('api'), idle('kafka')]).toEqual([0, 0])
    const before = boxes()
    handle.setValues({ down: 'zone' })
    await handle.ready()
    // 6 pods in 3 zones lose 2, 3 members lose 1
    await expect.poll(() => [idle('api'), idle('kafka')], { timeout: 5000 }).toEqual([2, 1])
    expect(boxes()).toEqual(before)
  })

  it("draw a store sharded by key as its members and parts, a hot key's dots on part 0", async () => {
    await page.viewport(1440, 1000)
    const { definition } = compile(`loadmap 1.7
load { max: 10 }
flow writes "writes" { rate: 100 * load; route: gate -> db; from: users }
node users "Users"
node gate "Gateway" { pass; capacity: measured(10_000, "req/s"); over: "x" }
node db "Database" { store; capacity: measured(5_000, "writes/s"); over: "x" }
connection shard {
  hop: gate -> db
  assign: key
  members: 3
  parts: 6
  skew: measured(0.5, "share")
}
users -> gate -> db
`)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const ref = createRef<LoadmapHandle>()
    root = createRoot(host)
    root.render(<Loadmap ref={ref} model={definition!.model} view={definition!.view} />)
    await expect.poll(() => ref.current).toBeTruthy()
    const handle = ref.current!
    await handle.ready()
    const db = host.querySelector('[data-node="db"]')!
    // three members, each with its label, holding six parts between them
    expect([...db.querySelectorAll('text')].map((t) => t.textContent)).toEqual(
      expect.arrayContaining(['member 0', 'member 1', 'member 2']),
    )
    expect(db.querySelectorAll('rect[rx="1.5"]')).toHaveLength(6)
    handle.pause()
    const seen = new Map<number, number>()
    const counted = new Set<number>()
    for (let i = 0; i < 600; i++) {
      handle.step(1 / 30)
      for (const d of handle.engine.sim.particles)
        if (d.to.stage === 'db' && d.to.cell != null && !counted.has(d.id)) {
          counted.add(d.id)
          seen.set(d.to.cell, (seen.get(d.to.cell) ?? 0) + 1)
        }
    }
    const total = [...seen.values()].reduce((a, n) => a + n, 0)
    expect(total).toBeGreaterThan(50)
    expect((seen.get(0) ?? 0) / total).toBeGreaterThan(0.3)
  })

  it('send a cache hit back along the edge it came in on', async () => {
    const { host, handle } = await mount('cache')
    handle.pause()
    for (let i = 0; i < 90; i++) handle.step(1 / 30)
    // on their way back; once there they fade where they came from
    const back = handle.engine.sim.particles.filter((d) => d.back && d.phase === 'move')
    expect(back.length).toBeGreaterThan(0)
    expect(back.every((d) => d.from.stage === 'readCache' && d.to.stage === 'api')).toBe(true)
    await expect.poll(() => meter(host, 'answered at the cache')).toBe('1.6k')
  })

  it('say what a rate limiter turns away', async () => {
    // 1,800 req/s against 1,500: a sixth turned away
    const { host } = await mount('rate-limit', { load: 3 })
    await expect.poll(() => meter(host, 'rejected at the rate limiter')).toBe('17 %')
    // one panel at a time: the limits in place of the meters
    host.querySelector<HTMLButtonElement>('.lm-canvas-tabs button')!.click()
    await expect.poll(() => host.querySelector('.lm-lim[data-component="limiter"]')).toBeTruthy()
    expect(host.querySelector('.lm-lim[data-component="limiter"] .lm-tag[data-kind="estimated"]')).toBeNull()
  })

  it('draw retries as rings and count the attempts', async () => {
    const { host, handle } = await mount('retry-storm', { load: 4 })
    handle.pause()
    for (let i = 0; i < 120; i++) handle.step(1 / 30)
    expect(handle.engine.dots().some((d) => d.ring)).toBe(true)
    const r = handle.engine.sim.particles.filter((d) => d.attempt)
    expect(r.length).toBeGreaterThan(0)
    await expect.poll(() => meter(host, 'attempts per request')).toMatch(/^[23]\.\d×$/)
    await expect.poll(() => meter(host, 'failing after 3 retries')).toBe('25 %')
    // the share its expectation on losses holds: the service takes 3,000 of 4,000 a second
    await expect.poll(() => meter(host, 'requests lost')).toBe('25 %')
    handle.setValues({ load: 2 })
    await expect.poll(() => meter(host, 'requests lost')).toBe('0 %')
  })
})
