import { compile } from '@loadmap/dsl'
import { Loadmap, type LoadmapHandle } from '@loadmap/react'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

const SOURCE = `loadmap 1.8
load { max: 20 }

preset "Flash sale" { load: 8; lasts: 10min; ramp: 30s }

flow requests "requests" { rate: 100 * load; from: users; route: front -> api }

node users "Users"
node front "Front" {
  pass { component: api }
}
pool api "API" "2 to 12 pods" {
  perPod: 4
  autoscale { min: 2; max: 12; target: 0.7; ready: 90s }
  short: "the API"
  demand: flows.requests
  capacity: measured(12 * 100, "req/s", "load test, 12 pods")
  over: "requests are turned away at the front"
}
node refused "Turned away" { lost { takes: [rejected] } }

users -> front
front -> api
front -> refused
`

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  root?.unmount()
  host?.remove()
  root = null
  host = null
})

describe('a preset with a way up', () => {
  it('says under the verdict what is lost on the way, only while the preset is shown', async () => {
    const def = compile(SOURCE).definition!
    host = document.createElement('div')
    document.body.appendChild(host)
    const ref = createRef<LoadmapHandle>()
    root = createRoot(host)
    root.render(<Loadmap ref={ref} model={def.model} view={def.view} defaultOpen="limits" />)
    await expect.poll(() => ref.current).toBeTruthy()
    await ref.current!.ready()
    await expect.poll(() => host!.querySelector('.lm-verdict'), { timeout: 5000 }).not.toBeNull()
    expect(host.querySelector('.lm-moment')).toBeNull()
    ref.current!.setValues({ load: 8 })
    await expect
      .poll(() => host!.querySelector('.lm-moment')?.textContent, { timeout: 5000 })
      .toBe('8× in 30 s: up to 75 % of requests is lost for 103 s, until the eighth pod of the API is ready.')
    ref.current!.setValues({ load: 3 })
    await expect.poll(() => host!.querySelector('.lm-moment'), { timeout: 5000 }).toBeNull()
  })
})

describe('pressing a preset with a way up', () => {
  /** The board paused, so only `step()` moves it: the sim's clock, not the wall's. */
  async function mountPaused(speed: number) {
    const def = compile(SOURCE).definition!
    host = document.createElement('div')
    document.body.appendChild(host)
    const ref = createRef<LoadmapHandle>()
    root = createRoot(host)
    root.render(<Loadmap ref={ref} model={def.model} view={def.view} speed={speed} defaultOpen="limits" />)
    await expect.poll(() => ref.current).toBeTruthy()
    await ref.current!.ready()
    ref.current!.pause()
    return ref.current!
  }
  const press = () => host!.querySelector<HTMLButtonElement>('.lm-marks [aria-label="Flash sale"]')!.click()
  const idle = () => host!.querySelectorAll('[data-node="api"] [data-idle]').length

  it("plays it on the sim's clock: the load climbs, late pods fill in, then the preset holds", async () => {
    const board = await mountPaused(10)
    press()
    // nothing moves while the board is paused and nobody steps it
    await new Promise((r) => setTimeout(r, 200))
    expect(board.values().load).toBe(1)
    // a tenth of a second at 10× is a second of the sim's time: the walk's first steps, on the ramp
    await expect
      .poll(() => {
        board.step(0.1)
        return board.values().load
      })
      .toBeGreaterThan(1)
    expect(board.values().load).toBeLessThan(8)
    // past the ramp the load is the preset's, and the pods the autoscaler wants wait to be ready, drawn as not running
    for (let i = 0; i < 40; i++) board.step(0.1)
    expect(board.values().load).toBe(8)
    await expect.poll(idle).toBeGreaterThan(0)
    // the way up is the ramp and two ready times: 210 s, then the preset holds with every pod it wants running
    for (let i = 0; i < 200; i++) board.step(0.1)
    expect(board.values()).toMatchObject({ load: 8 })
    await expect
      .poll(() => host!.querySelector('.lm-moment')?.textContent ?? null)
      .toBe('8× in 30 s: up to 75 % of requests is lost for 103 s, until the eighth pod of the API is ready.')
  })

  it('stops where it is when the reader changes a value while it plays', async () => {
    const board = await mountPaused(10)
    press()
    await expect
      .poll(() => {
        board.step(0.1)
        return board.values().load
      })
      .toBeGreaterThan(1)
    board.setValues({ load: 2 })
    for (let i = 0; i < 100; i++) board.step(0.1)
    expect(board.values().load).toBe(2)
  })
})
