import { LoadmapSource } from '@loadmap/react/source'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

// 6 partitions on 4 pods of 4 workers, one consumer per worker: 10 workers read none
const SOURCE = `loadmap 1
load { max: 100 }

flow orders "orders" { rate: 100 * load; from: shop; route: topic -> pool }

node shop "Shop"
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

connection group { hop: topic -> pool; assign: exclusive; capacityPer: pod }

shop -> kafka
kafka -> pool
`

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  root?.unmount()
  host?.remove()
  root = null
  host = null
})

describe('an exclusive connection on the board', () => {
  it('dashes the workers that read no partition, and says why in the limits', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    root.render(<LoadmapSource source={SOURCE} />)
    await expect.poll(() => host!.querySelectorAll('rect[data-unassigned]').length, { timeout: 5000 }).toBe(10)
    expect(host.querySelectorAll('rect[data-slot]').length).toBe(16)
    expect(host.querySelector('.lm-lim[data-component="pool"] .lm-spread')?.textContent).toBe(
      'The busiest pod reads 2 of 6 partitions: Consumers runs out at 75 % of its capacity. 10 of 16 workers read no partition.',
    )
  })
})
