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
  it('plays it on the board: the load climbs, late pods fill in, then the preset holds', async () => {
    const def = compile(SOURCE).definition!
    host = document.createElement('div')
    document.body.appendChild(host)
    const ref = createRef<LoadmapHandle>()
    root = createRoot(host)
    // fast: the way up, the ramp and two ready times, is 210 s of the sim's time
    root.render(<Loadmap ref={ref} model={def.model} view={def.view} speed={100} />)
    await expect.poll(() => ref.current).toBeTruthy()
    await ref.current!.ready()
    const mark = host.querySelector<HTMLButtonElement>('.lm-marks [aria-label="Flash sale"]')!
    mark.click()
    // on the way: a load between the default and the preset's, and pods the autoscaler wants drawn as not running
    const loads: number[] = []
    let idle = 0
    await expect
      .poll(
        () => {
          loads.push(ref.current!.values().load as number)
          idle = Math.max(idle, host!.querySelectorAll('[data-node="api"] [data-idle]').length)
          return loads.some((l) => l > 1 && l < 8) && idle > 0
        },
        { timeout: 5000, interval: 16 },
      )
      .toBe(true)
    // then it holds at the preset, every pod it wants running
    await expect.poll(() => ref.current!.values().load, { timeout: 10_000 }).toBe(8)
    await expect.poll(() => host!.querySelector('.lm-moment')?.textContent ?? null, { timeout: 5000 }).not.toBeNull()
  })

  it('stops when the reader changes a value', async () => {
    const def = compile(SOURCE).definition!
    host = document.createElement('div')
    document.body.appendChild(host)
    const ref = createRef<LoadmapHandle>()
    root = createRoot(host)
    root.render(<Loadmap ref={ref} model={def.model} view={def.view} speed={10} />)
    await expect.poll(() => ref.current).toBeTruthy()
    await ref.current!.ready()
    host.querySelector<HTMLButtonElement>('.lm-marks [aria-label="Flash sale"]')!.click()
    ref.current!.setValues({ load: 2 })
    await new Promise((r) => setTimeout(r, 500))
    expect(ref.current!.values().load).toBe(2)
  })
})
