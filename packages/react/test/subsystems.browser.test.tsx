import { compile } from '@loadmap/dsl'
import { Loadmap, type LoadmapHandle } from '@loadmap/react'
import { LoadmapSource } from '@loadmap/react/source'
import { createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

// a region that holds a gateway and its orders line; at the default load the consumers are past their capacity
const SOURCE = `loadmap 1.5
load { max: 100; default: 10 }

flow orders "orders" { rate: 100 * load; from: shop; route: eu.gw -> eu.line.topic -> eu.line.pool }

node shop "Shop"

subsystem eu "EU region" {
  node gw "Gateway" { pass; capacity: estimated(100_000, "req/s"); over: "requests are refused" }
  subsystem line "Orders" {
    cluster kafka "Kafka" {
      members: 3
      queue topic { partitions { orders: 6 } }
    }
    pool pool "Consumers" {
      workers { pods: 4; perPod: 4 }
      demand: flows.orders * 0.01
      capacity: measured(4, "cores", "pod CPU limit")
      over: "orders wait in their topic"
    }
    kafka -> pool
  }
  gw -> line.kafka
}

shop -> eu.gw
`

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  root?.unmount()
  host?.remove()
  root = null
  host = null
})

describe('a subsystem on the board', () => {
  it('is a frame with its name around its boxes, in the state of the worst of them', async () => {
    host = document.createElement('div')
    host.style.width = '1200px'
    document.body.appendChild(host)
    root = createRoot(host)
    root.render(<LoadmapSource source={SOURCE} />)
    await expect.poll(() => host!.querySelectorAll('[data-subsystem-id]').length, { timeout: 5000 }).toBe(2)
    const frame = (id: string) => host!.querySelector<SVGGElement>(`[data-subsystem-id="${id}"]`)!
    expect(frame('eu').querySelector('text')?.textContent).toBe('\u25BE EU region')
    expect(frame('eu.line').querySelector('text')?.textContent).toBe('\u25BE Orders')
    // the frames are drawn before the boxes: behind them
    const svg = frame('eu').ownerSVGElement!
    const order = [...svg.children]
    const firstBox = order.findIndex((el) => el.hasAttribute('data-node'))
    expect(order.indexOf(frame('eu'))).toBeLessThan(order.indexOf(frame('eu.line')))
    expect(order.indexOf(frame('eu.line'))).toBeLessThan(firstBox)
    const holds = (id: string, box: string) => {
      const a = frame(id).querySelector('rect')!.getBoundingClientRect()
      const b = svg.querySelector(`[data-node="${box}"]`)!.getBoundingClientRect()
      return b.left >= a.left && b.top >= a.top && b.right <= a.right && b.bottom <= a.bottom
    }
    for (const box of ['eu.gw', 'eu.line.kafka', 'eu.line.pool']) expect(holds('eu', box), box).toBe(true)
    expect(holds('eu.line', 'eu.line.pool')).toBe(true)
    expect(holds('eu.line', 'eu.gw')).toBe(false)
    expect(holds('eu', 'shop')).toBe(false)
    // the consumers are past their capacity: both frames around them say so
    expect(frame('eu').dataset.state).toBe('over')
    expect(frame('eu.line').dataset.state).toBe('over')
  })

  const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  const frames = () => [...host!.querySelectorAll<SVGGElement>('[data-subsystem-id]')].map((g) => g.dataset.subsystemId)
  const box = (id: string) => host!.querySelector<SVGGElement>(`[data-node="${id}"]`)

  it('is one box while it is closed: a click opens it, and a click on a name closes one', async () => {
    host = document.createElement('div')
    host.style.width = '1200px'
    document.body.appendChild(host)
    root = createRoot(host)
    root.render(<LoadmapSource source={SOURCE.replace('load {', 'view { closed: [eu.line] }\nload {')} />)
    await expect.poll(() => box('eu.line'), { timeout: 5000 }).toBeTruthy()
    // the orders line is one box in the region's frame, named with the mark of a closed folder and its busiest component
    expect(frames()).toEqual(['eu'])
    expect(box('eu.line.pool')).toBeNull()
    expect(box('eu.line')!.textContent).toContain('\u25B8 Orders')
    expect(box('eu.line')!.textContent).toMatch(/Consumers 250\s?%/)
    expect(box('eu.line')!.getAttribute('aria-label')).toBe('\u25B8 Orders: closed. Open it')
    // the limit is inside it: the box wears it
    expect(host.querySelector('[data-subsystem-id="eu"]')!.getAttribute('data-state')).toBe('over')
    click(box('eu.line')!)
    await expect.poll(() => frames(), { timeout: 5000 }).toEqual(['eu', 'eu.line'])
    await expect.poll(() => box('eu.line.pool'), { timeout: 5000 }).toBeTruthy()
    // a click on the region's name closes the region, with everything in it
    click(host.querySelector('[data-subsystem-id="eu"] text')!)
    await expect.poll(() => box('eu'), { timeout: 5000 }).toBeTruthy()
    await expect.poll(() => frames(), { timeout: 5000 }).toEqual([])
    expect(box('eu')!.textContent).toContain('\u25B8 EU region')
  })

  it("shows a story step with the subsystems the step closes, and the page's own outside the story", async () => {
    const def = compile(
      `${SOURCE}step "The region as one box." { closed: [eu] }\nstep "Every box." { closed: [] }\n`.replace(
        'load {',
        'view { closed: [eu.line] }\nload {',
      ),
    ).definition!
    host = document.createElement('div')
    host.style.width = '1200px'
    document.body.appendChild(host)
    root = createRoot(host)
    const ref = createRef<LoadmapHandle>()
    root.render(<Loadmap ref={ref} model={def.model} view={def.view} closed={def.options.closed} />)
    await expect.poll(() => box('eu.line'), { timeout: 5000 }).toBeTruthy()
    ref.current!.setStoryStep(0)
    await expect.poll(() => box('eu'), { timeout: 5000 }).toBeTruthy()
    ref.current!.setStoryStep(1)
    await expect.poll(() => frames(), { timeout: 5000 }).toEqual(['eu', 'eu.line'])
    ref.current!.setStoryStep(null)
    await expect.poll(() => box('eu.line'), { timeout: 5000 }).toBeTruthy()
    expect(frames()).toEqual(['eu'])
    // and the handle closes and opens them
    ref.current!.setClosed(['eu'])
    await expect.poll(() => box('eu'), { timeout: 5000 }).toBeTruthy()
  })
})
