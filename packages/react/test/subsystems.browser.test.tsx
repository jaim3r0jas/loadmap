import { LoadmapSource } from '@loadmap/react/source'
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
    expect(frame('eu').querySelector('text')?.textContent).toBe('EU region')
    expect(frame('eu.line').querySelector('text')?.textContent).toBe('Orders')
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
})
