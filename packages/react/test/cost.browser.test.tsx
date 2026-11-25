import { compile } from '@loadmap/dsl'
import { Loadmap, type LoadmapHandle } from '@loadmap/react'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

const SOURCE = `loadmap 1.8
load { max: 20 }
currency: "€"

param maxPods "Most API pods" { options: [6, 12]; default: 6 }

scenario today "Today" {}
scenario bigger "Bigger API" { maxPods: 12 }

expect "Today keeps 2×" { underTarget: 2 }
expect "Under 2,000 € a month at 3×" { cost: 2_000; underTarget: 3 }

flow requests "requests" { rate: 100 * load; from: users; route: api -> db }

node users "Users"
pool api "API" {
  perPod: 4
  autoscale { min: 2; max: maxPods; target: 0.7 }
  demand: flows.requests
  capacity: measured(maxPods * 100, "req/s", "100 a pod")
  # a pod a month
  cost: running * 140
  over: "requests queue"
}
node db "Database" {
  pass
  capacity: measured(1_000, "req/s")
  cost: 600
  over: "writes wait"
}

users -> api
api -> db
`

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  root?.unmount()
  host?.remove()
  root = null
  host = null
})

describe('a model with a cost', () => {
  it('has a cost a month in the scenarios table, with the change from the first', async () => {
    const def = compile(SOURCE).definition!
    host = document.createElement('div')
    document.body.appendChild(host)
    const ref = createRef<LoadmapHandle>()
    root = createRoot(host)
    root.render(<Loadmap ref={ref} model={def.model} view={def.view} defaultOpen="headroom" />)
    await expect.poll(() => ref.current).toBeTruthy()
    await ref.current!.ready()
    ref.current!.setValues({ load: 5 })
    const cells = () =>
      [...host!.querySelectorAll<HTMLElement>('.lm-compare td[data-cost]')].map((td) => td.textContent)
    // at 5× today's six pods all run, the bigger API runs eight
    await expect.poll(cells, { timeout: 5000 }).toEqual(['1,440 €', '1,720 € (+280)'])
    expect([...host.querySelectorAll('.lm-compare th')].map((th) => th.textContent)).toContain('Cost a month')
  })
})
