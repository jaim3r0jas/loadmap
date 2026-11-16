import { LoadmapSource } from '@loadmap/react/source'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

// a rate limiter of 1,500 req/s at 2×: 500 a second turned away, into a lost box
const SOURCE = `loadmap 1.1
load { max: 10; default: 2 }

flow req "requests" { rate: 1_000 * load; route: limiter -> api; from: users }

node users "Users"
node limiter "Rate limiter" { limit; capacity: configured(1_500, "req/s", "gateway config"); over: "429s" }
node api "API" { pass; capacity: measured(5_000, "req/s"); over: "503s" }
node tooMany "Turned away" { lost { takes: [rejected] } }

users -> limiter -> api
limiter -> tooMany
`

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  root?.unmount()
  host?.remove()
  root = null
  host = null
})

async function board(theme: 'light' | 'dark') {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  root.render(<LoadmapSource source={SOURCE} theme={theme} />)
  await expect.poll(() => host!.querySelector('[data-node="tooMany"][data-lost]'), { timeout: 5000 }).not.toBeNull()
  return host
}

describe('a lost box on the board', () => {
  it('is dashed in the colour of a loss, says its rate, and so is the edge into it', async () => {
    const h = await board('light')
    const box = h.querySelector('[data-node="tooMany"]')!
    const rect = box.querySelector('rect')!
    expect(rect.getAttribute('stroke-dasharray')).toBe('5 3')
    expect(getComputedStyle(rect).fill).toBe('rgb(251, 239, 237)')
    expect(box.textContent).toContain('500 rejected/s')
    expect(h.querySelectorAll('g[data-lost] path[stroke-dasharray="4 3"]').length).toBe(1)
  })

  it('takes its colours from the dark theme there', async () => {
    const h = await board('dark')
    const rect = h.querySelector('[data-node="tooMany"] rect')!
    expect(getComputedStyle(rect).fill).toBe('rgb(43, 28, 29)')
    expect(getComputedStyle(rect).stroke).toBe('rgb(226, 106, 92)')
  })
})
